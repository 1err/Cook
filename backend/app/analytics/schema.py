from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MEANINGFUL = (
    "page_view",
    "recipe_saved",
    "meal_planned",
    "cooking_started",
    "cooking_completed",
    "retailer_handoff",
    "retailer_link_created",
)
SERVER_EVENTS = (
    "registered",
    "login",
    "recipe_saved",
    "meal_planned",
    "cooking_started",
    "cooking_completed",
    "retailer_link_created",
)
ROOT_PATHS = {
    "/",
    "/about",
    "/contact",
    "/privacy",
    "/terms",
    "/login",
    "/register",
    "/library",
    "/library/friends",
    "/import",
    "/planner",
    "/shopping-list",
    "/cook",
    "/settings",
}


def normalize_path(value: str | None) -> str | None:
    path = urlsplit(value or "").path.rstrip("/") or "/"
    if path in ROOT_PATHS:
        return path
    for pattern, label in (
        (r"/library/friends/[^/]+/[^/]+", "/library/friends/:user/:recipe"),
        (r"/library/friends/[^/]+", "/library/friends/:user"),
        (r"/library/[^/]+", "/library/:id"),
        (r"/recipe/[^/]+/tutorial/edit", "/recipe/:id/tutorial/edit"),
        (r"/recipe/[^/]+", "/recipe/:id"),
    ):
        if re.fullmatch(pattern, path):
            return label
    return None


def normalize_referrer(value: str | None) -> str | None:
    try:
        url = urlsplit(value or "")
        host = url.hostname
        if url.scheme not in ("http", "https") or not host or len(host) > 253:
            return None
        return host.lower()
    except ValueError:
        return None


def csv_safe(value) -> str:
    value = "" if value is None else str(value)
    return (
        "'" + value
        if value.lstrip().startswith(("=", "+", "-", "@"))
        or value.startswith(("\t", "\r", "\n"))
        else value
    )


class ClientEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Literal["page_view", "retailer_handoff"]
    event_id: UUID
    visitor_id: UUID
    session_id: UUID
    path: str = Field(default="/", max_length=500)
    referrer: str | None = Field(default=None, max_length=500)
    source: str | None = Field(default=None, max_length=64)
    medium: str | None = Field(default=None, max_length=64)
    campaign: str | None = Field(default=None, max_length=64)
    device: Literal["desktop", "tablet", "mobile", "unknown"] = "unknown"
    browser: Literal["Chrome", "Safari", "Firefox", "Edge", "Other"] = "Other"
    retailer: Literal["weee", "instacart"] | None = None

    @field_validator("source", "medium", "campaign")
    @classmethod
    def campaign_identifier(cls, value):
        if value and not re.fullmatch(r"[A-Za-z0-9 _.-]{1,64}", value):
            raise ValueError(
                "Use a short campaign identifier, without personal data or URLs"
            )
        return value or None


class DateRange(BaseModel):
    start: date
    end: date
    include_internal: bool = False

    @model_validator(mode="after")
    def valid_window(self):
        if not 1 <= self.days <= 90:
            raise ValueError("Choose a date range between 1 and 90 days")
        return self

    @property
    def days(self):
        return (self.end - self.start).days + 1

    @property
    def bounds(self):
        return datetime.combine(self.start, time.min, timezone.utc), datetime.combine(
            self.end + timedelta(days=1), time.min, timezone.utc
        )
