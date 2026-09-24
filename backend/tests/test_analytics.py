from datetime import date
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.analytics.schema import (
    ClientEvent,
    normalize_path,
    normalize_referrer,
    DateRange,
    csv_safe,
)
from app.analytics.middleware import classify_operation


def test_client_cannot_forge_identity_or_confirmed_events():
    with pytest.raises(ValidationError):
        ClientEvent(
            name="login",
            user_id=str(uuid4()),
            event_id=uuid4(),
            visitor_id=uuid4(),
            session_id=uuid4(),
        )


def test_dynamic_paths_and_queries_are_not_collected():
    assert (
        normalize_path("/library/secret-recipe?email=private@example.com")
        == "/library/:id"
    )
    assert normalize_path("/admin/dashboard") is None
    assert normalize_path("/unknown/private-text") is None
    assert (
        normalize_referrer("https://example.com/private?token=secret") == "example.com"
    )
    assert normalize_referrer("javascript:alert(1)") is None


def test_ranges_are_bounded_and_inclusive():
    r = DateRange(start=date(2026, 9, 1), end=date(2026, 9, 30))
    assert r.days == 30
    with pytest.raises(ValidationError):
        DateRange(start=date(2026, 9, 30), end=date(2026, 9, 1))
    with pytest.raises(ValidationError):
        DateRange(start=date(2025, 1, 1), end=date(2026, 9, 1))


def test_csv_values_cannot_start_spreadsheet_formulas():
    assert csv_safe("=1+1") == "'=1+1"
    assert csv_safe(" +SUM(A1)") == "' +SUM(A1)"
    assert csv_safe("hello@example.com") == "hello@example.com"


def test_only_successful_meaningful_operations_count():
    assert classify_operation("POST", "/auth/login", 200) == "login"
    assert classify_operation("POST", "/auth/login", 401) is None
    assert classify_operation("GET", "/auth/me", 200) is None
    assert classify_operation("GET", "/cooking-session/active", 200) is None
    assert (
        classify_operation("POST", "/cooking-session/{session_id}/finish", 200)
        == "cooking_completed"
    )


def test_client_metadata_is_strict_and_bounded():
    with pytest.raises(ValidationError):
        ClientEvent(
            name="page_view",
            event_id=uuid4(),
            visitor_id=uuid4(),
            session_id=uuid4(),
            path="x" * 501,
        )
    with pytest.raises(ValidationError):
        ClientEvent(
            name="page_view",
            event_id=uuid4(),
            visitor_id=uuid4(),
            session_id=uuid4(),
            campaign="person@example.com",
        )
