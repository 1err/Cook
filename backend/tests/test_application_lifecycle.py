import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from app import main
from app.db import session as db_session


@pytest.mark.asyncio
async def test_lifespan_starts_admission_and_shuts_resources_down_in_order(
    monkeypatch: pytest.MonkeyPatch,
):
    events: list[str] = []

    def record(name: str):
        def result(*args: Any, **kwargs: Any) -> None:
            events.append(name)
        return result

    def record_async(name: str):
        async def result(*args: Any, **kwargs: Any) -> None:
            events.append(name)
        return result

    monkeypatch.setattr(main, "init_engine", record("init_engine"))
    monkeypatch.setattr(main, "start_live_lookup_admission", record("start_admission"))
    monkeypatch.setattr(main, "start_scheduler", record("start_scheduler"))
    monkeypatch.setattr(main, "stop_scheduler", record("stop_scheduler"))
    monkeypatch.setattr(main, "stop_live_lookup_admission", record("stop_admission"))
    monkeypatch.setattr(main, "shutdown_cache_warmer", record_async("stop_warmer"))
    monkeypatch.setattr(main, "shutdown_live_lookups", record_async("stop_live"))
    monkeypatch.setattr(main, "shutdown_weee_scraper", record_async("stop_browser"))
    monkeypatch.setattr(main, "dispose_engine", record_async("dispose_engine"))

    async with main.lifespan(SimpleNamespace()):  # type: ignore[arg-type]
        assert events == ["init_engine", "start_admission", "start_scheduler"]

    assert events == [
        "init_engine",
        "start_admission",
        "start_scheduler",
        "stop_scheduler",
        "stop_admission",
        "stop_warmer",
        "stop_live",
        "stop_browser",
        "dispose_engine",
    ]


@pytest.mark.asyncio
async def test_database_engine_disposal_is_idempotent(monkeypatch: pytest.MonkeyPatch):
    calls = 0

    class Engine:
        async def dispose(self) -> None:
            nonlocal calls
            calls += 1

    monkeypatch.setattr(db_session, "_engine", Engine())
    monkeypatch.setattr(db_session, "async_session_maker", object())

    await db_session.dispose_engine()
    await db_session.dispose_engine()

    assert calls == 1
    assert db_session._engine is None
    assert db_session.async_session_maker is None


@pytest.mark.asyncio
async def test_database_disposal_timeout_keeps_owned_task_and_coherent_factory_until_success(
    monkeypatch: pytest.MonkeyPatch,
):
    started = asyncio.Event()
    cancelled = asyncio.Event()
    release = asyncio.Event()

    class Engine:
        async def dispose(self) -> None:
            started.set()
            try:
                await release.wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise

    engine = Engine()
    maker = object()
    monkeypatch.setattr(db_session, "_engine", engine)
    monkeypatch.setattr(db_session, "async_session_maker", maker)
    monkeypatch.setattr(db_session, "DB_DISPOSE_TIMEOUT_SECONDS", 0.01)

    await db_session.dispose_engine()

    assert started.is_set()
    assert not cancelled.is_set()
    assert db_session._engine is engine
    assert db_session.async_session_maker is maker
    assert db_session._engine_dispose_task is not None
    assert not db_session._engine_dispose_task.done()
    with pytest.raises(RuntimeError, match="disposal is still running"):
        db_session.init_engine()

    release.set()
    await db_session.dispose_engine()
    assert db_session._engine is None
    assert db_session._engine_dispose_task is None
    assert db_session.async_session_maker is None


@pytest.mark.asyncio
async def test_database_disposal_caller_cancellation_does_not_cancel_owned_dispose(
    monkeypatch: pytest.MonkeyPatch,
):
    started = asyncio.Event()
    child_cancelled = asyncio.Event()
    release = asyncio.Event()

    class Engine:
        async def dispose(self) -> None:
            started.set()
            try:
                await release.wait()
            except asyncio.CancelledError:
                child_cancelled.set()
                raise

    engine = Engine()
    maker = object()
    monkeypatch.setattr(db_session, "_engine", engine)
    monkeypatch.setattr(db_session, "async_session_maker", maker)
    monkeypatch.setattr(db_session, "DB_DISPOSE_TIMEOUT_SECONDS", 1.0)

    caller = asyncio.create_task(db_session.dispose_engine())
    await started.wait()
    caller.cancel()
    with pytest.raises(asyncio.CancelledError):
        await caller
    await asyncio.sleep(0)

    assert not child_cancelled.is_set()
    assert db_session._engine is engine
    assert db_session.async_session_maker is maker
    assert db_session._engine_dispose_task is not None

    release.set()
    await db_session.dispose_engine()
    assert db_session._engine is None
    assert db_session.async_session_maker is None


@pytest.mark.asyncio
async def test_cancelled_dispose_child_restores_coherent_state_and_can_retry(
    monkeypatch: pytest.MonkeyPatch,
):
    started = asyncio.Event()
    calls = 0

    class Engine:
        async def dispose(self) -> None:
            nonlocal calls
            calls += 1
            if calls == 1:
                started.set()
                await asyncio.Event().wait()

    engine = Engine()
    maker = object()
    monkeypatch.setattr(db_session, "_engine", engine)
    monkeypatch.setattr(db_session, "async_session_maker", maker)
    monkeypatch.setattr(db_session, "DB_DISPOSE_TIMEOUT_SECONDS", 0.01)

    await db_session.dispose_engine()
    await started.wait()
    owned = db_session._engine_dispose_task
    assert owned is not None
    owned.cancel()
    await asyncio.sleep(0)
    await asyncio.sleep(0)

    assert db_session._engine is engine
    assert db_session.async_session_maker is maker
    assert db_session._engine_dispose_task is None
    db_session.init_engine()
    assert db_session.async_session_maker is maker

    await db_session.dispose_engine()
    assert calls == 2
    assert db_session._engine is None
    assert db_session.async_session_maker is None


@pytest.mark.asyncio
async def test_failed_database_disposal_restores_coherent_state_and_retry_succeeds(
    monkeypatch: pytest.MonkeyPatch,
):
    calls = 0

    class Engine:
        async def dispose(self) -> None:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("dispose failed")

    engine = Engine()
    maker = object()
    monkeypatch.setattr(db_session, "_engine", engine)
    monkeypatch.setattr(db_session, "async_session_maker", maker)

    with pytest.raises(RuntimeError, match="dispose failed"):
        await db_session.dispose_engine()

    assert db_session._engine is engine
    assert db_session.async_session_maker is maker
    assert db_session._engine_dispose_task is None
    db_session.init_engine()
    assert db_session.async_session_maker is maker

    await db_session.dispose_engine()
    assert calls == 2
    assert db_session._engine is None
    assert db_session.async_session_maker is None


@pytest.mark.asyncio
async def test_lifespan_runs_all_cleanup_phases_after_an_earlier_error(
    monkeypatch: pytest.MonkeyPatch,
):
    events: list[str] = []

    monkeypatch.setattr(main, "init_engine", lambda: None)
    monkeypatch.setattr(main, "start_live_lookup_admission", lambda: None)
    monkeypatch.setattr(main, "start_scheduler", lambda: None)
    monkeypatch.setattr(main, "stop_scheduler", lambda: events.append("scheduler"))
    monkeypatch.setattr(main, "stop_live_lookup_admission", lambda: events.append("admission"))

    async def fail_warmer() -> None:
        events.append("warmer")
        raise RuntimeError("warmer cleanup failed")

    async def record(name: str) -> None:
        events.append(name)

    monkeypatch.setattr(main, "shutdown_cache_warmer", fail_warmer)
    monkeypatch.setattr(main, "shutdown_live_lookups", lambda: record("live"))
    monkeypatch.setattr(main, "shutdown_weee_scraper", lambda: record("browser"))
    monkeypatch.setattr(main, "dispose_engine", lambda: record("database"))

    with pytest.raises(RuntimeError, match="warmer cleanup failed"):
        async with main.lifespan(SimpleNamespace()):  # type: ignore[arg-type]
            pass

    assert events == [
        "scheduler",
        "admission",
        "warmer",
        "live",
        "browser",
        "database",
    ]


@pytest.mark.asyncio
async def test_lifespan_finishes_later_cleanup_before_propagating_caller_cancellation(
    monkeypatch: pytest.MonkeyPatch,
):
    events: list[str] = []
    warmer_started = asyncio.Event()

    monkeypatch.setattr(main, "init_engine", lambda: None)
    monkeypatch.setattr(main, "start_live_lookup_admission", lambda: None)
    monkeypatch.setattr(main, "start_scheduler", lambda: None)
    monkeypatch.setattr(main, "stop_scheduler", lambda: events.append("scheduler"))
    monkeypatch.setattr(main, "stop_live_lookup_admission", lambda: events.append("admission"))

    async def wait_warmer() -> None:
        events.append("warmer")
        warmer_started.set()
        await asyncio.Event().wait()

    async def record(name: str) -> None:
        events.append(name)

    monkeypatch.setattr(main, "shutdown_cache_warmer", wait_warmer)
    monkeypatch.setattr(main, "shutdown_live_lookups", lambda: record("live"))
    monkeypatch.setattr(main, "shutdown_weee_scraper", lambda: record("browser"))
    monkeypatch.setattr(main, "dispose_engine", lambda: record("database"))

    context = main.lifespan(SimpleNamespace())  # type: ignore[arg-type]
    await context.__aenter__()
    closing = asyncio.create_task(context.__aexit__(None, None, None))
    await warmer_started.wait()
    closing.cancel()
    with pytest.raises(asyncio.CancelledError):
        await closing

    assert events == [
        "scheduler",
        "admission",
        "warmer",
        "live",
        "browser",
        "database",
    ]
