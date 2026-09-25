"""Cost reporting uses mocked AWS calls only; never contact billing or metadata."""
import asyncio
import importlib
import threading
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI


def modules():
    assert importlib.util.find_spec("app.services.infrastructure_costs") is not None, "Infrastructure cost service missing"
    return importlib.import_module("app.services.infrastructure_costs"), importlib.import_module("app.api.routes_infrastructure_costs")


def aws_page(groups=None, token=None):
    result = {"ResultsByTime": [{
        "TimePeriod": {"Start": "2026-09-01", "End": "2026-09-26"},
        "Estimated": True,
        "Total": {},
        "Groups": groups if groups is not None else [
            {"Keys": ["Amazon ECS"], "Metrics": {"UnblendedCost": {"Amount": "14.625", "Unit": "USD"}}},
            {"Keys": ["Credits"], "Metrics": {"UnblendedCost": {"Amount": "-2.5", "Unit": "USD"}}},
            {"Keys": ["Amazon RDS"], "Metrics": {"UnblendedCost": {"Amount": "11", "Unit": "USD"}}},
        ],
    }]}
    if token:
        result["NextPageToken"] = token
    return result


@pytest.fixture
def setup(monkeypatch):
    service, routes = modules()
    from app.core.config import settings
    monkeypatch.setattr(settings, "AWS_REGION", "us-east-1")
    now = [datetime(2026, 9, 25, 19, tzinfo=timezone.utc)]
    clock = [100.0]
    monkeypatch.setattr(service, "utcnow", lambda: now[0])
    monkeypatch.setattr(service, "monotonic", lambda: clock[0])
    calls = []
    options = []
    closed = []
    def fetch(**kwargs):
        calls.append(kwargs)
        response = aws_page()
        response["ResultsByTime"][0]["TimePeriod"] = kwargs["TimePeriod"]
        return response
    client = SimpleNamespace(get_cost_and_usage=fetch, close=lambda: closed.append(True))
    def create_client(*args, **kwargs):
        options.append((args, kwargs))
        return client
    monkeypatch.setattr(service.boto3, "client", create_client)
    reporter = service.InfrastructureCostReporter()
    monkeypatch.setattr(routes, "reporter", reporter)
    return SimpleNamespace(service=service, routes=routes, reporter=reporter, now=now, clock=clock,
                           calls=calls, options=options, closed=closed, client=client, settings=settings)


@pytest.mark.asyncio
async def test_report_sums_decimal_costs_including_credits_and_labels_account_scope(setup):
    report = await setup.reporter.get()
    assert report["status"] == "available"
    assert report["scope"] == "aws_account"
    assert report["total_usd"] == "23.125"
    assert report["services"] == [
        {"service": "Amazon ECS", "cost_usd": "14.625"},
        {"service": "Amazon RDS", "cost_usd": "11"},
        {"service": "Credits", "cost_usd": "-2.5"},
    ]
    assert report["month_utc"] == "2026-09-01"
    assert report["through"] == "2026-09-25"
    assert report["fetched_at"] == "2026-09-25T19:00:00+00:00"
    assert report["estimated"] is True
    assert report["unavailable_reason"] is None
    assert setup.calls == [{"TimePeriod": {"Start": "2026-09-01", "End": "2026-09-26"},
                            "Granularity": "MONTHLY", "Metrics": ["UnblendedCost"],
                            "GroupBy": [{"Type": "DIMENSION", "Key": "SERVICE"}]}]
    args, config = setup.options[0]
    assert args == ("ce",)
    assert config["region_name"] == "us-east-1"
    assert set(config) == {"region_name", "config"}  # Ambient role credentials only.
    assert config["config"].connect_timeout <= 3
    assert config["config"].read_timeout <= 5
    assert config["config"].retries["total_max_attempts"] == 1
    assert setup.closed == [True]


@pytest.mark.asyncio
async def test_concurrent_readers_share_one_call_even_when_one_reader_is_cancelled(setup):
    entered, release = threading.Event(), threading.Event()
    def delayed(**kwargs):
        setup.calls.append(kwargs)
        entered.set()
        assert release.wait(timeout=5)
        return aws_page()
    setup.client.get_cost_and_usage = delayed
    first = asyncio.create_task(setup.reporter.get())
    second = asyncio.create_task(setup.reporter.get())
    assert await asyncio.to_thread(entered.wait, 2)
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    release.set()
    report = await second
    assert report["total_usd"] == "23.125"
    assert len(setup.calls) == 1
    assert (await setup.reporter.get())["total_usd"] == "23.125"
    assert len(setup.calls) == 1


@pytest.mark.asyncio
async def test_success_cache_expires_after_six_hours_and_refreshes_on_day_rollover(setup):
    await setup.reporter.get()
    setup.clock[0] += 6 * 3600 - 1
    await setup.reporter.get()
    assert len(setup.calls) == 1
    setup.clock[0] += 2
    await setup.reporter.get()
    assert len(setup.calls) == 2
    setup.now[0] = datetime(2026, 9, 26, tzinfo=timezone.utc)
    await setup.reporter.get()
    assert len(setup.calls) == 3
    setup.now[0] = datetime(2026, 10, 1, tzinfo=timezone.utc)
    report = await setup.reporter.get()
    assert report["month_utc"] == "2026-10-01"
    assert setup.calls[-1]["TimePeriod"] == {"Start": "2026-10-01", "End": "2026-10-02"}


@pytest.mark.asyncio
async def test_error_is_unavailable_without_zero_or_sensitive_details_and_has_cooldown(setup, caplog):
    def denied(**kwargs):
        setup.calls.append(kwargs)
        raise RuntimeError("secret token and account billing details")
    setup.client.get_cost_and_usage = denied
    result = await setup.reporter.get()
    assert result["status"] == "unavailable"
    assert result["total_usd"] is None
    assert result["estimated"] is None
    assert result["services"] == []
    assert "secret" not in str(result) + caplog.text
    await setup.reporter.get()
    assert len(setup.calls) == 1
    setup.clock[0] += 301
    await setup.reporter.get()
    assert len(setup.calls) == 2


@pytest.mark.asyncio
async def test_missing_region_never_creates_an_aws_client(setup, monkeypatch):
    monkeypatch.setattr(setup.settings, "AWS_REGION", "")
    result = await setup.reporter.get()
    assert result["status"] == "unavailable"
    assert result["unavailable_reason"] == "not_configured"
    assert result["total_usd"] is None
    assert setup.options == []


@pytest.mark.asyncio
async def test_fetch_deadline_returns_unavailable_and_cooldown_prevents_duplicate_queries(setup, monkeypatch):
    release = threading.Event()
    def delayed(**kwargs):
        setup.calls.append(kwargs)
        assert release.wait(timeout=2)
        return aws_page()
    setup.client.get_cost_and_usage = delayed
    monkeypatch.setattr(setup.service, "FETCH_TIMEOUT_SECONDS", 0.01)
    try:
        result = await setup.reporter.get()
        assert result["status"] == "unavailable"
        assert result["total_usd"] is None
        assert (await setup.reporter.get())["status"] == "unavailable"
        assert len(setup.calls) == 1
    finally:
        release.set()


@pytest.mark.asyncio
async def test_explicit_zero_bill_is_available_and_distinct_from_missing_data(setup):
    response = aws_page(groups=[])
    response["ResultsByTime"][0]["Total"] = {"UnblendedCost": {"Amount": "0.00", "Unit": "USD"}}
    setup.client.get_cost_and_usage = lambda **kwargs: response
    result = await setup.reporter.get()
    assert result["status"] == "available"
    assert result["total_usd"] == "0"
    assert result["unavailable_reason"] is None


@pytest.mark.asyncio
async def test_all_pages_are_aggregated_and_unbounded_pagination_is_unavailable(setup):
    pages = [aws_page(token="page2"), aws_page(groups=[
        {"Keys": ["Amazon S3"], "Metrics": {"UnblendedCost": {"Amount": "1.25", "Unit": "USD"}}},
    ])]
    def paginated(**kwargs):
        setup.calls.append(kwargs)
        return pages.pop(0)
    setup.client.get_cost_and_usage = paginated
    assert (await setup.reporter.get())["total_usd"] == "24.375"
    assert setup.calls[1]["NextPageToken"] == "page2"
    setup.clock[0] += 6 * 3600 + 1
    setup.client.get_cost_and_usage = lambda **kwargs: aws_page(token="repeated")
    result = await setup.reporter.get()
    assert result["status"] == "unavailable"
    assert result["total_usd"] is None


@pytest.mark.asyncio
async def test_more_than_three_pages_does_not_report_a_partial_total(setup):
    def endless(**kwargs):
        setup.calls.append(kwargs)
        return aws_page(token=f"page{len(setup.calls) + 1}")
    setup.client.get_cost_and_usage = endless
    result = await setup.reporter.get()
    assert result["status"] == "unavailable"
    assert result["total_usd"] is None
    assert len(setup.calls) == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("data", [{}, {"ResultsByTime": []}, aws_page(groups=[
    {"Keys": ["Amazon S3"], "Metrics": {"UnblendedCost": {"Amount": "NaN", "Unit": "USD"}}},
]), aws_page(groups=[
    {"Keys": ["Amazon S3"], "Metrics": {"UnblendedCost": {"Amount": "1", "Unit": "EUR"}}},
])])
async def test_missing_or_invalid_billing_data_never_looks_like_zero(setup, data):
    setup.client.get_cost_and_usage = lambda **kwargs: data
    report = await setup.reporter.get()
    assert report["status"] == "unavailable"
    assert report["total_usd"] is None


@pytest.mark.asyncio
async def test_route_requires_admin_and_does_not_cache_private_billing_publicly(setup, monkeypatch):
    from app.api.auth import get_current_user
    from app.db.session import get_session
    app = FastAPI()
    app.include_router(setup.routes.router)
    session_closed = []
    async def close_session():
        session_closed.append(True)
    session = SimpleNamespace(close=close_session)
    app.dependency_overrides[get_session] = lambda: session
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/admin/infrastructure-costs")).status_code == 401
        account_id = uuid4()
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=account_id)
        monkeypatch.setattr(setup.settings, "ADMIN_USER_IDS", "")
        assert (await client.get("/admin/infrastructure-costs")).status_code == 403
        assert setup.calls == []
        assert session_closed == []
        monkeypatch.setattr(setup.settings, "ADMIN_USER_IDS", str(account_id))
        fetch = setup.client.get_cost_and_usage
        def fetch_without_database_connection(**kwargs):
            assert session_closed == [True]
            return fetch(**kwargs)
        setup.client.get_cost_and_usage = fetch_without_database_connection
        response = await client.get("/admin/infrastructure-costs")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert response.json()["total_usd"] == "23.125"
