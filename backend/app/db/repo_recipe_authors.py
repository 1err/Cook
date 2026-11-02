"""An attribution directory, independent of accounts and recipe ownership."""
import json
import unicodedata
import uuid

from sqlalchemy import and_, func, literal_column, or_, select
from sqlalchemy.exc import IntegrityError

from app.db.models import RecipeAuthorModel, RecipeAuthorKeyModel
from app.models import RecipeAuthor


class AuthorIdentityConflict(ValueError):
    """Requested aliases already belong to a different canonical identity."""


class UnknownRecipeAuthor(ValueError):
    """The recipe references an author that is not in the directory."""


def clean_author_name(value: str) -> str:
    if len(value) > 80:
        raise ValueError("Author names must contain 1 to 80 visible characters")
    value = " ".join(unicodedata.normalize("NFKC", value).split())
    if not value or len(value) > 80 or any(unicodedata.category(c).startswith("C") for c in value):
        raise ValueError("Author names must contain 1 to 80 visible characters")
    return value


def normalize_author_name(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()


def normalize_recipe_query(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split()).lower()


def author_payload(row: RecipeAuthorModel | None) -> RecipeAuthor | None:
    if row is None:
        return None
    return RecipeAuthor(id=row.id, name=row.name, aliases=json.loads(row.aliases or "[]"))


async def get_author(session, author_id: str) -> RecipeAuthorModel | None:
    return (await session.execute(select(RecipeAuthorModel).where(RecipeAuthorModel.id == author_id))).scalars().one_or_none()


async def list_authors(session, *, q: str = "", limit: int = 40) -> list[RecipeAuthor]:
    if not 1 <= limit <= 100 or len(q) > 200:
        raise ValueError("Author search requires limit 1 to 100 and at most 200 search characters")
    statement = select(RecipeAuthorModel)
    query = normalize_author_name(q)
    if query:
        statement = statement.where(select(RecipeAuthorKeyModel.normalized_name).where(
            RecipeAuthorKeyModel.author_id == RecipeAuthorModel.id,
            RecipeAuthorKeyModel.normalized_name.contains(query, autoescape=True),
        ).exists())
    rows = (await session.execute(statement.order_by(func.lower(RecipeAuthorModel.name), RecipeAuthorModel.id).limit(limit))).scalars().all()
    return [author_payload(row) for row in rows]


async def create_author(session, name: str, aliases: list[str] | None = None) -> RecipeAuthor:
    name = clean_author_name(name)
    if len(aliases or []) > 8:
        raise ValueError("Authors support at most 8 aliases")
    normalized = normalize_author_name(name)
    display_aliases = []
    keys = {normalized}
    for alias in aliases or []:
        alias = clean_author_name(alias)
        key = normalize_author_name(alias)
        if key not in keys:
            display_aliases.append(alias)
            keys.add(key)

    async def existing():
        rows = (await session.execute(select(RecipeAuthorKeyModel).where(
            RecipeAuthorKeyModel.normalized_name.in_(sorted(keys)),
        ))).scalars().all()
        owners = {row.author_id for row in rows}
        primary = next((row.author_id for row in rows if row.normalized_name == normalized), None)
        if len(owners) > 1 or (owners and primary is None):
            raise AuthorIdentityConflict("An author name or alias already belongs to another creator")
        if primary:
            # Reusing a name never mutates an existing creator's aliases.
            return author_payload(await get_author(session, primary))
        return None

    for attempt in range(3):
        found = await existing()
        if found is not None:
            return found
        try:
            # The unique key table is authoritative across concurrent requests.
            # A savepoint rolls back the entire candidate, including its author.
            async with session.begin_nested():
                row = RecipeAuthorModel(id=str(uuid.uuid4()), name=name, aliases=json.dumps(display_aliases))
                session.add(row)
                await session.flush()
                for key in sorted(keys):
                    session.add(RecipeAuthorKeyModel(normalized_name=key, author_id=row.id))
                await session.flush()
            return author_payload(row)
        except IntegrityError:
            found = await existing()
            if found is not None:
                return found
            if attempt == 2:
                raise


def recipe_search_predicate(recipe, q: str):
    """Every query token may match title or credit, without multiplying rows."""
    title = func.lower(func.normalize(recipe.title, literal_column("NFKC")))
    return and_(*(or_(title.contains(token, autoescape=True), select(
        RecipeAuthorKeyModel.normalized_name,
    ).where(RecipeAuthorKeyModel.author_id == recipe.author_id,
            RecipeAuthorKeyModel.normalized_name.contains(normalize_author_name(token), autoescape=True)).exists())
        for token in normalize_recipe_query(q).split()))
