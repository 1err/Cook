"""
Application configuration from environment. No load_dotenv here; call from app entrypoint.
Postgres only: DATABASE_URL is required and must be a Postgres URL.
"""
from functools import lru_cache
from ipaddress import ip_network
from decimal import Decimal
from typing import List, Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import EmailStr, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    APP_ENV: Literal["development", "test", "production"] = "development"

    # Only verified immediate proxy subnet CIDRs may supply forwarded identity.
    # Empty in development means no proxy is trusted. Production is fail-closed.
    TRUSTED_PROXY_CIDRS: str = ""

    @field_validator("TRUSTED_PROXY_CIDRS")
    @classmethod
    def validate_trusted_proxy_cidrs(cls, value: str) -> str:
        if not value.strip():
            return ""
        networks = []
        for item in value.split(","):
            try:
                network = ip_network(item.strip(), strict=True)
            except ValueError:
                raise ValueError("TRUSTED_PROXY_CIDRS must contain explicit IP addresses or canonical subnet CIDRs") from None
            if network.prefixlen < (16 if network.version == 4 else 48):
                raise ValueError("TRUSTED_PROXY_CIDRS must be narrowly scoped proxy subnets (IPv4 /16 or narrower; IPv6 /48 or narrower)")
            networks.append(str(network))
        return ",".join(dict.fromkeys(networks))

    @model_validator(mode="after")
    def require_production_proxy_trust(self) -> "Settings":
        if self.APP_ENV == "production" and not self.TRUSTED_PROXY_CIDRS:
            raise ValueError("Production requires explicit TRUSTED_PROXY_CIDRS for verified load balancer subnets")
        return self

    # Required. No default. Must be postgresql+asyncpg://...
    DATABASE_URL: str = Field(
        ...,
        repr=False,
        description="Required Postgres URL, e.g. postgresql+asyncpg://user:pass@host:5432/dbname",
    )

    # Set true for AWS RDS and other hosts that require TLS (asyncpg connect_args).
    DATABASE_SSL: bool = False
    DATABASE_CA_FILE: str = ""
    DB_POOL_SIZE: int = Field(5, ge=1, le=100)
    DB_MAX_OVERFLOW: int = Field(0, ge=0, le=100)
    DB_POOL_TIMEOUT_SECONDS: float = Field(5, gt=0, le=30)
    DB_POOL_RECYCLE_SECONDS: int = Field(1800, ge=60)
    DB_STATEMENT_TIMEOUT_MS: int = Field(15000, ge=100, le=120000)
    DB_LOCK_TIMEOUT_MS: int = Field(5000, ge=100, le=30000)
    DB_IDLE_TRANSACTION_TIMEOUT_MS: int = Field(15000, ge=100, le=120000)
    DB_CONNECTION_BUDGET: int = Field(60, ge=10)
    DB_ADMIN_CONNECTION_RESERVE: int = Field(10, ge=1)
    DB_MAX_API_REPLICAS: int = Field(2, ge=1)
    DB_MAX_WORKER_REPLICAS: int = Field(1, ge=0)
    DB_PROCESSES_PER_TASK: int = Field(1, ge=1)
    DB_DEPLOYMENT_SURGE_FACTOR: int = Field(2, ge=1, le=3)

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

    PUBLIC_API_ORIGIN: str = ""

    @field_validator("PUBLIC_API_ORIGIN")
    @classmethod
    def validate_public_api_origin(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if not value:
            return ""
        parsed = urlsplit(value)
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname
                or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
            raise ValueError("PUBLIC_API_ORIGIN must be an explicit HTTP(S) origin")
        return value

    # Auth: JWT signing. Required for auth endpoints. Use a long random string (e.g. openssl rand -hex 32).
    AUTH_SECRET: str = Field("", repr=False)

    # Activate only after SES identity verification and production sending access.
    EMAIL_PROVIDER: Literal["disabled", "ses"] = "disabled"
    SES_REGION: str = ""
    SES_SENDER_EMAIL: EmailStr | None = None
    SES_IDENTITY_VERIFIED: bool = False
    PUBLIC_WEB_ORIGIN: str = ""
    PASSWORD_RESET_TTL_SECONDS: int = Field(1800, ge=300, le=3600)
    EMAIL_VERIFICATION_TTL_SECONDS: int = Field(86400, ge=300, le=86400)
    ACCOUNT_EMAIL_IP_PER_HOUR: int = Field(20, ge=1)
    ACCOUNT_EMAIL_ADDRESS_PER_HOUR: int = Field(5, ge=1)
    ACCOUNT_CONFIRM_IP_PER_MINUTE: int = Field(20, ge=1)
    ACCOUNT_CLEANUP_ENABLED: bool = True
    ACCOUNT_CLEANUP_POLL_SECONDS: float = Field(30, ge=1, le=300)

    @model_validator(mode="after")
    def validate_account_email_origin(self) -> "Settings":
        origin = self.PUBLIC_WEB_ORIGIN
        if origin:
            parsed = urlsplit(origin)
            allowed = {item.strip() for item in self.CORS_ALLOW_ORIGINS.split(",")}
            if (parsed.scheme not in {"http", "https"} or not parsed.hostname
                    or parsed.username or parsed.password or parsed.path or parsed.query
                    or parsed.fragment or origin not in allowed):
                raise ValueError("PUBLIC_WEB_ORIGIN must be an explicit first-party CORS origin without a path")
            if self.APP_ENV == "production" and parsed.scheme != "https":
                raise ValueError("Production account links require HTTPS")
        return self

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
    OPENAI_MODEL: str = "gpt-6-luna"
    # Server-only; provider development and production keys are separate.
    INSTACART_API_KEY: SecretStr | None = None
    INSTACART_ENVIRONMENT: Literal["development", "production"] = "development"
    OPENAI_TIMEOUT_SECONDS: float = Field(35.0, gt=0, le=120)
    OPENAI_MAX_OUTPUT_TOKENS: int = Field(4000, ge=256, le=8000)
    OPENAI_SHOPPING_MAX_OUTPUT_TOKENS: int = Field(20000, ge=256, le=20000)
    # Optional audiovisual provider. Blank reviewed pricing keeps this disabled.
    GEMINI_API_KEY: str | None = Field(None, repr=False)
    GEMINI_MODEL: str = "gemini-3.5-flash-lite"
    GEMINI_PRICE_MODEL: str = ""
    GEMINI_PRICE_VERSION: str = ""
    GEMINI_INPUT_USD_PER_MILLION_TOKENS: Decimal | None = Field(None, gt=0)
    GEMINI_OUTPUT_USD_PER_MILLION_TOKENS: Decimal | None = Field(None, gt=0)
    GEMINI_TIMEOUT_SECONDS: float = Field(35, gt=0, le=120)
    GEMINI_MAX_OUTPUT_TOKENS: int = Field(8000, ge=256, le=8000)
    AI_USER_REQUESTS_PER_MINUTE: int = Field(6, ge=1)
    AI_USER_REQUESTS_PER_DAY: int = Field(50, ge=1)
    AI_GLOBAL_REQUESTS_PER_MINUTE: int = Field(60, ge=1)
    AI_GLOBAL_REQUESTS_PER_DAY: int = Field(1000, ge=1)
    # Hosting fields are retained for historical planning/report compatibility.
    # The approved AI ceiling is independent of that former combined estimate.
    OPERATING_MONTHLY_BUDGET_USD: Decimal = Field(Decimal("150"), gt=0)
    HOSTING_MONTHLY_RESERVE_USD: Decimal = Field(Decimal("150"), ge=0)
    AI_MONTHLY_BUDGET_USD: Decimal = Field(Decimal("0"), ge=0, le=30)
    AI_ACCOUNT_MONTHLY_BUDGET_USD: Decimal = Field(Decimal("0"), ge=0)
    AI_PRICE_VERSION: str = ""
    AI_PRICE_MODEL: str = ""
    AI_INPUT_USD_PER_MILLION_TOKENS: Decimal | None = Field(None, gt=0)
    AI_OUTPUT_USD_PER_MILLION_TOKENS: Decimal | None = Field(None, gt=0)
    AI_GLOBAL_MAX_INFLIGHT: int = Field(4, ge=1, le=100)
    AI_USER_MAX_INFLIGHT: int = Field(1, ge=1, le=20)
    AI_OPERATION_TIMEOUT_SECONDS: float = Field(85, gt=0, le=120)
    # Queued public RedNote imports can download and compress before analysis.
    REDNOTE_IMPORT_TIMEOUT_SECONDS: float = Field(420, ge=120, le=600)

    STORE_JOBS_MODE: Literal["auto", "local", "durable"] = "auto"
    STORE_JOBS_QUEUE_MAX: int = Field(100, ge=1, le=10000)
    STORE_JOBS_POLL_SECONDS: float = Field(2, ge=1, le=10)
    STORE_JOBS_WAIT_SECONDS: float = Field(25, gt=0, le=30)
    STORE_JOBS_LEASE_SECONDS: int = Field(180, ge=30, le=600)
    STORE_JOBS_TIMEOUT_SECONDS: int = Field(125, ge=1, le=300)
    STORE_JOBS_MAX_ATTEMPTS: int = Field(2, ge=1, le=5)
    STORE_JOBS_RETRY_SECONDS: float = Field(5, ge=1, le=60)
    STORE_JOBS_WARM_INTERVAL_SECONDS: int = Field(86400, ge=3600)
    STORE_JOBS_RETENTION_SECONDS: int = Field(86400, ge=3600)
    STORE_JOBS_ENABLED: bool = True
    # All HTTP retailer callers (including cache hits/batches) share these
    # PostgreSQL limits across replicas. Timed-out callers never cancel jobs.
    STORE_REQUEST_GLOBAL_PER_MINUTE: int = Field(120, ge=1, le=600)
    STORE_REQUEST_ACCOUNT_PER_MINUTE: int = Field(30, ge=1, le=120)
    STORE_REQUEST_GLOBAL_MAX_INFLIGHT: int = Field(12, ge=1, le=24)
    STORE_REQUEST_ACCOUNT_MAX_INFLIGHT: int = Field(2, ge=1, le=4)
    STORE_REQUEST_TIMEOUT_SECONDS: float = Field(30, gt=0, le=40)

    ABUSE_LIMITS_ENABLED: bool | None = None
    AUTH_GLOBAL_PER_MINUTE: int = Field(120, ge=1)
    AUTH_LOGIN_IP_PER_MINUTE: int = Field(60, ge=1)
    AUTH_LOGIN_ACCOUNT_PER_MINUTE: int = Field(10, ge=1)
    AUTH_REGISTER_IP_PER_HOUR: int = Field(20, ge=1)
    AUTH_REGISTER_ACCOUNT_PER_HOUR: int = Field(5, ge=1)
    UPLOAD_ACCOUNT_PER_HOUR: int = Field(30, ge=1)
    UPLOAD_GLOBAL_PER_MINUTE: int = Field(120, ge=1)
    UPLOAD_ACCOUNT_BYTES_PER_DAY: int = Field(50 * 1024 * 1024, ge=1024 * 1024)
    # Cumulative growth since inventory baseline, not a daily reset. Unknown
    # writes stay reserved; verified cleanup is needed to recover this allowance.
    UPLOAD_GLOBAL_TOTAL_COUNT: int = Field(10000, ge=1)
    UPLOAD_GLOBAL_TOTAL_BYTES: int = Field(5 * 1024 ** 3, ge=1)
    UPLOAD_ACCOUNT_TOTAL_COUNT: int = Field(200, ge=1)
    UPLOAD_ACCOUNT_TOTAL_BYTES: int = Field(100 * 1024 ** 2, ge=1)

    @model_validator(mode="after")
    def validate_capacity_allocations(self) -> "Settings":
        connections = ((self.DB_MAX_API_REPLICAS + self.DB_MAX_WORKER_REPLICAS)
                       * self.DB_DEPLOYMENT_SURGE_FACTOR * self.DB_PROCESSES_PER_TASK
                       * (self.DB_POOL_SIZE + self.DB_MAX_OVERFLOW)
                       # Each worker may have an independent supervisor DB
                       # connection; migrations use one outside all app pools.
                       + self.DB_MAX_WORKER_REPLICAS * self.DB_DEPLOYMENT_SURGE_FACTOR
                       * self.DB_PROCESSES_PER_TASK + 1
                       + self.DB_ADMIN_CONNECTION_RESERVE)
        if connections > self.DB_CONNECTION_BUDGET:
            raise ValueError("Configured pools and rollout overlap exceed the database connection budget")
        if self.AI_ACCOUNT_MONTHLY_BUDGET_USD > self.AI_MONTHLY_BUDGET_USD:
            raise ValueError("Account AI allocation exceeds the app AI allocation")
        if self.AI_USER_MAX_INFLIGHT > self.AI_GLOBAL_MAX_INFLIGHT:
            raise ValueError("Account AI concurrency exceeds app concurrency")
        if self.STORE_JOBS_LEASE_SECONDS < self.STORE_JOBS_TIMEOUT_SECONDS + 30:
            raise ValueError("Store job lease must include at least 30 seconds for cleanup after timeout")
        if self.STORE_REQUEST_ACCOUNT_MAX_INFLIGHT > self.STORE_REQUEST_GLOBAL_MAX_INFLIGHT:
            raise ValueError("Account retailer concurrency exceeds global retailer concurrency")
        if self.STORE_JOBS_MODE == "auto":
            self.STORE_JOBS_MODE = "durable" if self.APP_ENV == "production" else "local"
        if self.APP_ENV == "production" and self.STORE_JOBS_MODE != "durable":
            raise ValueError("Production requires durable store jobs")
        if self.ABUSE_LIMITS_ENABLED is None:
            self.ABUSE_LIMITS_ENABLED = self.APP_ENV != "test"
        if self.APP_ENV == "production" and not self.ABUSE_LIMITS_ENABLED:
            raise ValueError("Production requires shared auth and upload admission")
        return self

    # Optional recipe-cover generation has separate, deliberately small quotas.
    AI_IMAGE_GENERATION_ENABLED: bool = True
    AI_IMAGE_ACCESS_MODE: Literal["registered", "members"] = "registered"
    OPENAI_IMAGE_MODEL: str = Field("gpt-image-2", min_length=1, max_length=128)
    OPENAI_IMAGE_TIMEOUT_SECONDS: float = Field(45.0, gt=0, le=120)
    AI_IMAGE_USER_REQUESTS_PER_MINUTE: int = Field(1, ge=1)
    AI_IMAGE_USER_REQUESTS_PER_DAY: int = Field(3, ge=1)
    AI_IMAGE_ADMIN_REQUESTS_PER_DAY: int = Field(100, ge=1)
    AI_IMAGE_GLOBAL_REQUESTS_PER_MINUTE: int = Field(10, ge=1)
    AI_IMAGE_GLOBAL_REQUESTS_PER_DAY: int = Field(100, ge=1)

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
