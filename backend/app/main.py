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
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import get_cors_origins_list
from app.core.logging import setup_logging
from app.db.session import init_engine
from app.api.auth import router as auth_router
from app.api.routes_recipes import router as recipes_router
from app.api.routes_mealplan import router as mealplan_router
from app.api.routes_shopping import router as shopping_router
from app.services.storage_service import get_local_upload_root

setup_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_engine()
    yield


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

_upload_root = get_local_upload_root()
_upload_root.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_upload_root)), name="uploads")


@app.get("/health")
def health():
    return {"status": "ok"}
