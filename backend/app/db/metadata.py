"""Register all model modules for migration inspection and disposable test schemas."""
from app.db.models import Base
from app.db import ai_cost_models, job_models, request_limit_models  # noqa: F401
from app.db import upload_budget_models  # noqa: F401

__all__ = ["Base"]
