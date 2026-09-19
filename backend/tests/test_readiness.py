import httpx
import pytest
from unittest.mock import AsyncMock

from app import main
from test_postgres_integrations import pg_sessions


@pytest.mark.asyncio
@pytest.mark.parametrize("ready, status", [(True, 200), (False, 503)])
async def test_readiness_status_tracks_required_database_schema(monkeypatch, ready, status):
    monkeypatch.setattr(main, "database_ready", AsyncMock(return_value=ready), raising=False)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        response = await client.get("/ready")
    assert response.status_code == status
    assert response.json() == {"status": "ready" if ready else "not_ready"}


@pytest.mark.asyncio
async def test_actual_migrated_schema_is_ready(pg_sessions, monkeypatch):
    from app.core import readiness
    monkeypatch.setattr(readiness.db, "async_session_maker", pg_sessions)
    assert await readiness.database_ready() is True
