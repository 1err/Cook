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
