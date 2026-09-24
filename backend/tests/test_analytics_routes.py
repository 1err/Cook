from types import SimpleNamespace
from uuid import uuid4
import pytest
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

from app.api import admin_analytics, analytics, auth
from app.core.config import settings
from app.db.session import get_session
from app.analytics import repository


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path",
    ["overview", "users", "users.csv", "users/00000000-0000-4000-8000-000000000001"],
)
async def test_every_report_rejects_anonymous_and_non_admin(path, monkeypatch):
    app = FastAPI()
    app.include_router(admin_analytics.router)

    async def session():
        yield object()

    app.dependency_overrides[get_session] = session
    monkeypatch.setattr(settings, "ADMIN_USER_IDS", str(uuid4()))
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/admin/analytics/" + path)).status_code == 401
        app.dependency_overrides[auth.get_current_user] = lambda: SimpleNamespace(
            id=uuid4()
        )
        assert (await client.get("/admin/analytics/" + path)).status_code == 403


@pytest.mark.asyncio
async def test_test_status_change_requires_admin(monkeypatch):
    app = FastAPI()
    app.include_router(admin_analytics.router)

    async def session():
        yield object()

    app.dependency_overrides[get_session] = session
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (
            await client.patch(
                "/admin/analytics/users/" + str(uuid4()) + "/test-status",
                json={"is_test": True},
            )
        ).status_code == 401


@pytest.mark.asyncio
async def test_collection_failure_does_not_propagate(monkeypatch):
    class Broken:
        def begin(self):
            raise RuntimeError("Storage unavailable")

    monkeypatch.setattr(repository.db, "async_session_maker", Broken())
    assert await repository.safe_record({"name": "login"}) is False


@pytest.mark.asyncio
async def test_client_cannot_submit_user_id_or_server_conversion():
    app = FastAPI()
    app.include_router(analytics.router)

    async def session():
        yield object()

    app.dependency_overrides[get_session] = session
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.post(
            "/analytics/events",
            json={
                "name": "registered",
                "event_id": str(uuid4()),
                "visitor_id": str(uuid4()),
                "session_id": str(uuid4()),
                "user_id": str(uuid4()),
            },
        )
        assert result.status_code == 422


@pytest.mark.asyncio
async def test_middleware_waits_for_commit_and_ignores_failed_requests(monkeypatch):
    from fastapi import Depends, Request, HTTPException
    from app.analytics import middleware

    app = FastAPI()
    app.add_middleware(middleware.AnalyticsMiddleware)
    actor = uuid4()
    committed = []
    recorded = []

    async def transaction():
        yield None
        committed.append(True)

    async def capture(event):
        assert committed, "Collection must run after the business transaction completes"
        recorded.append(event)

    monkeypatch.setattr(middleware, "safe_record", capture)

    @app.post("/auth/login")
    async def login(
        request: Request, transaction=Depends(transaction), fail: bool = False
    ):
        request.state.analytics_user_id = actor
        if fail:
            raise HTTPException(401, "Rejected")
        return {"ok": True}

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.post("/auth/login?fail=true")).status_code == 401
        assert recorded == []
        assert (await client.post("/auth/login")).status_code == 200
        assert len(recorded) == 1
        assert recorded[0]["name"] == "login"
        assert recorded[0]["user_id"] == actor


def test_privacy_headers_remove_browser_attribution_from_operational_events():
    from app.analytics.middleware import browser_context
    from starlette.datastructures import Headers

    assert browser_context(Headers({"dnt": "1", "x-cw-visitor": str(uuid4())})) == {}


@pytest.mark.asyncio
async def test_client_opt_out_returns_without_recording(monkeypatch):
    app = FastAPI()
    app.include_router(analytics.router)

    async def session():
        yield object()

    app.dependency_overrides[get_session] = session

    async def forbidden(*args):
        raise AssertionError("Opted-out traffic must not be recorded")

    monkeypatch.setattr(analytics, "safe_record", forbidden)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.post(
            "/analytics/events",
            headers={"Sec-GPC": "1"},
            json={
                "name": "page_view",
                "event_id": str(uuid4()),
                "visitor_id": str(uuid4()),
                "session_id": str(uuid4()),
                "path": "/library",
            },
        )
        assert result.status_code == 204


@pytest.mark.asyncio
async def test_csv_is_private_and_formula_safe(monkeypatch):
    app = FastAPI()
    app.include_router(admin_analytics.router)
    app.dependency_overrides[admin_analytics.require_admin] = lambda: SimpleNamespace(
        id=uuid4()
    )
    app.dependency_overrides[admin_analytics.reporting_session] = lambda: object()

    async def page(*args):
        return {"total": 1, "items": [{"email": "=danger@example.com"}]}

    monkeypatch.setattr(admin_analytics.reports, "users_page", page)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/admin/analytics/users.csv")
        assert r.status_code == 200
        assert r.headers["cache-control"] == "no-store"
        assert "'=danger@example.com" in r.text
