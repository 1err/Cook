from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


@pytest.mark.asyncio
async def test_limits_include_reservations_but_no_credentials():
    from app.api.admin_usage import operating_limits
    session = SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(object_count=3, byte_count=700)))
    result = await operating_limits(session)
    assert result['monthly_budget_usd'] == '150'
    assert result['billing_verified'] is False
    assert result['uploads']['reserved_count'] == 3
    assert result['uploads']['reserved_bytes'] == 700
    assert not any(key in str(result).lower() for key in ('api_key', 'auth_secret', 'database_url'))


def test_operating_routes_require_administrator():
    from app.api.admin import require_admin
    from app.api.admin_usage import router
    assert {route.path for route in router.routes} == {'/admin/ai-usage', '/admin/operating-limits'}
    for route in router.routes:
        assert any(dependency.dependency is require_admin for dependency in route.dependencies)
