"""
Recipe repository: async SQLAlchemy access. Maps DB rows to Pydantic Recipe.
All queries filter by user_id (multi-tenant).
"""
import base64
import hashlib
import hmac
import json
import uuid
from typing import Optional
from fastapi import HTTPException

from sqlalchemy import and_, case, cast, column, func, literal, or_, select, tuple_, update
from sqlalchemy.dialects.postgresql import JSONB, JSONPATH
from sqlalchemy.orm import aliased
from app.core.config import settings
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Recipe,
    IngredientItem,
    RecipeStep,
    coerce_library_tags,
    coerce_steps,
    coerce_string_list,
)
from app.db.models import RecipeModel, UserModel
from app.services.recipe_timing import summarize_recipe_timing
from app.db.repo_content_safety import blocked_owner_ids, relationship_blocked
from app.db.repo_auth import lock_account_erasure_barrier
from app.db.repo_media_reviews import queue_media_review
from app.services.media_review_service import is_immutable_app_media_url, recipe_media_digest, shared_media_status, immutable_media_predicate
from app.services.content_safety_service import ensure_shareable_recipe, is_shareable_recipe, shareable_recipe_predicate


class RecipeOwnershipConflict(ValueError):
    """The requested recipe ID is already owned by another account."""


async def _lock_copy_owner(session: AsyncSession, user_id: uuid.UUID) -> bool:
    """Serialize library save/remove operations before checking whether a source was copied."""
    result = await session.execute(
        select(UserModel.id).where(UserModel.id == user_id).with_for_update()
    )
    return result.scalar_one_or_none() is not None


def _row_to_recipe(row: RecipeModel) -> Recipe:
    ingredients_data = json.loads(row.ingredients or "[]")
    raw_tags = json.loads(row.library_tags or "[]") if getattr(row, "library_tags", None) else []
    normalized_tags = coerce_library_tags(raw_tags or row.library_category)
    steps_raw = json.loads(row.steps or "[]") if getattr(row, "steps", None) else []
    # Summarize recorded metadata before normalization supplies legacy defaults.
    timing_summary = summarize_recipe_timing(steps_raw)
    tips_raw = json.loads(row.tips or "[]") if getattr(row, "tips", None) else []
    equipment_raw = json.loads(row.equipment or "[]") if getattr(row, "equipment", None) else []
    return Recipe(
        id=row.id,
        title=row.title,
        source_url=row.source_url,
        thumbnail_url=row.thumbnail_url,
        ingredients=[IngredientItem(**i) for i in ingredients_data],
        raw_extraction_text=row.raw_extraction_text,
        library_tags=normalized_tags,
        library_category=normalized_tags[0] if normalized_tags else None,
        is_public_catalog=row.is_public_catalog,
        catalog_source_recipe_id=row.catalog_source_recipe_id,
        description=row.description,
        total_time_minutes=row.total_time_minutes,
        timing_summary=timing_summary,
        steps=coerce_steps(steps_raw, row.total_time_minutes),
        tips=coerce_string_list(tips_raw),
        equipment=coerce_string_list(equipment_raw),
        shared_media_status=shared_media_status(row),
    )


def _row_to_shared_recipe(row: RecipeModel) -> Recipe:
    """Share recipe fields without exposing the owner's private import guidance."""
    recipe = _row_to_recipe(row).model_copy(update={"raw_extraction_text": None})
    approved = shared_media_status(row) == "approved"
    recipe = recipe.model_copy(update={"thumbnail_url": recipe.thumbnail_url if approved and is_immutable_app_media_url(recipe.thumbnail_url) else None,
        "steps": [step.model_copy(update={"image_url": step.image_url if approved and is_immutable_app_media_url(step.image_url) else None}) for step in recipe.steps]})
    return recipe



async def save_recipe(session: AsyncSession, recipe: Recipe, user_id: uuid.UUID) -> Recipe:
    owner = (await session.execute(select(UserModel).where(UserModel.id == user_id)
                                  .with_for_update().execution_options(populate_existing=True))).scalars().one_or_none()
    if owner is None:
        raise RecipeOwnershipConflict("Account is unavailable")
    existing = (await session.execute(select(RecipeModel.is_public_catalog).where(
        RecipeModel.id == recipe.id, RecipeModel.user_id == user_id,
    ))).scalar_one_or_none()
    if bool(owner.is_library_public) or existing:
        ensure_shareable_recipe(recipe)
    ingredients_json = json.dumps(
        [i.model_dump() if hasattr(i, "model_dump") else i for i in recipe.ingredients]
    )
    tags = coerce_library_tags(getattr(recipe, "library_tags", None) or recipe.library_category)
    steps_list = coerce_steps(
        getattr(recipe, "steps", None), getattr(recipe, "total_time_minutes", None)
    )
    tips_list = coerce_string_list(getattr(recipe, "tips", None))
    equipment_list = coerce_string_list(getattr(recipe, "equipment", None))
    values = dict(
        id=recipe.id,
        user_id=user_id,
        title=recipe.title,
        source_url=recipe.source_url,
        thumbnail_url=recipe.thumbnail_url,
        ingredients=ingredients_json,
        raw_extraction_text=recipe.raw_extraction_text,
        library_tags=json.dumps(tags),
        library_category=tags[0] if tags else None,
        is_public_catalog=False,
        catalog_source_recipe_id=None,
        description=getattr(recipe, "description", None),
        total_time_minutes=getattr(recipe, "total_time_minutes", None),
        steps=json.dumps([s.model_dump() for s in steps_list]),
        tips=json.dumps(tips_list),
        equipment=json.dumps(equipment_list),
    )
    # The database checks ownership at the same instant it resolves an ID
    # conflict. A prior SELECT alone would leave a cross-account write race.
    statement = insert(RecipeModel).values(**values)
    protected = {"id", "user_id", "is_public_catalog", "catalog_source_recipe_id", "is_library_hidden"}
    statement = statement.on_conflict_do_update(
        index_elements=[RecipeModel.id],
        set_={key: getattr(statement.excluded, key) for key in values if key not in protected},
        where=RecipeModel.user_id == user_id,
    ).returning(RecipeModel)
    result = await session.execute(statement.execution_options(populate_existing=True))
    row = result.scalars().one_or_none()
    if row is None:
        raise RecipeOwnershipConflict("Recipe ID is unavailable for this account")
    await queue_media_review(session, row, library_public=bool(owner.is_library_public),
                             snapshot=_row_to_recipe(row).model_dump(mode="json"))
    return _row_to_recipe(row)



async def get_recipe(session: AsyncSession, recipe_id: str, user_id: uuid.UUID) -> Optional[Recipe]:
    result = await session.execute(
        select(RecipeModel).where(RecipeModel.id == recipe_id, RecipeModel.user_id == user_id)
    )
    row = result.scalars().one_or_none()
    if not row:
        return None
    return _row_to_recipe(row)


async def get_recipes_by_ids(
    session: AsyncSession, recipe_ids: list[str], user_id: uuid.UUID
) -> list[Recipe]:
    """Fetch owned recipes once, retaining first-requested order without duplicates."""
    requested = list(dict.fromkeys(recipe_ids))
    if not requested:
        return []
    result = await session.execute(
        select(RecipeModel).where(
            RecipeModel.user_id == user_id, RecipeModel.id.in_(requested)
        )
    )
    by_id = {row.id: _row_to_recipe(row) for row in result.scalars().all()}
    return [by_id[recipe_id] for recipe_id in requested if recipe_id in by_id]


async def list_recipes(session: AsyncSession, user_id: uuid.UUID) -> list[Recipe]:
    result = await session.execute(
        select(RecipeModel)
        .where(RecipeModel.user_id == user_id, RecipeModel.is_library_hidden.is_(False))
        .order_by(func.lower(RecipeModel.title), RecipeModel.id)
    )
    rows = list(result.scalars().all())
    return [_row_to_recipe(r) for r in rows]


async def list_public_recipes(session: AsyncSession, viewer_id: uuid.UUID | None = None) -> list[Recipe]:
    filters = [RecipeModel.is_public_catalog.is_(True), RecipeModel.catalog_suspended.is_(False)]
    if viewer_id is not None:
        filters.append(~RecipeModel.user_id.in_(blocked_owner_ids(viewer_id)))
    result = await session.execute(
        select(RecipeModel)
        .where(*filters)
        .order_by(func.lower(RecipeModel.title), RecipeModel.id)
    )
    rows = list(result.scalars().all())
    return [_row_to_shared_recipe(r) for r in rows if is_shareable_recipe(r)]



async def get_public_recipe(session: AsyncSession, recipe_id: str) -> Optional[Recipe]:
    result = await session.execute(
        select(RecipeModel).where(
            RecipeModel.id == recipe_id,
            RecipeModel.is_public_catalog.is_(True),
            RecipeModel.catalog_suspended.is_(False),
        )
    )
    row = result.scalars().one_or_none()
    if not row or not is_shareable_recipe(row):
        return None
    return _row_to_shared_recipe(row)



async def set_recipe_public_catalog(
    session: AsyncSession, recipe_id: str, user_id: uuid.UUID, is_public: bool
) -> Optional[Recipe]:
    owner = (await session.execute(select(UserModel).where(UserModel.id == user_id)
                                   .with_for_update().execution_options(populate_existing=True))).scalars().one_or_none()
    result = await session.execute(
        select(RecipeModel).where(RecipeModel.id == recipe_id, RecipeModel.user_id == user_id)
        .with_for_update().execution_options(populate_existing=True)
    )
    row = result.scalars().one_or_none()
    if not row:
        return None
    if is_public:
        if row.catalog_suspended:
            raise HTTPException(403, "Catalog publishing is disabled after moderation review")
        ensure_shareable_recipe(row)
    row.is_public_catalog = bool(is_public)
    await session.flush()
    await queue_media_review(session, row, library_public=bool(owner and owner.is_library_public),
                             snapshot=_row_to_recipe(row).model_dump(mode="json"))
    return _row_to_recipe(row)



async def copy_public_recipe_to_user(
    session: AsyncSession, recipe_id: str, user_id: uuid.UUID,
    created_outcome: list[bool] | None = None,
) -> Optional[Recipe]:
    await lock_account_erasure_barrier(session)
    if not await _lock_copy_owner(session, user_id):
        return None
    result = await session.execute(
        select(RecipeModel).where(
            RecipeModel.id == recipe_id,
            RecipeModel.is_public_catalog.is_(True),
        ).execution_options(populate_existing=True)
    )
    source = result.scalars().one_or_none()
    if not source or source.catalog_suspended or not is_shareable_recipe(source):
        return None
    if await relationship_blocked(session, source.user_id, user_id):
        return None

    if source.user_id == user_id:
        source.is_library_hidden = False
        await session.flush()
        return _row_to_recipe(source)
    existing_result = await session.execute(
        select(RecipeModel).where(
            RecipeModel.user_id == user_id,
            RecipeModel.catalog_source_recipe_id == recipe_id,
        ).order_by(RecipeModel.id).limit(1)
    )
    existing = existing_result.scalars().one_or_none()
    if existing:
        existing.is_library_hidden = False
        await session.flush()
        return _row_to_recipe(existing)

    shared = _row_to_shared_recipe(source)
    clone = RecipeModel(
        id=str(uuid.uuid4()),
        user_id=user_id,
        title=source.title,
        source_url=source.source_url,
        thumbnail_url=shared.thumbnail_url,
        ingredients=source.ingredients,
        raw_extraction_text=None,
        library_tags=source.library_tags,
        library_category=source.library_category,
        is_public_catalog=False,
        catalog_source_recipe_id=source.id,
        description=source.description,
        total_time_minutes=source.total_time_minutes,
        steps=json.dumps([step.model_dump() for step in shared.steps]),
        approved_media_digest=recipe_media_digest(shared) if shared.shared_media_status == "approved" else None,
        tips=source.tips,
        equipment=source.equipment,
    )
    session.add(clone)
    await session.flush()
    if created_outcome is not None:
        created_outcome.append(True)
    return _row_to_recipe(clone)


async def catalog_bookmark_states(session: AsyncSession, user_id: uuid.UUID, recipe_ids: list[str]) -> dict[str, bool]:
    """Reconcile only affected catalog cards, including published personal copies."""
    copied = aliased(RecipeModel)
    saved = select(copied.id).where(
        copied.user_id == user_id, copied.is_library_hidden.is_(False),
        or_(copied.id == RecipeModel.id, copied.catalog_source_recipe_id == RecipeModel.id),
    ).exists()
    result = await session.execute(select(RecipeModel.id, saved).where(
        RecipeModel.id.in_(recipe_ids), RecipeModel.is_public_catalog.is_(True),
    ))
    return dict(result.all())


async def unsave_public_recipe(session: AsyncSession, recipe_id: str, user_id: uuid.UUID) -> dict[str, bool] | None:
    """Hide only the caller's saved rows; retain public sources and all recipe data.

    The same account lock as copying makes repeated or concurrent toggles safe.
    Hide legacy duplicate copies together; saving restores one existing edited row.
    """
    if not await _lock_copy_owner(session, user_id):
        return None
    source = await session.execute(select(RecipeModel.id).where(
        RecipeModel.id == recipe_id, RecipeModel.is_public_catalog.is_(True),
    ))
    if source.scalar_one_or_none() is None:
        return None
    removed = await session.execute(update(RecipeModel).where(
        RecipeModel.user_id == user_id,
        or_(RecipeModel.id == recipe_id, RecipeModel.catalog_source_recipe_id == recipe_id),
    ).values(is_library_hidden=True).returning(RecipeModel.id, RecipeModel.catalog_source_recipe_id))
    affected = {recipe_id}
    for row_id, source_id in removed.all():
        affected.add(row_id)
        if source_id:
            affected.add(source_id)
    await session.flush()
    return await catalog_bookmark_states(session, user_id, list(affected))


async def delete_recipe(session: AsyncSession, recipe_id: str, user_id: uuid.UUID) -> bool:
    result = await session.execute(
        select(RecipeModel).where(RecipeModel.id == recipe_id, RecipeModel.user_id == user_id)
    )
    row = result.scalars().one_or_none()
    if not row:
        return False
    await session.delete(row)
    await session.flush()
    return True


def _page_scope_hash(scope: list) -> str:
    return hashlib.sha256(json.dumps(scope, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def _encode_page_cursor(scope: list, title: str, recipe_id: str) -> str:
    payload = json.dumps([1, _page_scope_hash(scope), title, recipe_id], ensure_ascii=False, separators=(",", ":")).encode()
    signature = hmac.new(settings.AUTH_SECRET.encode(), payload, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(signature + payload).decode().rstrip("=")


def _decode_page_cursor(cursor: str, scope: list) -> tuple[str, str]:
    try:
        if len(cursor) > 8192:
            raise ValueError()
        decoded = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        signature, payload = decoded[:32], decoded[32:]
        expected = hmac.new(settings.AUTH_SECRET.encode(), payload, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError()
        version, saved_scope, title, recipe_id = json.loads(payload)
        if version != 1 or saved_scope != _page_scope_hash(scope) or not isinstance(title, str) or not isinstance(recipe_id, str):
            raise ValueError()
        return title, recipe_id
    except (ValueError, TypeError, UnicodeError) as exc:
        raise ValueError("Invalid recipe cursor for this library or filter") from exc



def recipe_summary_statement(caller_id):
    r = RecipeModel
    copied = aliased(r)
    already_saved = select(copied.id).where(copied.user_id == caller_id, copied.is_library_hidden.is_(False), or_(copied.id == r.id, copied.catalog_source_recipe_id == r.id)).exists()
    steps_json = cast(r.steps, JSONB)
    steps_array = case(
        (func.jsonb_typeof(steps_json) == 'array', steps_json),
        else_=cast(literal('[]'), JSONB),
    )
    timing_step = func.jsonb_array_elements(steps_array).table_valued(
        column('value', JSONB),
    ).alias('timing_step')
    timing_steps = select(func.jsonb_agg(func.jsonb_build_object(
        'duration_seconds', timing_step.c.value['duration_seconds'],
        'duration_source', timing_step.c.value['duration_source'],
        'attention_type', timing_step.c.value['attention_type'],
    ))).select_from(timing_step).correlate(r).scalar_subquery()
    return select(
        r.id, r.title, func.lower(r.title).label("sort_title"), r.source_url,
        case((r.user_id == caller_id, r.thumbnail_url),
             (and_(r.approved_media_digest.is_not(None), immutable_media_predicate(r.thumbnail_url)), r.thumbnail_url),
             else_=None).label("thumbnail_url"),
        case((r.approved_media_digest.is_not(None), 'approved'),
             (r.rejected_media_digest.is_not(None), 'rejected'),
             (or_(r.thumbnail_url.is_not(None), func.jsonb_path_exists(steps_array,
                 cast(literal('$[*] ? (@.image_url != null && @.image_url != "")'), JSONPATH))), 'pending'),
             else_='none').label('shared_media_status'),
        r.library_tags, r.library_category, r.is_public_catalog, r.catalog_source_recipe_id,
        r.total_time_minutes, func.jsonb_array_length(cast(r.ingredients, JSONB)).label("ingredient_count"),
        func.jsonb_array_length(steps_array).label("step_count"), already_saved.label("already_saved"),
        timing_steps.label('timing_steps'),
    )

async def recipe_page(
    session: AsyncSession, caller_id: uuid.UUID, *, owner_id: uuid.UUID | None = None,
    catalog: bool = False, limit: int = 40, cursor: str | None = None,
    q: str = "", tags: list[str] | None = None,
):
    """Read-committed keyset traversal: edits may move rows; clients deduplicate IDs.

    Each query rechecks ownership/public visibility. No instructions are selected.
    Inserts before the cursor appear on refresh, not later in the current traversal.
    """
    from app.models import RecipePage, RecipeSummary, LEGACY_LIBRARY_CATEGORY_TO_TAG
    if not 1 <= limit <= 100:
        raise ValueError("Page limit must be between 1 and 100")
    q = q.strip().lower()
    if len(q) > 200:
        raise ValueError("Search is limited to 200 characters")
    tags = sorted(coerce_library_tags(tags or []))
    if owner_id is not None and catalog:
        raise ValueError("Choose one library scope")
    scope = [f"friend:{owner_id}" if owner_id is not None else "catalog" if catalog else "mine", str(caller_id), q, tags]
    r = RecipeModel
    statement = recipe_summary_statement(caller_id)
    if catalog:
        statement = statement.where(r.is_public_catalog.is_(True), r.catalog_suspended.is_(False),
            ~r.user_id.in_(blocked_owner_ids(caller_id)), shareable_recipe_predicate())
    elif owner_id is not None:
        statement = statement.where(r.user_id == owner_id, r.is_library_hidden.is_(False), select(UserModel.id).where(
            UserModel.id == owner_id, UserModel.is_library_public.is_(True), UserModel.id != caller_id,
            UserModel.library_sharing_suspended.is_(False), ~UserModel.id.in_(blocked_owner_ids(caller_id)),
        ).exists(), shareable_recipe_predicate())
    else:
        statement = statement.where(r.user_id == caller_id, r.is_library_hidden.is_(False))
    if q:
        statement = statement.where(func.lower(r.title).contains(q, autoescape=True))
    for tag in tags:
        legacy = [key for key, value in LEGACY_LIBRARY_CATEGORY_TO_TAG.items() if value == tag]
        statement = statement.where(or_(
            cast(r.library_tags, JSONB).contains([tag]),
            and_(or_(r.library_tags.is_(None), cast(r.library_tags, JSONB) == []), r.library_category.in_([tag, *legacy])),
        ))
    if cursor:
        title, recipe_id = _decode_page_cursor(cursor, scope)
        statement = statement.where(tuple_(func.left(func.lower(r.title), 256), func.lower(r.title), r.id) > tuple_(title[:256], title, recipe_id))
    result = await session.execute(statement.order_by(func.left(func.lower(r.title), 256), func.lower(r.title), r.id).limit(limit + 1))
    rows = result.mappings().all()
    items = []
    for row in rows[:limit]:
        values = dict(row)
        values.pop("sort_title")
        values['timing_summary'] = summarize_recipe_timing(values.pop('timing_steps', None))
        values["library_tags"] = coerce_library_tags(json.loads(values["library_tags"] or "[]") or values["library_category"])
        values["library_category"] = values["library_tags"][0] if values["library_tags"] else None
        items.append(RecipeSummary(**values))
    next_cursor = _encode_page_cursor(scope, rows[limit - 1]["sort_title"], rows[limit - 1]["id"]) if len(rows) > limit else None
    return RecipePage(items=items, next_cursor=next_cursor)
