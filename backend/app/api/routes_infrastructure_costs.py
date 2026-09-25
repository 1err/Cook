"""Admin-only infrastructure costs are independent of the model-call ledger."""
from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin import require_admin
from app.db.session import get_session
from app.services.infrastructure_costs import reporter

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/infrastructure-costs", dependencies=[Depends(require_admin)])
async def infrastructure_costs(response: Response, session: AsyncSession = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    # Authentication has completed. Do not hold its DB transaction while AWS
    # returns a billing estimate, including while waiting on another caller.
    await session.close()
    return await reporter.get()
