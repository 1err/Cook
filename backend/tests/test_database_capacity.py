import pytest

from app.db import session as db


def test_engine_uses_bounded_pool_and_database_timeouts(monkeypatch):
    captured = {}
    sentinel = object()

    def create(url, **kwargs):
        captured.update(kwargs)
        return sentinel

    monkeypatch.setattr(db, "_engine", None)
    monkeypatch.setattr(db, "_engine_dispose_task", None)
    monkeypatch.setattr(db, "create_async_engine", create)
    monkeypatch.setattr(db, "_make_session_maker", lambda engine: object())
    monkeypatch.setattr(db, "async_session_maker", None)
    db.init_engine()
    assert captured.get("pool_size") == db.settings.DB_POOL_SIZE
    assert captured.get("max_overflow") == db.settings.DB_MAX_OVERFLOW
    assert captured.get("pool_timeout") == db.settings.DB_POOL_TIMEOUT_SECONDS
    assert captured.get("pool_pre_ping") is True
    server = captured["connect_args"]["server_settings"]
    assert server["statement_timeout"] == str(db.settings.DB_STATEMENT_TIMEOUT_MS)
    assert server["lock_timeout"] == str(db.settings.DB_LOCK_TIMEOUT_MS)
    assert server["idle_in_transaction_session_timeout"] == str(db.settings.DB_IDLE_TRANSACTION_TIMEOUT_MS)
