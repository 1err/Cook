"""Blocking and private moderation data; identities are authorized in routes."""
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert

from app.db.models import ContentReportModel, RecipeModel, UserBlockModel, UserModel
from app.services.content_safety_service import is_shareable_recipe


def blocked_owner_ids(viewer_id: UUID):
    return select(UserBlockModel.blocked_user_id).where(UserBlockModel.user_id == viewer_id).union(
        select(UserBlockModel.user_id).where(UserBlockModel.blocked_user_id == viewer_id))


async def relationship_blocked(session, first: UUID, second: UUID) -> bool:
    result = await session.execute(select(UserBlockModel.user_id).where(or_(
        and_(UserBlockModel.user_id == first, UserBlockModel.blocked_user_id == second),
        and_(UserBlockModel.user_id == second, UserBlockModel.blocked_user_id == first),
    )).limit(1))
    return result.scalar_one_or_none() is not None


async def block_user(session, viewer: UUID, target: UUID) -> None:
    if viewer == target:
        raise HTTPException(400, 'You cannot block your own account')
    exists = await session.execute(select(UserModel.id).where(UserModel.id == target))
    if exists.scalar_one_or_none() is None:
        raise HTTPException(404, 'Account not found')
    await session.execute(insert(UserBlockModel).values(user_id=viewer, blocked_user_id=target)
                          .on_conflict_do_nothing(index_elements=['user_id', 'blocked_user_id']))


async def unblock_user(session, viewer: UUID, target: UUID) -> None:
    await session.execute(delete(UserBlockModel).where(UserBlockModel.user_id == viewer, UserBlockModel.blocked_user_id == target))


async def list_blocks(session, viewer: UUID) -> list[UserModel]:
    return list((await session.execute(select(UserModel).join(UserBlockModel, UserBlockModel.blocked_user_id == UserModel.id)
                                      .where(UserBlockModel.user_id == viewer).order_by(UserModel.email))).scalars().all())


async def visible_shared_recipe(session, recipe_id: str, viewer: UUID):
    row = (await session.execute(select(RecipeModel).join(UserModel, UserModel.id == RecipeModel.user_id).where(
        RecipeModel.id == recipe_id, or_(
            and_(RecipeModel.is_public_catalog.is_(True), RecipeModel.catalog_suspended.is_(False)),
            and_(UserModel.is_library_public.is_(True), UserModel.library_sharing_suspended.is_(False), RecipeModel.is_library_hidden.is_(False)),
        ), ~RecipeModel.user_id.in_(blocked_owner_ids(viewer)),
    ))).scalars().one_or_none()
    return row if row is not None and is_shareable_recipe(row) else None


async def create_report(session, viewer: UUID, recipe, reason: str, notes: str | None, snapshot: dict):
    report_id = uuid4()
    result = await session.execute(insert(ContentReportModel).values(
        id=report_id, reporter_id=viewer, owner_id=recipe.user_id, recipe_id=recipe.id,
        reason=reason, notes=notes, content_snapshot=snapshot, status='pending',
    ).on_conflict_do_nothing(index_elements=['reporter_id', 'recipe_id'], index_where=ContentReportModel.status == 'pending')
      .returning(ContentReportModel.id))
    inserted = result.scalar_one_or_none()
    return (await session.execute(select(ContentReportModel).where(
        ContentReportModel.id == inserted if inserted else and_(ContentReportModel.reporter_id == viewer,
        ContentReportModel.recipe_id == recipe.id, ContentReportModel.status == 'pending'),
    ))).scalars().one()


async def list_reports(session, status: str, limit: int, offset: int):
    predicate = ContentReportModel.status == status
    total = (await session.execute(select(func.count()).select_from(ContentReportModel).where(predicate))).scalar_one()
    rows = (await session.execute(select(ContentReportModel).where(predicate)
                                  .order_by(ContentReportModel.created_at, ContentReportModel.id).limit(limit).offset(offset))).scalars().all()
    return rows, total


async def resolve_report(session, report_id: UUID, reviewer: UUID, action: str, notes: str | None):
    initial = (await session.execute(select(ContentReportModel).where(ContentReportModel.id == report_id))).scalars().one_or_none()
    if initial is None:
        raise HTTPException(404, 'Report not found')
    # The subject-user lock precedes report/recipe locks, matching account erasure
    # and sharing writes so review cannot deadlock with their FK cascade.
    owner = (await session.execute(select(UserModel).where(UserModel.id == initial.owner_id)
                                  .with_for_update().execution_options(populate_existing=True))).scalars().one_or_none()
    row = (await session.execute(select(ContentReportModel).where(ContentReportModel.id == report_id)
                                .with_for_update().execution_options(populate_existing=True))).scalars().one_or_none()
    if row is None or owner is None:
        raise HTTPException(404, 'Report not found')
    if row.status != 'pending':
        raise HTTPException(409, 'This report has already been reviewed')
    if action in ('remove_catalog', 'remove_shared_content'):
        await session.execute(update(RecipeModel).where(RecipeModel.id == row.recipe_id, RecipeModel.user_id == owner.id)
                              .values(is_public_catalog=False, catalog_suspended=True))
    if action in ('disable_library', 'remove_shared_content'):
        owner.is_library_public = False
        owner.library_sharing_suspended = True
    row.status, row.resolution, row.resolution_notes = 'resolved', action, notes
    row.reviewer_id, row.resolved_at = reviewer, datetime.now(timezone.utc)
    await session.flush()
    return row
