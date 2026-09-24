"""Local child-process regressions; no video/provider network requests."""
import asyncio
import json
import os
from pathlib import Path
import sys
import time

import pytest

from app.core import video_process
from app.video_import import parse_video_source


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def fake_child(monkeypatch, tmp_path, *, response=None):
    real_spawn = asyncio.create_subprocess_exec
    pidfile = tmp_path / 'child.pid'
    script = ('import os,time,pathlib,sys; '
              f'pathlib.Path({str(pidfile)!r}).write_text(str(os.getpid())); '
              + (f'sys.stdout.write({json.dumps(response)!r})' if response else 'time.sleep(60)'))
    async def spawn(*args, **kwargs):
        return await real_spawn(sys.executable, '-c', script, **kwargs)
    monkeypatch.setattr(video_process.asyncio, 'create_subprocess_exec', spawn)
    return pidfile


async def wait_for_pid(pidfile):
    async with asyncio.timeout(3):
        while not pidfile.exists():
            await asyncio.sleep(.005)
    return int(pidfile.read_text())


@pytest.mark.asyncio
async def test_cancellation_reaps_running_video_work_before_return(monkeypatch, tmp_path):
    pidfile = fake_child(monkeypatch, tmp_path)
    task = asyncio.create_task(video_process.run_video_fetch(
        parse_video_source('https://youtu.be/A6bByqI_TH8'), deadline=time.monotonic()+30))
    pid = await wait_for_pid(pidfile)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not alive(pid)


@pytest.mark.asyncio
async def test_video_deadline_kills_worker(monkeypatch, tmp_path):
    pidfile = fake_child(monkeypatch, tmp_path)
    result = await video_process.run_video_fetch(
        parse_video_source('https://youtu.be/A6bByqI_TH8'), deadline=time.monotonic()+.15)
    assert result.status == 'fetch_failed'
    assert not alive(int(pidfile.read_text()))


@pytest.mark.asyncio
async def test_video_result_preserves_provider_and_source(monkeypatch, tmp_path):
    source = parse_video_source('https://youtu.be/A6bByqI_TH8')
    fake_child(monkeypatch, tmp_path, response={'status':'ok', 'text':'Boil eggs.', 'message':None,
                                               'title':'Eggs', 'thumbnail_url':None})
    result = await video_process.run_video_fetch(source, deadline=time.monotonic()+3)
    assert result.text == 'Boil eggs.' and result.source == source and result.title == 'Eggs'


@pytest.mark.asyncio
async def test_expired_request_never_starts_video_worker(monkeypatch):
    from unittest.mock import AsyncMock
    spawn = AsyncMock()
    monkeypatch.setattr(video_process.asyncio, 'create_subprocess_exec', spawn)
    result = await video_process.run_video_fetch(
        parse_video_source('https://youtu.be/A6bByqI_TH8'), deadline=time.monotonic()-1)
    assert result.status == 'fetch_failed'
    spawn.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancel_during_spawn_keeps_child_owned_until_reaped(monkeypatch, tmp_path):
    real_spawn = asyncio.create_subprocess_exec
    spawned = asyncio.Event()
    allow_return = asyncio.Event()
    children = []
    async def spawn(*args, **kwargs):
        child = await real_spawn(sys.executable, '-c', 'import time; time.sleep(60)', **kwargs)
        children.append(child)
        spawned.set()
        await allow_return.wait()
        return child
    monkeypatch.setattr(video_process.asyncio, 'create_subprocess_exec', spawn)
    task = asyncio.create_task(video_process.run_video_fetch(
        parse_video_source('https://youtu.be/A6bByqI_TH8'), deadline=time.monotonic()+30))
    await asyncio.wait_for(spawned.wait(), 3)
    task.cancel()
    await asyncio.sleep(.01)
    assert not task.done()
    allow_return.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not alive(children[0].pid)


@pytest.mark.asyncio
async def test_watchdog_kills_blocked_worker_without_parent_cancellation():
    # Execute only the real watchdog, then block the main thread. No provider call.
    script = ('import os,time,threading; from app.core.video_runner import _watch; '
              'threading.Thread(target=_watch,args=(os.getppid(),time.monotonic()+.1),daemon=True).start(); '
              'time.sleep(60)')
    process = await asyncio.create_subprocess_exec(sys.executable, '-c', script, start_new_session=True)
    try:
        await asyncio.wait_for(process.wait(), 3)
        assert process.returncode < 0
        assert not alive(process.pid)
    finally:
        if process.returncode is None:
            os.killpg(process.pid, 9)
            await process.wait()


@pytest.mark.asyncio
@pytest.mark.parametrize('interruption', ['cancel_on_output', 'deadline_during_spawn'])
async def test_large_output_is_drained_when_cancelled_before_reader_finishes(monkeypatch, interruption):
    real_spawn = asyncio.create_subprocess_exec
    children = []
    task = None
    script = 'import sys,time; '
    if interruption == 'cancel_on_output':
        # Match the actual runner ordering: consume input, then emit the result.
        script += 'sys.stdin.buffer.read(); '
    script += "sys.stdout.buffer.write(b'x'*500000); sys.stdout.flush(); time.sleep(60)"
    async def spawn(*args, **kwargs):
        process = await real_spawn(sys.executable, '-c', script, **kwargs)
        children.append(process)
        if interruption == 'cancel_on_output':
            original_feed = process.stdout.feed_data
            cancelled = False
            def feed(data):
                nonlocal cancelled
                original_feed(data)
                if not cancelled:
                    cancelled = True
                    task.cancel()
            monkeypatch.setattr(process.stdout, 'feed_data', feed)
        else:
            # Fill/pause the stdout pipe before returning process ownership.
            await asyncio.sleep(.2)
        return process
    monkeypatch.setattr(video_process.asyncio, 'create_subprocess_exec', spawn)
    deadline = time.monotonic() + (.1 if interruption == 'deadline_during_spawn' else 3)
    task = asyncio.create_task(video_process.run_video_fetch(
        parse_video_source('https://youtu.be/A6bByqI_TH8'), deadline=deadline))
    done, _ = await asyncio.wait({task}, timeout=.8)
    finished_without_manual_drain = bool(done)
    if not done:
        # Clean the reproduced hang safely so a failed regression leaves no child.
        for process in children:
            await process.stdout.read()
        await asyncio.wait({task}, timeout=2)
    try:
        if interruption == 'cancel_on_output':
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            assert (await task).status == 'fetch_failed'
        assert finished_without_manual_drain, 'killed child hung while stdout remained paused'
        assert children and not alive(children[0].pid)
    finally:
        for process in children:
            if process.returncode is None:
                os.killpg(process.pid, 9)
                await process.communicate()


@pytest.mark.asyncio
async def test_rednote_runner_round_trip_retains_media_and_resolved_attribution(monkeypatch):
    # Execute the real runner/serialization boundary; replace only the provider I/O.
    real_spawn = asyncio.create_subprocess_exec
    source = parse_video_source('http://xhslink.com/a/Test')
    resolved = 'https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9'
    media = 'https://sns-video-bd.xhscdn.com/example.mp4'
    script = (
        'from app import rednote; from app.video_import import VideoTextResult,parse_video_source; '
        f'rednote.fetch_rednote_text=lambda source: VideoTextResult("ok", "鸡蛋2个，蒸10分钟。", '
        f'parse_video_source({resolved!r}), source_kind="description", media_url={media!r}); '
        'from app.core.video_runner import main; main()'
    )
    async def spawn(*args, **kwargs):
        return await real_spawn(sys.executable, '-c', script, *args[-2:], **kwargs)
    monkeypatch.setattr(video_process.asyncio, 'create_subprocess_exec', spawn)
    result = await video_process.run_video_fetch(source, deadline=time.monotonic()+10)
    assert result.status == 'ok' and result.source.canonical_url == resolved
    assert result.media_url == media and result.source_kind == 'description'
    assert result.text == '鸡蛋2个，蒸10分钟。'


@pytest.mark.asyncio
async def test_resolved_note_cannot_change_provider_or_existing_note(monkeypatch, tmp_path):
    source = parse_video_source('https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9')
    fake_child(monkeypatch, tmp_path, response={'status': 'ok', 'text': 'Wrong source.',
        'resolved_url': 'https://youtu.be/A6bByqI_TH8'})
    result = await video_process.run_video_fetch(source, deadline=time.monotonic()+3)
    assert result.status == 'fetch_failed'
