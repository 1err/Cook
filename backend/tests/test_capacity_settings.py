from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def settings(**overrides):
    return Settings(_env_file=None, DATABASE_URL="postgresql+asyncpg://test:test@localhost/test",
                    **overrides)


def test_connection_budget_accounts_for_rollout_overlap_and_workers():
    with pytest.raises(ValidationError, match="connection budget"):
        settings(DB_POOL_SIZE=10, DB_MAX_OVERFLOW=5, DB_MAX_API_REPLICAS=2,
                 DB_MAX_WORKER_REPLICAS=1, DB_CONNECTION_BUDGET=50)


def test_connection_budget_counts_supervisor_and_migration_separately():
    # Pools 6 + worker supervisor 1 + migration 1 + administration 4 = 12.
    values = dict(DB_POOL_SIZE=2, DB_MAX_OVERFLOW=0, DB_MAX_API_REPLICAS=2,
                  DB_MAX_WORKER_REPLICAS=1, DB_DEPLOYMENT_SURGE_FACTOR=1,
                  DB_ADMIN_CONNECTION_RESERVE=4)
    with pytest.raises(ValidationError, match="connection budget"):
        settings(**values, DB_CONNECTION_BUDGET=10)
    assert settings(**values, DB_CONNECTION_BUDGET=12)


def test_ai_allocation_is_independent_of_legacy_hosting_estimates():
    configured = settings(OPERATING_MONTHLY_BUDGET_USD="150", HOSTING_MONTHLY_RESERVE_USD="150",
                          AI_MONTHLY_BUDGET_USD="29", AI_ACCOUNT_MONTHLY_BUDGET_USD="3")
    assert configured.AI_MONTHLY_BUDGET_USD == Decimal("29")


@pytest.mark.parametrize("amount", ["30.000000001", "150", "1000000"])
def test_ai_allocation_above_thirty_dollars_is_rejected(amount):
    with pytest.raises(ValidationError):
        settings(HOSTING_MONTHLY_RESERVE_USD="0", AI_MONTHLY_BUDGET_USD=amount)


def test_explicit_beta_overlay_loads_reviewed_allowance_and_model_prices():
    from pathlib import Path
    from app.core.ai_cost import configured_price
    configured = Settings(_env_file=Path(__file__).resolve().parents[1] / '.env.beta.example',
                          DATABASE_URL='postgresql+asyncpg://test:test@localhost/test', APP_ENV='test')
    price = configured_price(configured)
    assert configured.AI_MONTHLY_BUDGET_USD == Decimal('29')
    assert configured.AI_ACCOUNT_MONTHLY_BUDGET_USD == Decimal('3')
    assert price.model == 'gpt-6-luna'
    assert (price.input_usd_per_million, price.output_usd_per_million) == (Decimal('.125'), Decimal('.50'))


def test_production_uses_shared_jobs_and_default_zero_ai_allocation():
    configured = settings(APP_ENV="production", AUTH_SECRET="x" * 40,
                          COOKIE_SECURE=True, CORS_ALLOW_ORIGINS="https://example.com", TRUSTED_PROXY_CIDRS="10.20.1.0/24")
    assert configured.STORE_JOBS_MODE == "durable"
    assert configured.AI_MONTHLY_BUDGET_USD == 0
    assert configured.ABUSE_LIMITS_ENABLED is True


def test_job_lease_must_outlive_execution_and_cleanup():
    with pytest.raises(ValidationError, match="lease"):
        settings(STORE_JOBS_LEASE_SECONDS=130, STORE_JOBS_TIMEOUT_SECONDS=125)


def test_invalid_money_and_unbounded_waits_are_rejected():
    for values in ({"AI_MONTHLY_BUDGET_USD": "NaN"}, {"DB_POOL_TIMEOUT_SECONDS": 0},
                   {"DB_STATEMENT_TIMEOUT_MS": 0}, {"AI_OPERATION_TIMEOUT_SECONDS": 10000}):
        with pytest.raises(ValidationError):
            settings(**values)


def test_production_cannot_disable_shared_admission():
    with pytest.raises(ValidationError, match="admission"):
        settings(APP_ENV="production", AUTH_SECRET="x" * 40, COOKIE_SECURE=True,
                 CORS_ALLOW_ORIGINS="https://example.com", TRUSTED_PROXY_CIDRS="10.20.1.0/24", ABUSE_LIMITS_ENABLED=False)
