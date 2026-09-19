"""Shared bounded query validation for private, public and friend recipe lists."""
from fastapi import HTTPException, Query
from app.models import coerce_library_tags

class RecipePageQuery:
    def __init__(self, limit: int = Query(40, ge=1, le=100), cursor: str | None = Query(None, max_length=8192),
                 q: str = Query("", max_length=200), tags: list[str] = Query(default=[], max_length=32)):
        try:
            self.values = dict(limit=limit, cursor=cursor, q=q, tags=coerce_library_tags(tags))
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

async def read_page(session, caller_id, query, **scope):
    from app.db.repo_recipes import recipe_page
    try:
        return await recipe_page(session, caller_id, **scope, **query.values)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
