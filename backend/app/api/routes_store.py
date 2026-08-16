"""
Store product lookup route.

Returns a small list of live product results from supported stores.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.db.session import get_session
from app.db.models import UserModel
from app.services.store_scraper import fetch_store_products

router = APIRouter(tags=["store"])


class StoreProduct(BaseModel):
    name: str
    price: str
    image: str
    url: str


@router.get("/store-products", response_model=list[StoreProduct])
async def store_products(
    query: str = Query(..., min_length=1),
    store: str | None = Query(default="weee"),
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    """Return a few live store products for an ingredient query."""
    _ = current_user

    normalized_store = (store or "weee").strip().lower()
    if normalized_store != "weee":
        raise HTTPException(status_code=400, detail="Unsupported store. Use weee.")

    return await fetch_store_products(query, session=session)
