"""Human photo-review queue with approval tied to the exact canonical URL set."""
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert

from app.db.models import RecipeMediaReviewModel, RecipeModel, UserModel
from app.services.media_review_service import has_immutable_app_media, recipe_media_digest, shared_media_status


async def queue_media_review(session, recipe, *, library_public: bool, snapshot: dict):
    digest = recipe_media_digest(recipe)
    if recipe.approved_media_digest != digest:
        recipe.approved_media_digest = None
    if recipe.rejected_media_digest != digest:
        recipe.rejected_media_digest = None
    shared = bool(library_public or recipe.is_public_catalog)
    # Cancel an unreviewed photo set as soon as its contents or visibility change.
    predicate = [RecipeMediaReviewModel.recipe_id == recipe.id, RecipeMediaReviewModel.status == 'pending']
    if digest and shared:
        predicate.append(RecipeMediaReviewModel.media_digest != digest)
    await session.execute(delete(RecipeMediaReviewModel).where(*predicate))
    if not digest or not shared or shared_media_status(recipe) != 'pending':
        return
    previous = (await session.execute(select(RecipeMediaReviewModel).where(
        RecipeMediaReviewModel.recipe_id == recipe.id, RecipeMediaReviewModel.media_digest == digest,
    ))).scalars().one_or_none()
    if previous is not None and previous.status in ('approved', 'rejected'):
        recipe.approved_media_digest = digest if previous.status == 'approved' else None
        recipe.rejected_media_digest = digest if previous.status == 'rejected' else None
        await session.flush()
        return
    snapshot = {**snapshot, 'raw_extraction_text': None}
    eligible = has_immutable_app_media(recipe)
    if not eligible:
        recipe.rejected_media_digest = digest
        await session.flush()
    await session.execute(insert(RecipeMediaReviewModel).values(id=uuid4(), owner_id=recipe.user_id,
        recipe_id=recipe.id, media_digest=digest, content_snapshot=snapshot, status='pending' if eligible else 'rejected',
        review_notes=None if eligible else 'External media links stay private. Upload images to Chef World before sharing them.')
        .on_conflict_do_nothing(index_elements=['recipe_id', 'media_digest']))


async def list_media_reviews(session, status, limit, offset):
    predicate = RecipeMediaReviewModel.status == status
    total = (await session.execute(select(func.count()).select_from(RecipeMediaReviewModel).where(predicate))).scalar_one()
    rows = (await session.execute(select(RecipeMediaReviewModel).where(predicate)
        .order_by(RecipeMediaReviewModel.created_at, RecipeMediaReviewModel.id).limit(limit).offset(offset))).scalars().all()
    return rows, total


async def review_media(session, review_id, reviewer, decision, digest, notes):
    initial = (await session.execute(select(RecipeMediaReviewModel).where(RecipeMediaReviewModel.id == review_id))).scalars().one_or_none()
    if initial is None:
        raise HTTPException(404, 'Photo review not found')
    # Same user → recipe ordering as publication/writes/deletion.
    await session.execute(select(UserModel.id).where(UserModel.id == initial.owner_id).with_for_update())
    recipe = (await session.execute(select(RecipeModel).where(RecipeModel.id == initial.recipe_id)
                                    .with_for_update().execution_options(populate_existing=True))).scalars().one_or_none()
    row = (await session.execute(select(RecipeMediaReviewModel).where(RecipeMediaReviewModel.id == review_id)
                                 .with_for_update().execution_options(populate_existing=True))).scalars().one_or_none()
    if recipe is None or row is None:
        raise HTTPException(404, 'Photo review not found')
    if row.status != 'pending' or digest != row.media_digest or recipe_media_digest(recipe) != digest:
        raise HTTPException(409, 'These photos changed or have already been reviewed. Reload the photo queue.')
    if decision == 'approve' and not has_immutable_app_media(recipe):
        raise HTTPException(422, 'Only immutable Chef World uploads are eligible for shared photos')
    row.status = 'approved' if decision == 'approve' else 'rejected'
    row.reviewer_id, row.reviewed_at, row.review_notes = reviewer, datetime.now(timezone.utc), notes
    if decision == 'approve':
        recipe.approved_media_digest = digest
        recipe.rejected_media_digest = None
    else:
        recipe.rejected_media_digest = digest
        recipe.approved_media_digest = None
    await session.flush()
    return row


async def discover_shared_media_reviews():
    # Discovery uses detached IDs followed by one short, locked transaction per
    # recipe. A stale startup scan cannot undo a newer approval/sharing choice.
    import logging
    from app.db import session as db_session
    from app.db.repo_recipes import _row_to_recipe
    factory = db_session.async_session_maker
    if factory is None:
        return
    try:
        async with factory() as session:
            candidates = (await session.execute(select(RecipeModel.id, RecipeModel.user_id).join(UserModel)
                .where(or_(RecipeModel.is_public_catalog.is_(True), UserModel.is_library_public.is_(True)))
                .order_by(RecipeModel.id))).all()
        for recipe_id, owner_id in candidates:
            async with factory.begin() as session:
                owner = (await session.execute(select(UserModel).where(UserModel.id == owner_id)
                    .with_for_update().execution_options(populate_existing=True))).scalars().one_or_none()
                recipe = (await session.execute(select(RecipeModel).where(RecipeModel.id == recipe_id, RecipeModel.user_id == owner_id)
                    .with_for_update().execution_options(populate_existing=True))).scalars().one_or_none()
                if owner is None or recipe is None:
                    continue
                await queue_media_review(session, recipe, library_public=owner.is_library_public,
                                         snapshot=_row_to_recipe(recipe).model_dump(mode='json'))
    except Exception as exc:
        # Never let scheduler tracebacks include SQL parameters or recipe text.
        logging.getLogger(__name__).warning('media_review_discovery_failed error_type=%s', type(exc).__name__)
