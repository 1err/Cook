"""
Application configuration from environment. No load_dotenv here; call from app entrypoint.
Postgres only: DATABASE_URL is required and must be a Postgres URL.
"""
from functools import lru_cache
from typing import List, Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    APP_ENV: Literal["development", "test", "production"] = "development"

    # Required. No default. Must be postgresql+asyncpg://...
    DATABASE_URL: str = Field(
        ...,
        repr=False,
        description="Required Postgres URL, e.g. postgresql+asyncpg://user:pass@host:5432/dbname",
    )

    # Set true for AWS RDS and other hosts that require TLS (asyncpg connect_args).
    DATABASE_SSL: bool = False

    @model_validator(mode="after")
    def require_postgres(self) -> "Settings":
        url = (self.DATABASE_URL or "").strip()
        if not url:
            raise ValueError(
                "DATABASE_URL is required. Set it in .env or environment "
                "(e.g. postgresql+asyncpg://user:pass@host:5432/dbname)."
            )
        parsed = urlsplit(url)
        if parsed.scheme != "postgresql+asyncpg" or not parsed.hostname or not parsed.path.strip("/"):
            raise ValueError(
                "DATABASE_URL must be a Postgres URL using asyncpg driver "
                "(e.g. postgresql+asyncpg://user:pass@host:5432/dbname)."
            )
        return self

    # CORS: comma-separated origins. In prod set to your frontend domain(s).
    # Do not use "*" when allow_credentials=True.
    CORS_ALLOW_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Auth: JWT signing. Required for auth endpoints. Use a long random string (e.g. openssl rand -hex 32).
    AUTH_SECRET: str = Field("", repr=False)

    # Production requires secure cookies. Sibling HTTPS subdomains are normally
    # same-site; unrelated preview domains need SameSite=none plus Secure.
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"

    @field_validator("COOKIE_SAMESITE", mode="after")
    @classmethod
    def normalize_cookie_samesite(cls, v: str) -> str:
        """Normalize SameSite so 'None'/'NONE' from env become 'none' for the cookie."""
        normalized = v.strip().lower() if v else v
        if normalized not in {"lax", "strict", "none"}:
            raise ValueError("COOKIE_SAMESITE must be lax, strict, or none")
        return normalized

    # Optional: OpenAI for extraction and refine
    OPENAI_API_KEY: str | None = Field(None, repr=False)
    OPENAI_PROJECT: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"
    # Server-only; provider development and production keys are separate.
    INSTACART_API_KEY: SecretStr | None = None
    INSTACART_ENVIRONMENT: Literal["development", "production"] = "development"
    OPENAI_TIMEOUT_SECONDS: float = Field(35.0, gt=0, le=120)
    OPENAI_MAX_OUTPUT_TOKENS: int = Field(4000, ge=256, le=8000)
    AI_USER_REQUESTS_PER_MINUTE: int = Field(6, ge=1)
    AI_USER_REQUESTS_PER_DAY: int = Field(50, ge=1)
    AI_GLOBAL_REQUESTS_PER_MINUTE: int = Field(60, ge=1)
    AI_GLOBAL_REQUESTS_PER_DAY: int = Field(1000, ge=1)

    # S3 uploads (optional). If unset, images save under LOCAL_IMAGE_UPLOAD_DIR.
    AWS_REGION: str = ""
    S3_BUCKET_NAME: str = ""

    # Local dev / no-S3: directory for recipe images (relative to process cwd, e.g. backend/ when using uvicorn).
    LOCAL_IMAGE_UPLOAD_DIR: str = ""

    # Immutable account IDs. No user receives privileges by claiming an email.
    ADMIN_USER_IDS: str = ""
    PUBLIC_LIBRARY_EDITOR_USER_IDS: str = ""

    @field_validator("ADMIN_USER_IDS", "PUBLIC_LIBRARY_EDITOR_USER_IDS")
    @classmethod
    def normalize_account_ids(cls, value: str) -> str:
        return ",".join(str(UUID(item.strip())) for item in value.split(",") if item.strip())

    @model_validator(mode="after")
    def validate_runtime_security(self) -> "Settings":
        if self.COOKIE_SAMESITE == "none" and not self.COOKIE_SECURE:
            raise ValueError("COOKIE_SAMESITE=none requires COOKIE_SECURE=true")
        origins = [item.strip() for item in self.CORS_ALLOW_ORIGINS.split(",") if item.strip()]
        for origin in origins:
            parsed = urlsplit(origin)
            if (parsed.scheme not in {"http", "https"} or not parsed.hostname
                    or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
                raise ValueError("CORS_ALLOW_ORIGINS must contain explicit HTTP(S) origins without paths")
        if self.APP_ENV == "production":
            if len(self.AUTH_SECRET) < 32 or self.AUTH_SECRET.lower().startswith(("your-secret", "replace-with", "change-me")):
                raise ValueError("Production requires a random AUTH_SECRET of at least 32 characters")
            if not self.COOKIE_SECURE:
                raise ValueError("Production requires COOKIE_SECURE=true")
            if not origins or any(urlsplit(origin).scheme != "https" for origin in origins):
                raise ValueError("Production requires explicit HTTPS CORS origins")
        return self

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
