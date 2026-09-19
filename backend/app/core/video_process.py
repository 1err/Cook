"""Cancellable source fetching: reap actual worker before releasing admission."""
import asyncio
import json
import os
import signal
import sys
import time
from weakref import WeakKeyDictionary

from app.core.config import settings

# Paid requests also hold cross-replica DB leases. This local bound protects
# standalone/disabled-AI source fetches and includes waiting in their deadline.
_slots = WeakKeyDictionary()


def _local_slots():
    loop = asyncio.get_running_loop()
    if loop not in _slots:
        _slots[loop] = asyncio.Semaphore(settings.AI_GLOBAL_MAX_INFLIGHT)
    return _slots[loop]


async def _kill_and_reap(process):
    try:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    finally:
        # A cancelled communicate() can leave stdout paused at its buffer limit.
        # wait() alone then hangs even after SIGKILL: the subprocess transport
        # waits for pipe EOF before completing exit. Resume/drain both pipes and
        # close stdin before reaping. Original communicate has unwound before
        # this cleanup task starts, so it no longer owns a reader.
        # Even a failed kill retains ownership until the watchdog/OS confirms exit.
        await process.communicate()


async def _fetch(source, deadline):
    from app.video_import import VideoTextResult
    spawning = asyncio.create_task(asyncio.create_subprocess_exec(
        sys.executable, '-m', 'app.core.video_runner', str(os.getpid()), str(deadline),
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL, start_new_session=True))
    cancelled = False
    # Cancellation during process creation must not lose ownership of the child.
    while not spawning.done():
        try:
            await asyncio.shield(spawning)
        except asyncio.CancelledError:
            cancelled = True
    process = spawning.result()
    try:
        if cancelled:
            raise asyncio.CancelledError
        stdout, _ = await process.communicate(json.dumps({'url': source.original_url}).encode())
        if process.returncode != 0 or len(stdout) > 512_000:
            raise ValueError('Video worker failed')
        payload = json.loads(stdout)
        if not isinstance(payload, dict) or not isinstance(payload.get('status'), str) or not isinstance(payload.get('text'), str):
            raise ValueError('Invalid video worker result')
        return VideoTextResult(source=source, **payload)
    finally:
        # Keep ownership/lease until the OS confirms exit, even under repeated
        # request cancellation. The child's watchdog also handles parent death.
        cleanup = asyncio.create_task(_kill_and_reap(process))
        interrupted = False
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                interrupted = True
        cleanup.result()
        if interrupted:
            raise asyncio.CancelledError


async def run_video_fetch(source, *, deadline):
    from app.video_import import VideoTextResult
    try:
        if time.monotonic() >= deadline:
            raise TimeoutError
        async with asyncio.timeout_at(deadline):
            async with _local_slots():
                # Semaphore acquisition can consume all remaining time.
                if time.monotonic() >= deadline:
                    raise TimeoutError
                return await _fetch(source, deadline)
    except (TimeoutError, OSError, ValueError):
        return VideoTextResult('fetch_failed', '', source,
                               message='Video import is temporarily unavailable. Please try again.')
