import httpx
import pytest

from app.main import app
from app.db.session import get_session


@pytest.mark.asyncio
async def test_validation_response_never_echoes_submitted_password():
    password = "SYNTHETIC-PRIVATE-PASSWORD-" * 80
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_session] = lambda: object()
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api") as client:
            response = await client.post("/auth/login", json={"email": "test@example.com", "password": password})
        assert response.status_code == 422
        assert "SYNTHETIC-PRIVATE-PASSWORD" not in response.text
        assert response.json()["detail"][0]["loc"] == ["body", "password"]
        assert "input" not in response.json()["detail"][0]
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)
