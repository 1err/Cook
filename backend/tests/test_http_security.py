import httpx
import pytest
from fastapi import FastAPI

from app.core.http_security import HTTPGuardMiddleware


def application():
    app = FastAPI()
    app.add_middleware(HTTPGuardMiddleware, trusted_origins=["https://chef-world.com"],
                       json_limit=32, upload_limit=64)

    @app.post("/write")
    async def write(body: dict):
        return {"ok": True}

    @app.get("/read")
    async def read():
        return {"ok": True}

    return app


@pytest.mark.parametrize("headers,status", [
    ({"cookie": "access_token=opaque", "origin": "https://evil.example"}, 403),
    ({"cookie": "access_token=opaque", "origin": "null"}, 403),
    ({"cookie": "access_token=opaque"}, 403),
    ({"cookie": "access_token=opaque", "origin": "https://chef-world.com"}, 200),
    ({"authorization": "Bearer opaque"}, 200),
    ({"origin": "https://evil.example"}, 403),
    ({}, 200),
])
@pytest.mark.asyncio
async def test_mutations_enforce_browser_origin_without_breaking_native_bearer(headers, status):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application()), base_url="http://api") as client:
        response = await client.post("/write", headers=headers, json={})
    assert response.status_code == status


@pytest.mark.asyncio
async def test_safe_reads_still_work_with_cookies():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application()), base_url="http://api") as client:
        response = await client.get("/read", headers={"cookie": "access_token=opaque"})
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_chunked_body_cannot_bypass_size_limit():
    async def chunks():
        yield b'{"text":"'
        yield b'x' * 40
        yield b'"}'
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application()), base_url="http://api") as client:
        response = await client.post("/write", content=chunks(), headers={"content-type": "application/json"})
    assert response.status_code == 413


@pytest.mark.asyncio
async def test_known_oversized_body_is_rejected_before_parsing():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application()), base_url="http://api") as client:
        response = await client.post("/write", json={"text": "x" * 40})
    assert response.status_code == 413
