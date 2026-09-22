"""
Cooking Recipe API entrypoint.
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
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.core.config import get_cors_origins_list
from app.core.logging import setup_logging
from app.core.http_security import HTTPGuardMiddleware
from app.core.readiness import database_ready
from app.core.llm import AIInputTooLargeError, AIUnavailableError, close_openai_client
from app.db.session import dispose_engine, init_engine
from app.api.auth import router as auth_router
from app.api.routes_recipes import router as recipes_router
from app.api.routes_mealplan import router as mealplan_router
from app.api.routes_shopping import router as shopping_router
from app.api.routes_instacart import router as instacart_router
from app.api.routes_store import router as store_router
from app.api.routes_users import router as users_router
from app.api.routes_cooking import router as cooking_router
from app.api.admin import router as admin_router
from app.api.admin_usage import router as admin_usage_router
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
from app.jobs.account_cleanup import start_account_cleanup, shutdown_account_cleanup

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
        ("AI client", close_openai_client),
        ("account cleanup", shutdown_account_cleanup),
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
    start_account_cleanup()
    if settings.STORE_JOBS_MODE == "local":
        start_scheduler()
    try:
        yield
    finally:
        await _shutdown_application_resources()


app = FastAPI(title="Cooking Recipe API", lifespan=lifespan,
              docs_url=None if settings.APP_ENV == "production" else "/docs",
              redoc_url=None if settings.APP_ENV == "production" else "/redoc")


@app.exception_handler(RequestValidationError)
async def invalid_request(_request: Request, exc: RequestValidationError):
    # Pydantic includes raw field input by default, including passwords. Return
    # actionable locations/messages, never submitted values or validator context.
    errors = [{key: item[key] for key in ("type", "loc", "msg") if key in item}
              for item in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors})


@app.exception_handler(AIUnavailableError)
async def ai_unavailable(_request: Request, exc: AIUnavailableError):
    return JSONResponse(status_code=503, content={"detail": str(exc)}, headers={"Retry-After": "30"})


@app.exception_handler(AIInputTooLargeError)
async def ai_input_too_large(_request: Request, exc: AIInputTooLargeError):
    return JSONResponse(status_code=422, content={"detail": str(exc)})

origins = get_cors_origins_list()
app.add_middleware(HTTPGuardMiddleware, trusted_origins=origins)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=bool(origins),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Outermost application middleware resolves client identity before admission.
# Uvicorn's own proxy parsing is disabled in Docker/ECS to preserve the real
# network peer until this explicit trust boundary is checked.
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=settings.TRUSTED_PROXY_CIDRS)

from app.api.account_routes import router as account_router
app.include_router(auth_router)
app.include_router(account_router)
app.include_router(recipes_router)
app.include_router(mealplan_router)
app.include_router(shopping_router)
app.include_router(instacart_router)
app.include_router(store_router)
app.include_router(users_router)
app.include_router(cooking_router)
app.include_router(admin_router)
app.include_router(admin_usage_router)

_upload_root = get_local_upload_root()
_upload_root.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_upload_root)), name="uploads")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
async def ready():
    available = await database_ready()
    return JSONResponse(status_code=200 if available else 503,
                        content={"status": "ready" if available else "not_ready"})
