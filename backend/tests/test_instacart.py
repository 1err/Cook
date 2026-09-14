from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from pydantic import SecretStr

from app.api.auth import get_current_user
from app.api.routes_instacart import InstacartRequest, router
from app.services import instacart_service as service

URL = "https://www.instacart.com/store/recipes/123?affiliate=test"


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(service.settings, "INSTACART_API_KEY", SecretStr("test-key"))
    monkeypatch.setattr(service.settings, "INSTACART_ENVIRONMENT", "development")


def mock_provider(monkeypatch, handler):
    factory = httpx.AsyncClient
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(service, "provider_client", lambda: factory(transport=transport, timeout=15, follow_redirects=False))


def body():
    return InstacartRequest(title="Cooking groceries", items=[
        {"name": "rice", "quantity": "1 1/2 cups"},
        {"name": "ginger", "quantity": "1 thumb-sized piece"},
        {"name": "salt", "quantity": "to taste"},
    ])


@pytest.mark.asyncio
async def test_official_payload_preserves_freeform_quantities(monkeypatch, configured):
    import json
    def handle(request):
        assert str(request.url) == "https://connect.dev.instacart.tools/idp/v1/products/products_link"
        assert request.headers["authorization"] == "Bearer test-key"
        data = json.loads(request.content)
        assert data["link_type"] == "shopping_list"
        assert data["expires_in"] == 7
        assert data["line_items"][0] == {"name": "rice", "display_text": "rice — 1 1/2 cups", "line_item_measurements": [{"quantity": 1.5, "unit": "cup"}]}
        assert data["line_items"][1] == {"name": "ginger", "display_text": "ginger — 1 thumb-sized piece"}
        assert data["line_items"][2] == {"name": "salt", "display_text": "salt — to taste"}
        return httpx.Response(200, json={"products_link_url": URL})
    mock_provider(monkeypatch, handle)
    assert await service.create_shopping_link(body()) == URL


@pytest.mark.asyncio
async def test_missing_key_makes_no_provider_call(monkeypatch):
    monkeypatch.setattr(service.settings, "INSTACART_API_KEY", None)
    monkeypatch.setattr(service, "provider_client", lambda: pytest.fail("must not call provider"))
    with pytest.raises(service.InstacartError) as exc:
        await service.create_shopping_link(body())
    assert exc.value.code == "instacart_not_configured"
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_production_uses_only_the_official_production_origin(monkeypatch, configured):
    monkeypatch.setattr(service.settings, "INSTACART_ENVIRONMENT", "production")
    def handle(request):
        assert str(request.url) == "https://connect.instacart.com/idp/v1/products/products_link"
        return httpx.Response(200, json={"products_link_url": URL})
    mock_provider(monkeypatch, handle)
    assert await service.create_shopping_link(body()) == URL


@pytest.mark.asyncio
async def test_missing_setup_http_response_has_a_safe_typed_error(monkeypatch):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="test-user")
    monkeypatch.setattr(service.settings, "INSTACART_API_KEY", None)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/shopping-list/instacart", json=body().model_dump())
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "instacart_not_configured"
    assert "url" not in response.json()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["bad_json", "network"])
async def test_unusable_provider_responses_do_not_leak_details(monkeypatch, configured, failure):
    def handle(request):
        if failure == "network":
            raise httpx.ConnectError("sensitive provider test-key", request=request)
        return httpx.Response(200, text="sensitive provider test-key")
    mock_provider(monkeypatch, handle)
    with pytest.raises(service.InstacartError) as exc:
        await service.create_shopping_link(body())
    assert exc.value.code == ("instacart_invalid_response" if failure == "bad_json" else "instacart_unavailable")
    assert "test-key" not in str(exc.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("status,code,app_status", [(401,"instacart_not_configured",503),(403,"instacart_not_configured",503),(429,"instacart_rate_limited",429),(500,"instacart_unavailable",502),(302,"instacart_unavailable",502)])
async def test_provider_errors_are_sanitized(monkeypatch, configured, status, code, app_status):
    mock_provider(monkeypatch, lambda r: httpx.Response(status, text="secret provider details test-key"))
    with pytest.raises(service.InstacartError) as exc:
        await service.create_shopping_link(body())
    assert exc.value.code == code
    assert exc.value.status_code == app_status
    assert "test-key" not in str(exc.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [{}, {"products_link_url":"https://evil.test/cart"}, {"products_link_url":"https://u@www.instacart.com/store/1"}, {"products_link_url":"https://www.instacart.com:8443/store/1"}, {"products_link_url":"https://www.instacart.com\\@evil.test/1"}, {"products_link_url":URL+"\n"}, {"products_link_url":7}, []])
async def test_malformed_result_fails_closed(monkeypatch, configured, payload):
    mock_provider(monkeypatch, lambda r: httpx.Response(200, json=payload))
    with pytest.raises(service.InstacartError) as exc:
        await service.create_shopping_link(body())
    assert exc.value.code == "instacart_invalid_response"


@pytest.mark.asyncio
async def test_timeout_is_retryable(monkeypatch, configured):
    def handle(request):
        raise httpx.ReadTimeout("sensitive upstream", request=request)
    mock_provider(monkeypatch, handle)
    with pytest.raises(service.InstacartError) as exc:
        await service.create_shopping_link(body())
    assert exc.value.code == "instacart_timeout"


@pytest.mark.asyncio
async def test_route_auth_and_validation(monkeypatch):
    app = FastAPI()
    app.include_router(router)
    create = AsyncMock(return_value=URL)
    monkeypatch.setattr(service, "create_shopping_link", create)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.post("/shopping-list/instacart", json=body().model_dump())).status_code == 401
        create.assert_not_awaited()
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="test-user")
        for items in [[], [{"name":"  ","quantity":"1"}], [{"name":"rice","quantity":"1"}] * 101]:
            assert (await client.post("/shopping-list/instacart", json={"title":"List","items":items})).status_code == 422
        response = await client.post("/shopping-list/instacart", json=body().model_dump())
        assert response.status_code == 200
        assert response.json() == {"url":URL}


@pytest.mark.parametrize("text,expected", [("2 tbsp", (2,"tablespoon")), ("½ kg",(0.5,"kg")), ("6",(6,"each")), ("2 cans",(2,"can")), ("2 cups + 50 g",None), ("1-2 lb",None), ("to taste",None), ("0 cups",None), ("1/0 cup",None), ("1 bag",None)])
def test_measurements_only_when_unambiguous(text, expected):
    assert service.parse_measurement(text) == expected
