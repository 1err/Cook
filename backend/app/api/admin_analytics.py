import csv
import io
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.admin import require_admin
from app.db.session import get_session
from app.analytics.schema import DateRange, csv_safe
from app.analytics import reports


def private_response(response: Response):
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(
    prefix="/admin/analytics",
    tags=["admin"],
    dependencies=[Depends(require_admin), Depends(private_response)],
)


def report_range(
    start: date | None = None, end: date | None = None, include_internal: bool = False
):
    today = datetime.now(timezone.utc).date()
    end = end or today
    start = start or end - timedelta(days=29)
    if end > today:
        raise HTTPException(422, "The reporting end date cannot be in the future")
    try:
        return DateRange(start=start, end=end, include_internal=include_internal)
    except ValidationError:
        raise HTTPException(422, "Choose a date range between 1 and 90 days") from None


async def reporting_session(session: AsyncSession = Depends(get_session)):
    await session.execute(text("SET LOCAL statement_timeout='5000ms'"))
    return session


@router.get("/overview")
async def overview(
    period: DateRange = Depends(report_range), session=Depends(reporting_session)
):
    return await reports.overview(session, period)


@router.get("/users")
async def users(
    period: DateRange = Depends(report_range),
    q: str = Query("", max_length=128),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0, le=100000),
    session=Depends(reporting_session),
):
    return await reports.users_page(session, period, q, limit, offset)


@router.get("/users.csv")
async def export_users(
    period: DateRange = Depends(report_range),
    q: str = Query("", max_length=128),
    session=Depends(reporting_session),
):
    page = await reports.users_page(session, period, q, 10000)
    if page["total"] > 10000:
        raise HTTPException(422, "Narrow your search to export at most 10,000 accounts")
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    keys = (
        "email",
        "created_at",
        "is_admin",
        "is_test",
        "last_login_at",
        "last_seen_at",
        "recipes",
        "plan_rows",
        "logins",
        "login_coverage",
    )
    writer.writerow(keys)
    for row in page["items"]:
        writer.writerow([csv_safe(row.get(k)) for k in keys])
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="chef-world-users.csv"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/users/{user_id}")
async def detail(
    user_id: UUID,
    period: DateRange = Depends(report_range),
    session=Depends(reporting_session),
):
    data = await reports.user_detail(session, user_id, period)
    if data is None:
        raise HTTPException(404, "Account not found")
    return data


class TestStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_test: bool


@router.patch("/users/{user_id}/test-status")
async def test_status(
    user_id: UUID, body: TestStatus, session=Depends(reporting_session)
):
    exists = (
        await session.execute(
            text("SELECT id FROM users WHERE id=:id"), {"id": user_id}
        )
    ).scalar_one_or_none()
    if not exists:
        raise HTTPException(404, "Account not found")
    await session.execute(
        text(
            "INSERT INTO analytics_profiles(user_id,is_test) VALUES (:id,:test) ON CONFLICT(user_id) DO UPDATE SET is_test=EXCLUDED.is_test"
        ),
        {"id": user_id, "test": body.is_test},
    )
    return {"is_test": body.is_test}
