"""Access logs keep routing/status evidence without email or other query values."""
import io
import logging

import pytest

from app.core.logging import setup_logging


@pytest.mark.parametrize("target,expected", [
    ("/users/search?email=private-person%40example.com", "/users/search"),
    ("/store-products?query=private-grocery-note&store=weee", "/store-products"),
    ("/health", "/health"),
])
def test_uvicorn_access_log_omits_query_values(target, expected):
    logger = logging.getLogger("uvicorn.access")
    old_level, old_handlers, old_propagate = logger.level, logger.handlers[:], logger.propagate
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    logger.handlers = [handler]
    logger.propagate = False
    logger.setLevel(logging.INFO)
    try:
        setup_logging()
        # Both installed Uvicorn HTTP implementations emit this exact record.
        logger.info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:1", "GET", target, "1.1", 200)
    finally:
        logger.handlers, logger.level, logger.propagate = old_handlers, old_level, old_propagate
        handler.close()
    assert stream.getvalue() == f'127.0.0.1:1 - "GET {expected} HTTP/1.1" 200\n'
