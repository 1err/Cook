"""Reserve total image growth before storage; never refund ambiguous failures.

These counters do not expire. Unattached images and failed/unknown writes remain
charged until an operator reconciles an authoritative storage inventory. Historical
objects must be inventoried before claiming a bound on the entire existing bucket.
"""
from sqlalchemy import and_
from sqlalchemy.dialects.postgresql import insert

from app.db.upload_budget_models import UploadBudgetModel


class UploadAllowanceExceeded(Exception):
    pass


async def reserve_storage(session, account_id: str, byte_count: int, *,
                          global_count: int, account_count: int,
                          global_bytes: int, account_bytes: int,
                          global_scope: str = "global") -> None:
    if byte_count < 1:
        raise ValueError("Upload must contain bytes")
    table = UploadBudgetModel.__table__
    # Global first, consistently: account denial rolls back the whole transaction.
    for scope, count_cap, bytes_cap in [
        (global_scope, global_count, global_bytes),
        (f"user:{account_id}", account_count, account_bytes),
    ]:
        if count_cap < 1 or byte_count > bytes_cap:
            raise UploadAllowanceExceeded()
        statement = insert(table).values(scope=scope, object_count=1, byte_count=byte_count)
        statement = statement.on_conflict_do_update(
            index_elements=[table.c.scope],
            set_={"object_count": table.c.object_count + 1,
                  "byte_count": table.c.byte_count + byte_count},
            where=and_(table.c.object_count < count_cap,
                       table.c.byte_count <= bytes_cap - byte_count),
        ).returning(table.c.scope)
        if (await session.execute(statement)).scalar_one_or_none() is None:
            raise UploadAllowanceExceeded()


async def reserve_upload_allowance(account_id: str, byte_count: int) -> None:
    from app.core.config import settings
    from app.db import session as db
    if db.async_session_maker is None:
        db.init_engine()
    async with db.async_session_maker.begin() as session:
        await reserve_storage(session, account_id, byte_count,
            global_count=settings.UPLOAD_GLOBAL_TOTAL_COUNT,
            account_count=settings.UPLOAD_ACCOUNT_TOTAL_COUNT,
            global_bytes=settings.UPLOAD_GLOBAL_TOTAL_BYTES,
            account_bytes=settings.UPLOAD_ACCOUNT_TOTAL_BYTES)
