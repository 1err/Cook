import asyncio
from types import SimpleNamespace

import pytest

from app.jobs import durable_store, worker
from app.services import store_product_service
from app.services.weee_scraper import StoreScrapeError


@pytest.mark.asyncio
async def test_durable_miss_never_runs_api_scraper(monkeypatch):
    async def lookup(prepared, **kwargs):
        assert prepared.cache_query == 'tofu'
        return store_product_service.StoreProductsResult([], None)
    async def forbidden(*args, **kwargs):
        pytest.fail('API replica launched scraper')
    monkeypatch.setattr(durable_store, 'enabled', lambda: True)
    monkeypatch.setattr(durable_store, 'lookup', lookup)
    monkeypatch.setattr(store_product_service.weee_scraper, 'scrape_weee_products', forbidden)
    assert (await store_product_service.fetch_store_products_with_metadata('Tofu')).products == []


@pytest.mark.asyncio
async def test_poll_timeout_keeps_admitted_job(monkeypatch):
    class Repo:
        async def enqueue_lookup(self, *args, **kwargs):
            return SimpleNamespace(id='job'), True
        async def get(self, job_id):
            return SimpleNamespace(state='queued')
    monkeypatch.setattr(durable_store, 'repository', lambda: Repo())
    monkeypatch.setattr(durable_store, 'settings', SimpleNamespace(STORE_JOBS_WAIT_SECONDS=.015, STORE_JOBS_POLL_SECONDS=.005))
    with pytest.raises(StoreScrapeError, match='queued'):
        await durable_store.lookup(store_product_service.prepare_store_query('tofu'))


@pytest.mark.asyncio
async def test_child_timeout_kills_and_reaps_process_group(monkeypatch):
    events = []
    class Process:
        pid = 111111
        returncode = None
        async def communicate(self, data=None):
            if data is not None:
                await asyncio.Event().wait()
            self.returncode = 124
            events.append('reaped')
            return b"", None
    async def create(*args, **kwargs):
        assert kwargs['start_new_session'] is True
        return Process()
    monkeypatch.setattr(worker.asyncio, 'create_subprocess_exec', create)
    monkeypatch.setattr(worker.os, 'kill', lambda pid, sig: events.append('killed'))
    with pytest.raises(StoreScrapeError, match='timed out'):
        await worker.scrape_in_subprocess('tofu', 'en', timeout=.01)
    assert events == ['killed', 'reaped']


@pytest.mark.asyncio
async def test_child_cancellation_reaps_before_return(monkeypatch):
    started = asyncio.Event()
    events = []
    class Process:
        pid = 111112
        returncode = None
        async def communicate(self, data=None):
            if data is not None:
                started.set()
                await asyncio.Event().wait()
            events.append('reaped')
            self.returncode = 124
            return b"", None
    async def create(*args, **kwargs):
        return Process()
    monkeypatch.setattr(worker.asyncio, 'create_subprocess_exec', create)
    monkeypatch.setattr(worker.os, 'kill', lambda pid, sig: events.append('killed'))
    task = asyncio.create_task(worker.scrape_in_subprocess('tofu', 'en', timeout=10))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert events == ['killed', 'reaped']


@pytest.mark.asyncio
async def test_cancellation_during_spawn_still_reaps(monkeypatch):
    spawning = asyncio.Event()
    complete_spawn = asyncio.Event()
    events = []
    class Process:
        pid = 111113
        returncode = None
        async def communicate(self):
            events.append('reaped')
            self.returncode = 124
            return b"", None
    async def create(*args, **kwargs):
        spawning.set()
        await complete_spawn.wait()
        return Process()
    monkeypatch.setattr(worker.asyncio, 'create_subprocess_exec', create)
    monkeypatch.setattr(worker.os, 'kill', lambda pid, sig: events.append('killed'))
    task = asyncio.create_task(worker.scrape_in_subprocess('tofu', 'en', timeout=10))
    await spawning.wait()
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done()
    complete_spawn.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert events == ['killed', 'reaped']


@pytest.mark.asyncio
async def test_admin_refresh_uses_shared_status(monkeypatch):
    from app.api import admin
    status = dict(running=True, current=2, total=10, last_query='rice', last_status='empty', stale_only=True, summary=None)
    async def trigger(**kwargs):
        assert kwargs == {'force_refresh': False}
        return dict(started=False, status=status)
    async def shared_status():
        return status
    monkeypatch.setattr(durable_store, 'enabled', lambda: True)
    monkeypatch.setattr(durable_store, 'trigger_warmer', trigger)
    monkeypatch.setattr(durable_store, 'warmer_status', shared_status)
    result = await admin.cache_refresh(admin.CacheRefreshBody(stale_only=True), current_user=object())
    assert result.started is False
    assert result.status.model_dump() == status
    assert (await admin.cache_refresh_status(current_user=object())).model_dump() == status


@pytest.mark.asyncio
async def test_admin_queue_overflow_returns_retryable_503(monkeypatch):
    from app.api import admin
    from app.db.repo_store_jobs import QueueFull
    from fastapi import HTTPException
    async def full(**kwargs):
        raise QueueFull()
    monkeypatch.setattr(durable_store, 'enabled', lambda: True)
    monkeypatch.setattr(durable_store, 'trigger_warmer', full)
    with pytest.raises(HTTPException) as exc:
        await admin.cache_refresh(admin.CacheRefreshBody(), current_user=object())
    assert exc.value.status_code == 503
    assert exc.value.headers['Retry-After'] == '3'


@pytest.mark.asyncio
async def test_unconfirmed_supervisor_exit_fails_closed(monkeypatch):
    class Process:
        returncode = -9
        async def communicate(self):
            return b"", None
    with pytest.raises(worker.CleanupFailed):
        await worker._kill_and_reap(Process())


@pytest.mark.asyncio
async def test_real_large_stdout_during_cancellation_is_drained(monkeypatch, tmp_path):
    """A real 500 KB pipe must drain even after communicate() was cancelled."""
    import sys
    ready = tmp_path / 'ready'
    script = f'''
import os,signal,time
from pathlib import Path
def stop(*args):
    os.write(1, b'x' * 500000)
    os._exit(124)
signal.signal(signal.SIGTERM, stop)
Path({str(ready)!r}).write_text('ready')
time.sleep(60)
'''
    real_spawn = asyncio.create_subprocess_exec
    processes = []
    async def spawn(*args, **kwargs):
        process = await real_spawn(sys.executable, '-c', script, **kwargs)
        processes.append(process)
        return process
    monkeypatch.setattr(worker.asyncio, 'create_subprocess_exec', spawn)
    task = asyncio.create_task(worker.scrape_in_subprocess('tofu', 'en', timeout=30))
    try:
        async with asyncio.timeout(3):
            while not ready.exists():
                await asyncio.sleep(.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(asyncio.shield(task), timeout=3)
        assert processes[0].returncode == 124
    finally:
        for process in processes:
            if process.returncode is None:
                process.kill()
                await process.communicate()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


def test_scrape_task_rejects_oversized_serialized_output_before_write():
    from app.jobs import scrape_task
    with pytest.raises(StoreScrapeError, match='too large'):
        scrape_task.serialize_products([dict(name='Tofu', price='x' * 65536)])
    assert scrape_task.serialize_products([]) == b'[]'
