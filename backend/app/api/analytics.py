"""Small, strictly allowlisted client event endpoint; never accepts user IDs."""

from collections import OrderedDict
import hashlib
import time
from uuid import uuid5, NAMESPACE_URL

from fastapi import APIRouter, Depends, Request, Response, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.auth import get_current_user
from app.core.config import settings
from app.db.session import get_session
from app.analytics.schema import ClientEvent, normalize_path, normalize_referrer
from app.analytics.repository import safe_record

router = APIRouter(prefix="/analytics", tags=["analytics"])
_buckets = OrderedDict()


def admitted(request):
    # Bounded memory; keyed digest exists only in process memory, never in events.
    address = request.client.host if request.client else "unknown"
    key = hashlib.blake2s(
        address.encode(), key=settings.AUTH_SECRET.encode()[:32], digest_size=16
    ).digest()
    window = int(time.monotonic() // 60)
    old, count = _buckets.pop(key, (window, 0))
    count = count + 1 if old == window else 1
    _buckets[key] = (window, count)
    while len(_buckets) > 4096:
        _buckets.popitem(last=False)
    return count <= 240


@router.post("/events", status_code=204)
async def collect(
    body: ClientEvent, request: Request, session: AsyncSession = Depends(get_session)
):
    if not admitted(request):
        raise HTTPException(429, "Event limit reached", headers={"Retry-After": "60"})
    if request.headers.get("dnt") == "1" or request.headers.get("sec-gpc") == "1":
        return Response(status_code=204)
    path = normalize_path(body.path)
    if path is None:
        return Response(status_code=204)
    try:
        user = await get_current_user(request, session)
    except HTTPException as error:
        if error.status_code != 401:
            raise
        user = None
    # End the authentication read transaction before the independent event write.
    await session.close()
    event = body.model_dump(exclude={"event_id"})
    referrer = normalize_referrer(body.referrer)
    if referrer in ("chef-world.com", "www.chef-world.com"):
        referrer = None
    event.update(
        id=uuid5(NAMESPACE_URL, f"client:{body.visitor_id}:{body.event_id}"),
        path=path,
        referrer=referrer,
        user_id=user.id if user else None,
        is_client=True,
        platform="web",
    )
    await safe_record(event)
    return Response(status_code=204)
