"""Real SQLite table support for the additive readiness repositories."""
from sqlalchemy import JSON, MetaData, Uuid
from sqlalchemy.dialects import postgresql
from app.db.models import (UserModel, RecipeModel, AccountMediaCleanupModel,
    UserBlockModel, ContentReportModel, RecipeMediaReviewModel)
from app.db.account_models import DeletedAccountModel


def create_readiness_schema(engine, *, tombstones_only=False):
    metadata = MetaData()
    models = (DeletedAccountModel,) if tombstones_only else (UserModel, RecipeModel, AccountMediaCleanupModel, UserBlockModel,
                  ContentReportModel, RecipeMediaReviewModel, DeletedAccountModel)
    for model in models:
        table = model.__table__.to_metadata(metadata)
        for column in table.columns:
            if isinstance(column.type, postgresql.JSONB): column.type = JSON()
            elif isinstance(column.type, postgresql.UUID): column.type = Uuid()
    metadata.create_all(engine, checkfirst=True)
