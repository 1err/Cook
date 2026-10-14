"""Authenticated union search; filters/counts precede stable keyset pagination."""
import json
import uuid
from sqlalchemy import and_, case, cast, column, distinct, func, literal, or_, select, true, tuple_
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import aliased
from app.db.models import RecipeModel
from app.db.repo_recipes import recipe_summary_statement, _encode_page_cursor, _decode_page_cursor
from app.models import LibrarySearchPage, LibraryRecipeSummary, coerce_library_tags, LEGACY_LIBRARY_CATEGORY_TO_TAG
from app.services.ingredient_search import canonical_sql, selected_ingredients
from app.services.recipe_timing import summarize_recipe_timing
from app.db.repo_content_safety import blocked_owner_ids
from app.services.content_safety_service import shareable_recipe_predicate

async def search_library(session,caller_id: uuid.UUID,*,scope="all",limit=40,cursor=None,q="",tags=None,ingredients=None,match="all",include_ingredients=False):
    if scope not in {"all","mine","catalog"}:raise ValueError("Invalid library scope")
    if match not in {"all","any"}:raise ValueError("Invalid ingredient matching rule")
    if not 1<=limit<=100:raise ValueError("Page limit must be between 1 and 100")
    q=q.strip().lower()
    if len(q)>200:raise ValueError("Search is limited to 200 characters")
    tags=sorted(coerce_library_tags(tags or []));selected=selected_ingredients(ingredients or [])
    names_needed=bool(selected) or include_ingredients
    cursor_scope=["search",scope,str(caller_id),q,tags,selected,match,names_needed]
    r=RecipeModel;copy=aliased(r)
    owned=and_(r.user_id==caller_id,r.is_library_hidden.is_(False))
    visible_copy=select(copy.id).where(copy.user_id==caller_id,copy.is_library_hidden.is_(False),copy.catalog_source_recipe_id==r.id).exists()
    public=and_(r.is_public_catalog.is_(True), r.catalog_suspended.is_(False),
        ~r.user_id.in_(blocked_owner_ids(caller_id)), shareable_recipe_predicate())
    visibility=owned if scope=="mine" else public if scope=="catalog" else or_(owned,and_(public,~visible_copy))
    predicates=[visibility]
    if q:predicates.append(func.lower(r.title).contains(q,autoescape=True))
    for tag in tags:
        legacy=[key for key,value in LEGACY_LIBRARY_CATEGORY_TO_TAG.items() if value==tag]
        predicates.append(or_(cast(r.library_tags,JSONB).contains([tag]),and_(or_(r.library_tags.is_(None),cast(r.library_tags,JSONB)==[]),r.library_category.in_([tag,*legacy]))))
    statement=recipe_summary_statement(caller_id).add_columns(owned.label("is_owned"))
    if names_needed:
        raw=cast(r.ingredients,JSONB)
        array=case((func.jsonb_typeof(raw)=="array",raw),else_=cast(literal("[]"),JSONB))
        entry=func.jsonb_array_elements(array).table_valued(column("value",JSONB)).alias("ingredient_entry")
        name=canonical_sql(entry.c.value["name"].astext)
        keys=select(func.coalesce(func.jsonb_agg(distinct(name)),cast(literal("[]"),JSONB)).label("keys")).select_from(entry).where(name.is_not(None),name!="").correlate(r).lateral("ingredient_keys")
        statement=statement.join(keys,true()).add_columns(keys.c["keys"].label("ingredient_keys"))
        matches=[keys.c["keys"].contains([value]) for value in selected]
        if matches:predicates.append(and_(*matches) if match=="all" else or_(*matches))
        matched_count=sum([case((condition,1),else_=0) for condition in matches],literal(0))
        remaining=func.jsonb_array_length(keys.c["keys"])-matched_count
    else:
        remaining=literal(0)
    # Count over the filtered library, never just the currently loaded page.
    statement=statement.where(*predicates).add_columns(remaining.label("remaining_count"))
    total=await session.scalar(select(func.count()).select_from(statement.with_only_columns(r.id).subquery()))
    if cursor:
        encoded,recipe_id=_decode_page_cursor(cursor,cursor_scope)
        try:
            rank,title=json.loads(encoded)
            if not isinstance(rank,int) or rank<0 or not isinstance(title,str):raise ValueError()
        except (ValueError,TypeError):raise ValueError("Invalid recipe cursor") from None
        statement=statement.where(tuple_(remaining,func.lower(r.title),r.id)>tuple_(rank,title,recipe_id))
    result=await session.execute(statement.order_by(remaining,func.lower(r.title),r.id).limit(limit+1))
    rows=result.mappings().all();items=[]
    for row in rows[:limit]:
        values=dict(row);values.pop("sort_title");values.pop("remaining_count")
        keys=sorted(values.pop("ingredient_keys",[]));wanted=set(selected)
        values.update(matched_ingredients=[k for k in keys if k in wanted],remaining_ingredients=[k for k in keys if k not in wanted] if names_needed else None)
        values["timing_summary"]=summarize_recipe_timing(values.pop("timing_steps",None))
        values["library_tags"]=coerce_library_tags(json.loads(values["library_tags"] or "[]") or values["library_category"])
        values["library_category"]=values["library_tags"][0] if values["library_tags"] else None
        items.append(LibraryRecipeSummary(**values))
    next_cursor=None
    if len(rows)>limit:
        row=rows[limit-1]
        next_cursor=_encode_page_cursor(cursor_scope,json.dumps([row["remaining_count"],row["sort_title"]],ensure_ascii=False),row["id"])
    return LibrarySearchPage(items=items,next_cursor=next_cursor,total_count=total or 0)
