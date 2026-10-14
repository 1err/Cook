"""Narrow explicit text checks for sharing; reports and human review remain necessary."""
import json
import re
import unicodedata

from fastapi import HTTPException
from pydantic import BaseModel

# Deliberately exclude ambiguous cooking terms such as breast, nuts or wine.
# This cannot classify images, intent, euphemisms, or all objectionable content.
_EXPLICIT_PATTERNS = (
    re.compile(r'\b(?:kill\s+yourself|child\s+porn(?:ography)?|white\s+supremacy|nigger(?:s)?)\b'),
    re.compile(r'(?:去死吧|杀死你|兒童色情|儿童色情)'),
)


def _text_values(value):
    if isinstance(value, BaseModel):
        value = value.model_dump()
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from _text_values(child)
    elif isinstance(value, (list, tuple)):
        for child in value:
            yield from _text_values(child)


def ensure_shareable_recipe(recipe) -> None:
    text = []
    for field in ('title', 'description', 'ingredients', 'steps', 'tips', 'equipment', 'library_tags'):
        value = getattr(recipe, field, None)
        if field not in ('title', 'description') and isinstance(value, str):
            try:
                value = json.loads(value)
            except ValueError:
                pass
        text.extend(_text_values(value))
    # The private raw extraction field is never published and must not affect
    # whether the public, edited cooking instructions can be shared.
    body = unicodedata.normalize('NFKC', " ".join(text)).casefold()
    if any(pattern.search(body) for pattern in _EXPLICIT_PATTERNS):
        raise HTTPException(422, 'This recipe contains text that cannot be shared. Review its public fields before publishing.')


def is_shareable_recipe(recipe) -> bool:
    try:
        ensure_shareable_recipe(recipe)
    except HTTPException:
        return False
    return True



def shareable_recipe_predicate(recipe_model=None):
    """Apply the sharing text rule before PostgreSQL pagination/counting.

    JSON scalar extraction preserves actual whitespace in nested public fields;
    raw import guidance and source URLs are outside this publication check.
    """
    from sqlalchemy import Text, cast, column, func, literal, literal_column, select
    from sqlalchemy.dialects.postgresql import JSONB, JSONPATH
    from app.db.models import RecipeModel
    r = recipe_model or RecipeModel
    document = func.jsonb_build_array(r.title, r.description, cast(r.ingredients, JSONB),
        cast(r.steps, JSONB), cast(r.tips, JSONB), cast(r.equipment, JSONB), cast(r.library_tags, JSONB))
    values = func.jsonb_path_query(document, cast(literal('$.** ? (@.type() == "string")'), JSONPATH)).table_valued(
        column('value', JSONB)).render_derived('public_recipe_text')
    scalar = cast(values.c.value.op('#>>')(literal_column("'{}'")), Text)
    joined = select(func.coalesce(func.string_agg(scalar, ' '), '')).select_from(values).correlate(r).scalar_subquery()
    normalized = func.lower(func.normalize(joined, literal_column('NFKC')))
    pattern = r'\y(kill[[:space:]]+yourself|child[[:space:]]+porn(ography)?|white[[:space:]]+supremacy|nigger(s)?)\y|去死吧|杀死你|兒童色情|儿童色情'
    return normalized.op('!~')(pattern)
