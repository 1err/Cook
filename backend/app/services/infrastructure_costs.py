"""Cached account-wide AWS billing estimates; never an app allocation or invoice."""
from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import logging
from time import monotonic

import boto3
from botocore.config import Config

from app.core.config import settings

logger = logging.getLogger(__name__)
CACHE_SECONDS = 6 * 60 * 60
ERROR_COOLDOWN_SECONDS = 5 * 60
FETCH_TIMEOUT_SECONDS = 25
MAX_PAGES = 3


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _base(now: datetime) -> dict:
    return {
        "provider": "aws",
        "scope": "aws_account",
        "scope_description": "AWS account-wide; includes resources outside this app. Unblended costs include credits and refunds.",
        "month_utc": now.date().replace(day=1).isoformat(),
        "through": now.date().isoformat(),
        "fetched_at": None,
        "currency": "USD",
        "metric": "UnblendedCost",
    }


def _unavailable(now: datetime, reason: str) -> dict:
    return {**_base(now), "status": "unavailable", "estimated": None,
            "total_usd": None, "services": [], "unavailable_reason": reason}


def _amount(metric: dict) -> Decimal:
    if metric.get("Unit") != "USD":
        raise ValueError("Unsupported billing currency")
    amount = Decimal(metric["Amount"])
    if not amount.is_finite():
        raise ValueError("Invalid billing amount")
    # Negative refunds/credits are real costs and must remain in the total.
    return amount


def _fetch_aws(now: datetime) -> dict:
    period = {"Start": now.date().replace(day=1).isoformat(),
              "End": (now.date() + timedelta(days=1)).isoformat()}
    # Cost Explorer is global in the commercial partition. Credentials come
    # from boto3's ambient ECS role chain, with no cloud credentials in config.
    client = boto3.client("ce", region_name="us-east-1", config=Config(
        connect_timeout=2, read_timeout=5, retries={"total_max_attempts": 1}))
    costs: dict[str, Decimal] = {}
    estimated = False
    token = None
    seen_tokens = set()
    try:
        for _ in range(MAX_PAGES):
            options = {"TimePeriod": period, "Granularity": "MONTHLY", "Metrics": ["UnblendedCost"],
                       "GroupBy": [{"Type": "DIMENSION", "Key": "SERVICE"}]}
            if token:
                options["NextPageToken"] = token
            result = client.get_cost_and_usage(**options)
            periods = result.get("ResultsByTime")
            if not isinstance(periods, list) or len(periods) != 1:
                raise ValueError("Missing billing period")
            row = periods[0]
            if row.get("TimePeriod") != period or not isinstance(row.get("Estimated"), bool):
                raise ValueError("Unexpected billing period")
            estimated = estimated or row["Estimated"]
            groups = row.get("Groups")
            if not isinstance(groups, list):
                raise ValueError("Missing billing breakdown")
            if not groups:
                # Only an explicit, valid zero can represent a zero bill.
                if _amount(row.get("Total", {}).get("UnblendedCost", {})) != 0:
                    raise ValueError("Missing service breakdown")
            for group in groups:
                names = group.get("Keys")
                if not isinstance(names, list) or len(names) != 1 or not isinstance(names[0], str) or not names[0]:
                    raise ValueError("Invalid billing service")
                amount = _amount(group["Metrics"]["UnblendedCost"])
                costs[names[0]] = costs.get(names[0], Decimal(0)) + amount
            token = result.get("NextPageToken")
            if not token:
                break
            if not isinstance(token, str) or token in seen_tokens:
                raise ValueError("Invalid billing pagination")
            seen_tokens.add(token)
        else:
            raise ValueError("Billing pagination exceeded bounded request count")
    finally:
        client.close()
    return {**_base(now), "status": "available", "estimated": estimated,
            "fetched_at": utcnow().isoformat(), "unavailable_reason": None,
            "total_usd": str(sum(costs.values(), Decimal(0))),
            "services": [{"service": name, "cost_usd": str(amount)} for name, amount in
                         sorted(costs.items(), key=lambda item: (-item[1], item[0]))]}


class InfrastructureCostReporter:
    """One in-flight fetch per process; caller cancellation cannot spend again."""

    def __init__(self):
        self._cache = None
        self._cache_key = None
        self._expires_at = 0.0
        self._inflight = None
        self._inflight_key = None

    async def get(self) -> dict:
        now = utcnow()
        region = settings.AWS_REGION.strip()
        if not region:
            return _unavailable(now, "not_configured")
        key = (region, now.date().replace(day=1), now.date())
        if self._cache_key == key and self._cache is not None and monotonic() < self._expires_at:
            return deepcopy(self._cache)
        if self._inflight is None or self._inflight_key != key:
            self._inflight_key = key
            self._inflight = asyncio.create_task(self._load(now, key))
        return deepcopy(await asyncio.shield(self._inflight))

    async def _load(self, now: datetime, key: tuple) -> dict:
        try:
            result = await asyncio.wait_for(asyncio.to_thread(_fetch_aws, now), timeout=FETCH_TIMEOUT_SECONDS)
            lifetime = CACHE_SECONDS
        except Exception as exc:
            # AWS failures may carry account IDs, request payloads, or credentials.
            logger.warning("infrastructure_costs_unavailable error_type=%s", type(exc).__name__)
            result = _unavailable(now, "billing_unavailable")
            lifetime = ERROR_COOLDOWN_SECONDS
        if self._inflight is asyncio.current_task():
            self._cache = result
            self._cache_key = key
            self._expires_at = monotonic() + lifetime
            self._inflight = None
            self._inflight_key = None
        return result


reporter = InfrastructureCostReporter()
