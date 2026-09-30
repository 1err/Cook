"""Logging configuration. No load_dotenv."""
import logging
import sys


class AccessQueryFilter(logging.Filter):
    """Keep Uvicorn request metadata without sensitive query parameters."""

    def filter(self, record: logging.LogRecord) -> bool:
        # Uvicorn's h11/httptools access format is (client, method, target,
        # version, status). Sanitize arguments before any handler formats them.
        args = record.args
        if isinstance(args, tuple) and len(args) == 5 and isinstance(args[2], str):
            record.args = (*args[:2], args[2].partition("?")[0], *args[3:])
        return True


def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        stream=sys.stdout,
    )
    # Transport INFO/DEBUG logs contain complete signed CDN and share URLs.
    # Keep operational warnings; application diagnostics record safe fields.
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    access_logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(item, AccessQueryFilter) for item in access_logger.filters):
        access_logger.addFilter(AccessQueryFilter())
