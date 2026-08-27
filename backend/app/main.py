"""
Cooking Recipe API — production-ready entrypoint.
Load env here only; core/config and services use settings (no load_dotenv in modules).
Postgres only: DATABASE_URL required; validation runs before init_engine().
"""
from dotenv import load_dotenv
load_dotenv()

# Fail fast if DATABASE_URL missing or invalid (Postgres required)
from app.core.config import settings
_ = settings.DATABASE_URL  # trigger validation before any DB code

from contextlib import asynccontextmanager
import asyncio
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import get_cors_origins_list
from app.core.logging import setup_logging
from app.db.session import dispose_engine, init_engine
from app.api.auth import router as auth_router
from app.api.routes_recipes import router as recipes_router
from app.api.routes_mealplan import router as mealplan_router
from app.api.routes_shopping import router as shopping_router
from app.api.routes_store import router as store_router
from app.api.routes_users import router as users_router
from app.api.routes_cooking import router as cooking_router
from app.api.admin import router as admin_router
from app.jobs.cache_warmer import (
    shutdown_cache_warmer,
    start_scheduler,
    stop_scheduler,
)
from app.services.store_product_service import (
    shutdown_live_lookups,
    start_live_lookup_admission,
    stop_live_lookup_admission,
)
from app.services.weee_scraper import shutdown_weee_scraper
from app.services.storage_service import get_local_upload_root

setup_logging()
logger = logging.getLogger(__name__)


async def _shutdown_application_resources() -> None:
    """Run every teardown phase, then propagate cancellation or failures."""
    errors: list[BaseException] = []
    caller_cancelled = False

    for phase_name, phase in (
        ("scheduler", stop_scheduler),
        ("live admission", stop_live_lookup_admission),
    ):
        try:
            phase()
        except BaseException as exc:
            errors.append(exc)
            logger.exception("application %s shutdown failed", phase_name)

    for phase_name, phase in (
        ("cache warmer", shutdown_cache_warmer),
        ("live lookup", shutdown_live_lookups),
        ("Weee browser", shutdown_weee_scraper),
        ("database", dispose_engine),
    ):
        try:
            await phase()
        except asyncio.CancelledError as exc:
            current = asyncio.current_task()
            if current is not None and current.cancelling():
                caller_cancelled = True
            else:
                errors.append(exc)
            logger.warning("application %s shutdown was cancelled", phase_name)
        except BaseException as exc:
            errors.append(exc)
            logger.exception("application %s shutdown failed", phase_name)

    if caller_cancelled:
        raise asyncio.CancelledError
    if len(errors) == 1:
        raise errors[0]
    if errors:
        raise BaseExceptionGroup("application shutdown failures", errors)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_engine()
    start_live_lookup_admission()
    start_scheduler()
    try:
        yield
    finally:
        await _shutdown_application_resources()


app = FastAPI(title="Cooking Recipe API", lifespan=lifespan)

origins = get_cors_origins_list()
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins else ["*"],
    allow_credentials=bool(origins),  # True when explicit origins (required for cookies cross-origin)
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(recipes_router)
app.include_router(mealplan_router)
app.include_router(shopping_router)
app.include_router(store_router)
app.include_router(users_router)
app.include_router(cooking_router)
app.include_router(admin_router)

_upload_root = get_local_upload_root()
_upload_root.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_upload_root)), name="uploads")


@app.get("/health")
def health():
    return {"status": "ok"}
