"""
Application configuration from environment. No load_dotenv here; call from app entrypoint.
Postgres only: DATABASE_URL is required and must be a Postgres URL.
"""
from functools import lru_cache
from typing import List

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Required. No default. Must be postgresql+asyncpg://...
    DATABASE_URL: str = Field(
        ...,
        description="Required Postgres URL, e.g. postgresql+asyncpg://user:pass@host:5432/dbname",
    )

    @model_validator(mode="after")
    def require_postgres(self) -> "Settings":
        url = (self.DATABASE_URL or "").strip()
        if not url:
            raise ValueError(
                "DATABASE_URL is required. Set it in .env or environment "
                "(e.g. postgresql+asyncpg://user:pass@host:5432/dbname)."
            )
        if "postgresql" not in url.lower() or "asyncpg" not in url.lower():
            raise ValueError(
                "DATABASE_URL must be a Postgres URL using asyncpg driver "
                "(e.g. postgresql+asyncpg://user:pass@host:5432/dbname)."
            )
        return self

    # CORS: comma-separated origins. In prod set to your frontend domain(s).
    # Do not use "*" when allow_credentials=True.
    CORS_ALLOW_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Auth: JWT signing. Required for auth endpoints. Use a long random string (e.g. openssl rand -hex 32).
    AUTH_SECRET: str = ""

    # Auth cookie: for cross-origin (e.g. frontend on Vercel, API on api.chef-world.com) set both.
    # COOKIE_SECURE=true and COOKIE_SAMESITE=none so the cookie is sent with cross-site requests.
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"  # use "none" for cross-site; requires COOKIE_SECURE=true

    # Optional: OpenAI for extraction and refine
    OPENAI_API_KEY: str | None = None

    # S3 presigned uploads (required for image upload endpoint)
    AWS_REGION: str = ""
    S3_BUCKET_NAME: str = ""

    @model_validator(mode="after")
    def validate_s3_config(self) -> "Settings":
        """If either S3 var is set, both must be set (required for upload endpoint)."""
        has_region = bool((self.AWS_REGION or "").strip())
        has_bucket = bool((self.S3_BUCKET_NAME or "").strip())
        if has_region != has_bucket:
            raise ValueError(
                "AWS_REGION and S3_BUCKET_NAME must both be set or both be empty. "
                "Set both in .env for image uploads."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


def get_cors_origins_list() -> List[str]:
    raw = get_settings().CORS_ALLOW_ORIGINS.strip()
    if not raw:
        return []
    return [o.strip() for o in raw.split(",") if o.strip()]


settings = get_settings()
