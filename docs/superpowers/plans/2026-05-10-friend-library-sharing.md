# Friend Library Sharing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any user opt to make their entire recipe library publicly searchable by email, browse other users' shared libraries, and copy individual recipes into their own library.

**Architecture:** New `users.is_library_public` boolean column. Three new HTTP endpoints under `/users/*` (search, list-recipes, copy) plus a `POST /auth/library-visibility` toggle. Friend-library auth gates on `users.is_library_public`; existing `/recipes/catalog/*` endpoints stay unchanged (per-recipe `is_public_catalog` for the editor-curated featured list). Mobile UI: search icon in Library header → push `FriendSearchScreen` → push `FriendLibraryScreen`. Web parity at `/library/friends` and `/library/friends/[userId]`.

**Tech Stack:** FastAPI + async SQLAlchemy + Alembic backend. Next.js 14 web. Expo SDK 54 / React Native 0.81 / React 19 mobile. Bearer auth (mobile) and cookie auth (web), shared `@cooking/api-client`. No pytest in this round — backend verification is a curl-driven smoke script (matches project convention; spec section "Testing strategy" pinned this).

**Spec:** `docs/superpowers/specs/2026-05-10-friend-library-sharing-design.md`

---

## File Structure

**Backend (new):**
- `backend/alembic/versions/20260510_user_library_public.py` — adds `users.is_library_public` column.
- `backend/app/db/repo_users.py` — friend-library data access (search, list, copy).
- `backend/app/api/routes_users.py` — friend-library HTTP routes + `/auth/library-visibility` lives in `auth.py`.
- `backend/scripts/smoke_friend_library.sh` — curl-driven smoke for all four endpoints.

**Backend (modify):**
- `backend/app/db/models.py` — add `is_library_public` to `UserModel`.
- `backend/app/api/auth.py` — extend `UserResponse` + `AuthResponse` with `is_library_public`; add `POST /auth/library-visibility`.
- `backend/app/main.py` — wire `routes_users.router`.

**Shared:**
- `packages/shared/src/types.ts` — new `User` interface with `is_library_public`.
- `packages/api-client/src/index.ts` — `users.searchByEmail`, `users.libraryRecipes`, `users.copyFriendRecipe`, `auth.setLibraryVisibility`. Update `auth.login` / `auth.register` / `auth.me` return types to include `is_library_public`.

**Mobile (new):**
- `apps/mobile/src/features/library/FriendSearchScreen.tsx`
- `apps/mobile/src/features/library/FriendLibraryScreen.tsx`

**Mobile (modify):**
- `apps/mobile/src/lib/auth.tsx` — `MobileUser` adds `is_library_public`; new `setLibraryVisibility` on context.
- `apps/mobile/src/features/profile/ProfileScreen.tsx` — Share-my-library toggle.
- `apps/mobile/src/features/library/LibraryListScreen.tsx` — search-icon header button.
- `apps/mobile/src/navigation/types.ts` — extend `LibraryStackParamList`.
- `apps/mobile/src/navigation/stacks/LibraryStack.tsx` — register the two new screens.

**Web (new):**
- `apps/web/app/library/friends/page.tsx`
- `apps/web/app/library/friends/[userId]/page.tsx`
- `apps/web/app/settings/page.tsx` (only if no settings page exists yet — confirm in Task 13).

**Web (modify):**
- `apps/web/app/library/page.tsx` — search-icon button in header.
- The web auth context (verify location in Task 13; likely `apps/web/app/lib/`) — extend `User` with `is_library_public`, expose a setter.

**Docs:**
- `CLAUDE.md` — add `/users/*` and `/auth/library-visibility` to the API table; brief note in Architecture section about friend library being orthogonal to public catalog.

---

## Task 0: Branch setup

**Files:**
- N/A (git operations only)

- [ ] **Step 1: Cherry-pick the spec commits to `main`**

The spec was committed on `chore/expo-sdk-54` (commits `90afdb3` and `8a0efa2`). Cherry-pick both onto `main` so the new feature branch starts with the spec already in place.

```bash
cd /Users/xiang1err_/Desktop/web_app/Cooking
git fetch
git checkout main
git cherry-pick 90afdb3 8a0efa2
git log --oneline -3   # confirm both spec commits are now on main
```

Expected: `main` has the two spec commits; working tree clean.

- [ ] **Step 2: Cut the implementation branch**

```bash
git checkout -b feat/friend-library-sharing
git status   # confirm: on branch feat/friend-library-sharing, working tree clean
```

- [ ] **Step 3: Confirm Docker stack is up (the smoke checks need the local backend)**

```bash
curl -s -o /dev/null -w "HTTP %{code}\n" http://localhost:8000/health
# Expected: HTTP 200. If 000, run `docker compose up -d` from the repo root and retry.
```

(No commit yet — this task only sets up state.)

---

## Task 1: Database migration + model fields

**Goal:** Add `users.is_library_public` everywhere it needs to exist (DB column, ORM model, Pydantic responses) so `/auth/me` returns the new field with `false` for all existing users.

**Files:**
- Create: `backend/alembic/versions/20260510_user_library_public.py`
- Modify: `backend/app/db/models.py` (`UserModel`)
- Modify: `backend/app/api/auth.py` (`UserResponse`, `AuthResponse`, both `from_model*` classmethods)

- [ ] **Step 1: Create the migration file**

```python
# backend/alembic/versions/20260510_user_library_public.py
"""Add users.is_library_public for friend library sharing.

Revision ID: 20260510_user_lib
Revises: 20260416_store_cache
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260510_user_lib"
down_revision: Union[str, None] = "20260416_store_cache"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "is_library_public",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "is_library_public")
```

- [ ] **Step 2: Run the migration in the backend container**

```bash
docker compose exec backend alembic upgrade head
# Expected output ends with: Running upgrade 20260416_store_cache -> 20260510_user_lib
```

If the alembic command fails because the container can't find the new file, run `docker compose restart backend` (the container should pick up the bind-mounted source — but check `backend/Dockerfile` to confirm; if not bind-mounted, `docker compose up -d --build backend`).

- [ ] **Step 3: Add `is_library_public` to `UserModel`**

In `backend/app/db/models.py`, find the `UserModel` class and add the field after `email`:

```python
class UserModel(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    is_library_public: Mapped[bool] = mapped_column(
        sa.Boolean(), nullable=False, server_default=sa.false()
    )
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now())
    auth_identities: Mapped[list["AuthIdentityModel"]] = relationship(
        # ...existing relationship config
    )
```

- [ ] **Step 4: Extend `UserResponse` and `AuthResponse` in `auth.py`**

In `backend/app/api/auth.py` (current code shown in the spec section "API"), update both classes:

```python
class UserResponse(BaseModel):
    id: str
    email: str
    is_library_public: bool

    @classmethod
    def from_model(cls, u: UserModel) -> "UserResponse":
        return cls(id=str(u.id), email=u.email, is_library_public=bool(u.is_library_public))


class AuthResponse(UserResponse):
    access_token: str | None = None

    @classmethod
    def from_model_with_token(cls, u: UserModel, token: str | None) -> "AuthResponse":
        return cls(
            id=str(u.id),
            email=u.email,
            is_library_public=bool(u.is_library_public),
            access_token=token,
        )
```

- [ ] **Step 5: Restart backend and smoke-test `/auth/me`**

```bash
docker compose restart backend
sleep 3

# Get a token by logging in (replace with a real local account password)
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jd@gmail.com","password":"YOUR_LOCAL_PASSWORD"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")
echo "$TOKEN"   # Expected: a non-empty JWT

# Hit /auth/me
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/auth/me | python3 -m json.tool
# Expected: {"id":"...","email":"jd@gmail.com","is_library_public":false}
```

If `is_library_public` is missing from the response, re-check Step 4. If the migration didn't run, re-check Step 2.

- [ ] **Step 6: Commit**

```bash
git add backend/alembic/versions/20260510_user_library_public.py \
        backend/app/db/models.py \
        backend/app/api/auth.py
git commit -m "$(cat <<'EOF'
feat(backend): add users.is_library_public column + surface in auth responses

Schema: add boolean column with server_default false. Pydantic UserResponse
and AuthResponse both expose is_library_public so /auth/me, /auth/login,
and /auth/register all include it. No behavior change yet — endpoints
that consume the flag come in subsequent commits.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `POST /auth/library-visibility` toggle endpoint

**Goal:** The current user can flip their own `is_library_public` flag.

**Files:**
- Modify: `backend/app/api/auth.py` (new route + body model)

- [ ] **Step 1: Write the smoke check (will fail until implementation lands)**

```bash
# With $TOKEN from Task 1's smoke
curl -s -o /dev/null -w "HTTP %{code}\n" -X POST http://localhost:8000/auth/library-visibility \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_public":true}'
# Expected NOW: HTTP 405 or 404 (route doesn't exist yet).
```

- [ ] **Step 2: Add the body model and route**

In `backend/app/api/auth.py`, add near the existing route handlers:

```python
class LibraryVisibilityBody(BaseModel):
    is_public: bool


class LibraryVisibilityResponse(BaseModel):
    is_library_public: bool


@router.post("/library-visibility", response_model=LibraryVisibilityResponse)
async def set_library_visibility(
    body: LibraryVisibilityBody,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    current_user.is_library_public = bool(body.is_public)
    await session.flush()
    return LibraryVisibilityResponse(is_library_public=current_user.is_library_public)
```

- [ ] **Step 3: Restart backend and re-run the smoke**

```bash
docker compose restart backend
sleep 3

# Toggle ON
curl -s -X POST http://localhost:8000/auth/library-visibility \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_public":true}' | python3 -m json.tool
# Expected: {"is_library_public":true}

# Confirm /auth/me reflects it
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/auth/me | python3 -m json.tool
# Expected: {"id":"...","email":"jd@gmail.com","is_library_public":true}

# Toggle OFF
curl -s -X POST http://localhost:8000/auth/library-visibility \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_public":false}' | python3 -m json.tool
# Expected: {"is_library_public":false}
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/auth.py
git commit -m "$(cat <<'EOF'
feat(backend): POST /auth/library-visibility — flip is_library_public

Single-boolean body. Returns the updated value. Authentication via the
standard get_current_user dependency. No friend-library reads/writes are
gated on this yet — those routes land in the next commits.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `repo_users.search_public_library_user` + `GET /users/search`

**Goal:** Search for another user by exact email; return them only if they're not the caller AND their library is public.

**Files:**
- Create: `backend/app/db/repo_users.py`
- Create: `backend/app/api/routes_users.py`
- Modify: `backend/app/main.py` (mount the new router)

- [ ] **Step 1: Smoke check (will fail — route doesn't exist)**

```bash
curl -s -o /dev/null -w "HTTP %{code}\n" \
  "http://localhost:8000/users/search?email=jerryxiang24@gmail.com" \
  -H "Authorization: Bearer $TOKEN"
# Expected NOW: HTTP 404 (route not found)
```

- [ ] **Step 2: Create `repo_users.py` with the search helper**

```python
# backend/app/db/repo_users.py
"""User-scoped data access for friend library sharing.

Authorization (e.g., is_library_public gating) lives in the route layer;
these functions just do the SQL.
"""
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import UserModel


async def search_public_library_user(
    session: AsyncSession,
    email: str,
    exclude_user_id: uuid.UUID,
) -> Optional[UserModel]:
    """Exact-email lookup that only returns users with a public library and not the caller.

    Returns None for: no match, library private, or self-match. The route turns
    None into a 404 — same response for all three cases to avoid enumeration leaks.
    """
    normalized = email.strip().lower()
    if not normalized:
        return None
    result = await session.execute(
        select(UserModel).where(UserModel.email == normalized)
    )
    user = result.scalars().one_or_none()
    if user is None:
        return None
    if user.id == exclude_user_id:
        return None
    if not bool(user.is_library_public):
        return None
    return user
```

- [ ] **Step 3: Create `routes_users.py` with the search route**

```python
# backend/app/api/routes_users.py
"""Friend library sharing routes.

GET /users/search?email=...        — find a user by email if their library is public
GET /users/{user_id}/recipes       — list a user's recipes if their library is public
POST /users/{user_id}/recipes/{recipe_id}/copy — clone into the caller's library
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.db import repo_users
from app.db.models import UserModel
from app.db.session import get_session


router = APIRouter(prefix="/users", tags=["users"])


class PublicUserResponse(BaseModel):
    id: str
    email: str
    is_library_public: bool


@router.get("/search", response_model=PublicUserResponse)
async def search_users(
    email: EmailStr = Query(..., description="Exact email to look up"),
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    user = await repo_users.search_public_library_user(session, str(email), current_user.id)
    if user is None:
        raise HTTPException(404, "No public library found for that email.")
    return PublicUserResponse(
        id=str(user.id),
        email=user.email,
        is_library_public=bool(user.is_library_public),
    )
```

- [ ] **Step 4: Mount the router in `main.py`**

In `backend/app/main.py`, find where the other routers are mounted and add:

```python
from app.api import routes_users  # noqa: E402  (alongside other api imports)

# ...where existing routers are included:
app.include_router(routes_users.router)
```

- [ ] **Step 5: Restart backend and smoke**

```bash
docker compose restart backend
sleep 3

# Toggle jd@gmail.com's library public for testing
TOKEN_JD=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jd@gmail.com","password":"YOUR_PW"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")
curl -s -X POST http://localhost:8000/auth/library-visibility \
  -H "Authorization: Bearer $TOKEN_JD" \
  -H "Content-Type: application/json" \
  -d '{"is_public":true}' >/dev/null

# Sign in as a different user — register one if needed
TOKEN_BOB=$(curl -s -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"bob+test@example.com","password":"abcdefgh"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")

# As Bob, search for jd's email — expect 200 with jd's id
curl -s -w "\nHTTP %{http_code}\n" \
  "http://localhost:8000/users/search?email=jd@gmail.com" \
  -H "Authorization: Bearer $TOKEN_BOB"
# Expected: 200 with {"id":"...","email":"jd@gmail.com","is_library_public":true}

# As Bob, search for himself — expect 404
curl -s -w "\nHTTP %{http_code}\n" \
  "http://localhost:8000/users/search?email=bob+test@example.com" \
  -H "Authorization: Bearer $TOKEN_BOB"
# Expected: 404

# Toggle jd off, search again — expect 404
curl -s -X POST http://localhost:8000/auth/library-visibility \
  -H "Authorization: Bearer $TOKEN_JD" \
  -H "Content-Type: application/json" \
  -d '{"is_public":false}' >/dev/null
curl -s -w "\nHTTP %{http_code}\n" \
  "http://localhost:8000/users/search?email=jd@gmail.com" \
  -H "Authorization: Bearer $TOKEN_BOB"
# Expected: 404

# Re-toggle jd on for the next tasks
curl -s -X POST http://localhost:8000/auth/library-visibility \
  -H "Authorization: Bearer $TOKEN_JD" \
  -H "Content-Type: application/json" \
  -d '{"is_public":true}' >/dev/null
```

All three expectations must hold. If any fails, re-check Steps 2–4.

- [ ] **Step 6: Commit**

```bash
git add backend/app/db/repo_users.py \
        backend/app/api/routes_users.py \
        backend/app/main.py
git commit -m "$(cat <<'EOF'
feat(backend): GET /users/search — find friend by exact email

Returns 200 with {id, email, is_library_public} only when the target
user's library is public AND they're not the caller. Returns 404 for
any other case (no match, library private, self-search) — uniform
response prevents enumeration of registered emails.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `GET /users/{user_id}/recipes` — list a friend's library

**Goal:** Return all recipes owned by `user_id` if their library is public.

**Files:**
- Modify: `backend/app/db/repo_users.py` (add `list_friend_library_recipes`)
- Modify: `backend/app/api/routes_users.py` (add the route)

- [ ] **Step 1: Smoke (fails — route doesn't exist)**

```bash
# Use jd's id (saved from the search response in Task 3 Step 5)
JD_ID=$(curl -s "http://localhost:8000/users/search?email=jd@gmail.com" \
  -H "Authorization: Bearer $TOKEN_BOB" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
echo "$JD_ID"   # confirm it's a UUID

curl -s -o /dev/null -w "HTTP %{code}\n" \
  "http://localhost:8000/users/$JD_ID/recipes" \
  -H "Authorization: Bearer $TOKEN_BOB"
# Expected NOW: HTTP 404
```

- [ ] **Step 2: Add `list_friend_library_recipes` to `repo_users.py`**

Append to `backend/app/db/repo_users.py`:

```python
from sqlalchemy import func
from app.db.models import RecipeModel
# (Imports go at the top of the file alongside the existing ones.)


async def list_friend_library_recipes(
    session: AsyncSession,
    owner_user_id: uuid.UUID,
) -> list[RecipeModel]:
    """All RecipeModel rows owned by owner_user_id, alphabetical by title.

    Authorization (owner.is_library_public) is enforced in the route layer,
    not here.
    """
    result = await session.execute(
        select(RecipeModel)
        .where(RecipeModel.user_id == owner_user_id)
        .order_by(func.lower(RecipeModel.title), RecipeModel.id)
    )
    return list(result.scalars().all())


async def get_user_by_id(session: AsyncSession, user_id: uuid.UUID) -> Optional[UserModel]:
    """Lookup helper local to friend-library routes (avoids importing repo_auth)."""
    result = await session.execute(select(UserModel).where(UserModel.id == user_id))
    return result.scalars().one_or_none()
```

- [ ] **Step 3: Add the list route to `routes_users.py`**

In `backend/app/api/routes_users.py`, add:

```python
from app.db.repo_recipes import _row_to_recipe  # private helper; if unavailable, copy its body inline
from app.models import Recipe


@router.get("/{user_id}/recipes", response_model=list[Recipe])
async def friend_library_recipes(
    user_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    if user_id == current_user.id:
        raise HTTPException(404, "Library not found.")
    owner = await repo_users.get_user_by_id(session, user_id)
    if owner is None or not bool(owner.is_library_public):
        raise HTTPException(404, "Library not found.")
    rows = await repo_users.list_friend_library_recipes(session, user_id)
    return [_row_to_recipe(r) for r in rows]
```

If `_row_to_recipe` is private (leading underscore) and you'd rather not import it directly, expose a public alias in `repo_recipes.py`: `row_to_recipe = _row_to_recipe`, and import that.

- [ ] **Step 4: Restart, smoke**

```bash
docker compose restart backend
sleep 3

# As Bob, list jd's recipes (jd's library is public from Task 3)
curl -s -w "\nHTTP %{http_code}\n" \
  "http://localhost:8000/users/$JD_ID/recipes" \
  -H "Authorization: Bearer $TOKEN_BOB" | python3 -m json.tool | head -25
# Expected: HTTP 200, JSON array of Recipe objects (jd has at least one recipe).

# Bob listing himself — 404
curl -s -w "\nHTTP %{http_code}\n" \
  "http://localhost:8000/users/$(python3 -c "import json;print(json.loads(open('/tmp/_').read())['id'])" 2>/dev/null || echo "INVALID-UUID")/recipes" \
  -H "Authorization: Bearer $TOKEN_BOB" >/dev/null
# Easier: just hit a fake UUID
curl -s -o /dev/null -w "HTTP %{code}\n" \
  "http://localhost:8000/users/00000000-0000-0000-0000-000000000000/recipes" \
  -H "Authorization: Bearer $TOKEN_BOB"
# Expected: 404

# Toggle jd off, list — 404
curl -s -X POST http://localhost:8000/auth/library-visibility \
  -H "Authorization: Bearer $TOKEN_JD" -H "Content-Type: application/json" \
  -d '{"is_public":false}' >/dev/null
curl -s -o /dev/null -w "HTTP %{code}\n" \
  "http://localhost:8000/users/$JD_ID/recipes" \
  -H "Authorization: Bearer $TOKEN_BOB"
# Expected: 404

# Re-toggle on
curl -s -X POST http://localhost:8000/auth/library-visibility \
  -H "Authorization: Bearer $TOKEN_JD" -H "Content-Type: application/json" \
  -d '{"is_public":true}' >/dev/null
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/db/repo_users.py backend/app/api/routes_users.py
git commit -m "$(cat <<'EOF'
feat(backend): GET /users/{id}/recipes — list a friend's library

Returns Recipe[] if the target user's library is public and they aren't
the caller. 404 in every other case (uniform response — no leak about
whether the user exists vs. has a private library).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `POST /users/{user_id}/recipes/{recipe_id}/copy`

**Goal:** Idempotently clone a recipe owned by `user_id` into the caller's library, gated on the source user's library being public.

**Files:**
- Modify: `backend/app/db/repo_users.py` (add `copy_friend_recipe_to_user`)
- Modify: `backend/app/api/routes_users.py` (add the route)

- [ ] **Step 1: Smoke (fails)**

```bash
# Pick one of jd's recipes
JD_RECIPE_ID=$(curl -s "http://localhost:8000/users/$JD_ID/recipes" \
  -H "Authorization: Bearer $TOKEN_BOB" \
  | python3 -c "import json,sys; rows=json.load(sys.stdin); print(rows[0]['id'] if rows else '')")
echo "$JD_RECIPE_ID"   # confirm

curl -s -o /dev/null -w "HTTP %{code}\n" \
  -X POST "http://localhost:8000/users/$JD_ID/recipes/$JD_RECIPE_ID/copy" \
  -H "Authorization: Bearer $TOKEN_BOB"
# Expected NOW: HTTP 404 (route not found) or 405
```

- [ ] **Step 2: Add `copy_friend_recipe_to_user` to `repo_users.py`**

```python
import uuid as _uuid

from sqlalchemy.ext.asyncio import AsyncSession
# (alongside existing imports)

from app.db.models import RecipeModel
from app.models import Recipe
from app.db.repo_recipes import _row_to_recipe  # or use the public alias added in Task 4


async def copy_friend_recipe_to_user(
    session: AsyncSession,
    source_user_id: uuid.UUID,
    recipe_id: str,
    caller_user_id: uuid.UUID,
) -> Optional[Recipe]:
    """Clone a recipe from a public-library user into the caller's library.

    Returns None when:
      - source user doesn't exist or library isn't public
      - caller IS the source user (no self-copy)
      - source recipe doesn't exist or isn't owned by source_user_id

    Idempotent: if caller already has a row with catalog_source_recipe_id == recipe_id,
    that row is returned instead of inserting a duplicate.
    """
    if source_user_id == caller_user_id:
        return None

    owner = await get_user_by_id(session, source_user_id)
    if owner is None or not bool(owner.is_library_public):
        return None

    source_result = await session.execute(
        select(RecipeModel).where(
            RecipeModel.id == recipe_id,
            RecipeModel.user_id == source_user_id,
        )
    )
    source = source_result.scalars().one_or_none()
    if source is None:
        return None

    existing_result = await session.execute(
        select(RecipeModel).where(
            RecipeModel.user_id == caller_user_id,
            RecipeModel.catalog_source_recipe_id == recipe_id,
        )
    )
    existing = existing_result.scalars().one_or_none()
    if existing is not None:
        return _row_to_recipe(existing)

    clone = RecipeModel(
        id=str(_uuid.uuid4()),
        user_id=caller_user_id,
        title=source.title,
        source_url=source.source_url,
        thumbnail_url=source.thumbnail_url,
        ingredients=source.ingredients,
        raw_extraction_text=source.raw_extraction_text,
        library_tags=source.library_tags,
        library_category=source.library_category,
        is_public_catalog=False,
        catalog_source_recipe_id=source.id,
    )
    session.add(clone)
    await session.flush()
    return _row_to_recipe(clone)
```

- [ ] **Step 3: Add the copy route**

In `backend/app/api/routes_users.py`:

```python
@router.post("/{user_id}/recipes/{recipe_id}/copy", response_model=Recipe)
async def copy_friend_recipe(
    user_id: uuid.UUID,
    recipe_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    copy = await repo_users.copy_friend_recipe_to_user(
        session, user_id, recipe_id, current_user.id
    )
    if copy is None:
        raise HTTPException(404, "Recipe not available for copy.")
    return copy
```

- [ ] **Step 4: Smoke**

```bash
docker compose restart backend
sleep 3

# Bob copies one of jd's recipes — expect 200 with cloned recipe (different id)
curl -s -w "\nHTTP %{http_code}\n" \
  -X POST "http://localhost:8000/users/$JD_ID/recipes/$JD_RECIPE_ID/copy" \
  -H "Authorization: Bearer $TOKEN_BOB" | python3 -m json.tool | head -10
# Expected: 200, response has a NEW id, same title, catalog_source_recipe_id matches $JD_RECIPE_ID

# Bob copies the same recipe again — expect 200, same returned id (idempotent)
COPY_ID_1=$(curl -s -X POST "http://localhost:8000/users/$JD_ID/recipes/$JD_RECIPE_ID/copy" \
  -H "Authorization: Bearer $TOKEN_BOB" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
COPY_ID_2=$(curl -s -X POST "http://localhost:8000/users/$JD_ID/recipes/$JD_RECIPE_ID/copy" \
  -H "Authorization: Bearer $TOKEN_BOB" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
[ "$COPY_ID_1" = "$COPY_ID_2" ] && echo "IDEMPOTENT OK" || echo "FAIL: $COPY_ID_1 vs $COPY_ID_2"

# Toggle jd off; Bob's copy attempt — expect 404
curl -s -X POST http://localhost:8000/auth/library-visibility \
  -H "Authorization: Bearer $TOKEN_JD" -H "Content-Type: application/json" \
  -d '{"is_public":false}' >/dev/null
curl -s -o /dev/null -w "HTTP %{code}\n" \
  -X POST "http://localhost:8000/users/$JD_ID/recipes/$JD_RECIPE_ID/copy" \
  -H "Authorization: Bearer $TOKEN_BOB"
# Expected: 404

# Bob's previously-copied recipe still exists in his library
curl -s "http://localhost:8000/recipes" -H "Authorization: Bearer $TOKEN_BOB" \
  | python3 -c "import json,sys; rows=json.load(sys.stdin); print('found' if any(r['id']=='$COPY_ID_1' for r in rows) else 'GONE')"
# Expected: "found"

# Re-toggle jd on
curl -s -X POST http://localhost:8000/auth/library-visibility \
  -H "Authorization: Bearer $TOKEN_JD" -H "Content-Type: application/json" \
  -d '{"is_public":true}' >/dev/null
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/db/repo_users.py backend/app/api/routes_users.py
git commit -m "$(cat <<'EOF'
feat(backend): POST /users/{id}/recipes/{rid}/copy — clone friend recipe

Idempotent (re-tapping returns the existing copy with the same
catalog_source_recipe_id). Gated on source user's is_library_public.
Sets catalog_source_recipe_id on the clone so already-copied detection
works the same way as the global public catalog copy flow.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Backend smoke script

**Goal:** Bundle the four ad-hoc curl flows into one runnable script for repeatable verification.

**Files:**
- Create: `backend/scripts/smoke_friend_library.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# backend/scripts/smoke_friend_library.sh
# End-to-end smoke for the friend-library-sharing endpoints. Requires:
#   - Local Docker stack running (backend on http://localhost:8000)
#   - Two test users you know the passwords for. Defaults: jd@gmail.com and bob+test@example.com.
#   - jq for JSON parsing (brew install jq if missing)
#
# Usage:
#   bash backend/scripts/smoke_friend_library.sh <jd-pw> <bob-pw>

set -euo pipefail
BASE="${BASE:-http://localhost:8000}"
JD_PW="${1:?Usage: smoke_friend_library.sh <jd-pw> <bob-pw>}"
BOB_PW="${2:?Usage: smoke_friend_library.sh <jd-pw> <bob-pw>}"
JD_EMAIL="${JD_EMAIL:-jd@gmail.com}"
BOB_EMAIL="${BOB_EMAIL:-bob+test@example.com}"

echo "==> login jd"
JD_TOKEN=$(curl -fsS -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$JD_EMAIL\",\"password\":\"$JD_PW\"}" | jq -r .access_token)
[ -n "$JD_TOKEN" ] || { echo "jd login failed"; exit 1; }

echo "==> login or register bob"
BOB_TOKEN=$(curl -fsS -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$BOB_EMAIL\",\"password\":\"$BOB_PW\"}" | jq -r .access_token 2>/dev/null || true)
if [ -z "$BOB_TOKEN" ] || [ "$BOB_TOKEN" = "null" ]; then
  BOB_TOKEN=$(curl -fsS -X POST "$BASE/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$BOB_EMAIL\",\"password\":\"$BOB_PW\"}" | jq -r .access_token)
fi
[ -n "$BOB_TOKEN" ] || { echo "bob auth failed"; exit 1; }

echo "==> jd toggles library public"
curl -fsS -X POST "$BASE/auth/library-visibility" \
  -H "Authorization: Bearer $JD_TOKEN" -H "Content-Type: application/json" \
  -d '{"is_public":true}' >/dev/null

echo "==> bob searches jd"
JD_ID=$(curl -fsS "$BASE/users/search?email=$JD_EMAIL" \
  -H "Authorization: Bearer $BOB_TOKEN" | jq -r .id)
[ -n "$JD_ID" ] || { echo "search failed"; exit 1; }
echo "    JD_ID=$JD_ID"

echo "==> bob lists jd's recipes"
JD_RECIPE_ID=$(curl -fsS "$BASE/users/$JD_ID/recipes" \
  -H "Authorization: Bearer $BOB_TOKEN" | jq -r '.[0].id // empty')
[ -n "$JD_RECIPE_ID" ] || { echo "jd has no recipes — add one before re-running"; exit 1; }
echo "    JD_RECIPE_ID=$JD_RECIPE_ID"

echo "==> bob copies"
COPY1=$(curl -fsS -X POST "$BASE/users/$JD_ID/recipes/$JD_RECIPE_ID/copy" \
  -H "Authorization: Bearer $BOB_TOKEN" | jq -r .id)
COPY2=$(curl -fsS -X POST "$BASE/users/$JD_ID/recipes/$JD_RECIPE_ID/copy" \
  -H "Authorization: Bearer $BOB_TOKEN" | jq -r .id)
[ "$COPY1" = "$COPY2" ] || { echo "non-idempotent copy: $COPY1 vs $COPY2"; exit 1; }
echo "    idempotent copy id: $COPY1"

echo "==> jd toggles library OFF, bob's search and copy should 404"
curl -fsS -X POST "$BASE/auth/library-visibility" \
  -H "Authorization: Bearer $JD_TOKEN" -H "Content-Type: application/json" \
  -d '{"is_public":false}' >/dev/null
SEARCH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/users/search?email=$JD_EMAIL" \
  -H "Authorization: Bearer $BOB_TOKEN")
[ "$SEARCH_CODE" = "404" ] || { echo "expected 404 search after toggle off, got $SEARCH_CODE"; exit 1; }
COPY_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$BASE/users/$JD_ID/recipes/$JD_RECIPE_ID/copy" \
  -H "Authorization: Bearer $BOB_TOKEN")
[ "$COPY_CODE" = "404" ] || { echo "expected 404 copy after toggle off, got $COPY_CODE"; exit 1; }

echo "==> restoring jd library to public"
curl -fsS -X POST "$BASE/auth/library-visibility" \
  -H "Authorization: Bearer $JD_TOKEN" -H "Content-Type: application/json" \
  -d '{"is_public":true}' >/dev/null

echo "ALL GREEN"
```

- [ ] **Step 2: Make it executable and run it**

```bash
chmod +x backend/scripts/smoke_friend_library.sh
bash backend/scripts/smoke_friend_library.sh "<JD_PASSWORD>" "<BOB_PASSWORD>"
# Expected last line: ALL GREEN
```

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/smoke_friend_library.sh
git commit -m "$(cat <<'EOF'
test(backend): smoke script for friend-library endpoints

Drives all four endpoints with two test accounts. Verifies search /
list / copy work when library is public, all return 404 when private,
copy is idempotent. Replaces a pytest suite for this feature; building
out real pytest coverage is a separate project-wide initiative.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Shared types + api-client typed methods

**Goal:** Add the `User` type and the four typed client methods so mobile and web don't duplicate fetch logic.

**Files:**
- Modify: `packages/shared/src/types.ts` (new `User` interface)
- Modify: `packages/api-client/src/index.ts` (new `users` block + extended `auth` returns)

- [ ] **Step 1: Add `User` to shared types**

In `packages/shared/src/types.ts`, append:

```ts
export interface User {
  id: string;
  email: string;
  is_library_public: boolean;
}
```

- [ ] **Step 2: Extend `packages/api-client/src/index.ts`**

Find the existing `auth` block. The `login` and `register` methods currently return `{id, email, access_token?}`. Update those types to also include `is_library_public`. Add `setLibraryVisibility` and the new `users` block.

```ts
// near the top, alongside other type imports:
import type { MealPlanDay, Recipe, RecipeTagSlug, ShoppingListItem, User } from "@cooking/shared";

// inside the returned object literal, replace the auth block's `login` and `register`:
auth: {
  login: (email: string, password: string) =>
    json<User & { access_token?: string }>(`/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string) =>
    json<User & { access_token?: string }>(`/auth/register`, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => json<User>("/auth/me"),
  logout: () => json<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  setLibraryVisibility: (isPublic: boolean) =>
    json<{ is_library_public: boolean }>("/auth/library-visibility", {
      method: "POST",
      body: JSON.stringify({ is_public: isPublic }),
    }),
},

// add a new top-level block after `recipes`:
users: {
  searchByEmail: (email: string) =>
    json<User>(`/users/search?email=${encodeURIComponent(email)}`),
  libraryRecipes: (userId: string) =>
    json<Recipe[]>(`/users/${encodeURIComponent(userId)}/recipes`),
  copyFriendRecipe: (userId: string, recipeId: string) =>
    json<Recipe>(
      `/users/${encodeURIComponent(userId)}/recipes/${encodeURIComponent(recipeId)}/copy`,
      { method: "POST" },
    ),
},
```

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/xiang1err_/Desktop/web_app/Cooking
node ./node_modules/typescript/bin/tsc --noEmit -p packages/api-client/tsconfig.json
echo "exit=$?"
# Expected: exit=0
```

If it errors with "is_library_public missing", you didn't update the existing call sites — but that's fine for now; mobile/web will pick it up in their own tasks.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts packages/api-client/src/index.ts
git commit -m "$(cat <<'EOF'
feat(shared,api-client): User type + friend-library client methods

Adds users.searchByEmail, users.libraryRecipes, users.copyFriendRecipe
plus auth.setLibraryVisibility. Extends auth.login / register / me
return types with is_library_public.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Mobile auth context — extend `MobileUser` with `is_library_public`

**Goal:** Mobile knows whether the current user has library sharing on, and can flip it.

**Files:**
- Modify: `apps/mobile/src/lib/auth.tsx`

- [ ] **Step 1: Extend `MobileUser` and the context API**

Replace the relevant sections of `apps/mobile/src/lib/auth.tsx`:

```tsx
type MobileUser = {
  id: string;
  email: string;
  is_library_public: boolean;
};

type AuthContextValue = {
  token: string | null;
  user: MobileUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setLibraryVisibility: (isPublic: boolean) => Promise<void>;
};
```

Inside `AuthProvider`, the bootstrap effect already fetches `/auth/me` — it now naturally returns `is_library_public`. Update the `setUser` calls in `login` and `register` to include the new field:

```tsx
const login = useCallback(async (email: string, password: string) => {
  const client = buildClient(null);
  const res = await client.auth.login(email, password);
  if (!res.access_token) throw new Error("Token missing from login response");
  await SecureStore.setItemAsync(TOKEN_KEY, res.access_token);
  setToken(res.access_token);
  setUser({ id: res.id, email: res.email, is_library_public: res.is_library_public });
}, []);

const register = useCallback(async (email: string, password: string) => {
  const client = buildClient(null);
  const res = await client.auth.register(email, password);
  if (!res.access_token) throw new Error("Token missing from register response");
  await SecureStore.setItemAsync(TOKEN_KEY, res.access_token);
  setToken(res.access_token);
  setUser({ id: res.id, email: res.email, is_library_public: res.is_library_public });
}, []);
```

Add the new context method:

```tsx
const setLibraryVisibility = useCallback(async (isPublic: boolean) => {
  const currentToken = token;
  if (!currentToken) throw new Error("Not signed in");
  const client = buildClient(currentToken);
  const res = await client.auth.setLibraryVisibility(isPublic);
  setUser((prev) => (prev ? { ...prev, is_library_public: res.is_library_public } : prev));
}, [token]);
```

Include `setLibraryVisibility` in the `useMemo`'d context value.

- [ ] **Step 2: TypeScript check**

```bash
node ./node_modules/typescript/bin/tsc --noEmit -p apps/mobile/tsconfig.json
echo "exit=$?"
# Expected: exit=0
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/lib/auth.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): expose is_library_public + setLibraryVisibility on auth ctx

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Mobile Profile — "Share my library" toggle

**Goal:** A switch in the Profile tab that flips the auth user's `is_library_public`.

**Files:**
- Modify: `apps/mobile/src/features/profile/ProfileScreen.tsx`

- [ ] **Step 1: Look at the current Profile screen, identify where rows live**

```bash
cat apps/mobile/src/features/profile/ProfileScreen.tsx | head -80
```

Note where existing rows (e.g., logout button, account info) are rendered.

- [ ] **Step 2: Add the toggle row**

Import `Switch` from `react-native`, `useState` from React (for in-flight state), and `Alert` for error display. Use the existing `useAuth()` and the `ListRow` primitive if present, or follow whatever row style is already used.

Inline example (adapt to the existing component idioms):

```tsx
import React, { useState } from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import { useAuth } from "../../lib/auth";
import { colors, spacing, typography } from "../../theme";

// inside the component:
const { user, setLibraryVisibility } = useAuth();
const [pending, setPending] = useState(false);

const onToggle = async (next: boolean) => {
  if (pending || !user) return;
  setPending(true);
  try {
    await setLibraryVisibility(next);
  } catch (e) {
    Alert.alert("Couldn't update", e instanceof Error ? e.message : "Please try again.");
  } finally {
    setPending(false);
  }
};

// inside the JSX, render this row alongside other settings:
<View style={styles.row}>
  <View style={styles.rowText}>
    <Text style={styles.rowTitle}>Share my library</Text>
    <Text style={styles.rowSubtitle}>
      Anyone who knows your email can browse and copy your recipes.
    </Text>
  </View>
  <Switch
    value={user?.is_library_public ?? false}
    onValueChange={onToggle}
    disabled={pending || !user}
  />
</View>
```

Add styles:

```tsx
row: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.lg,
  gap: spacing.md,
},
rowText: { flex: 1 },
rowTitle: { ...typography.headline, color: colors.onSurface },
rowSubtitle: { ...typography.subhead, color: colors.onSurfaceVariant, marginTop: 2 },
```

- [ ] **Step 3: tsc + simulator smoke**

```bash
node ./node_modules/typescript/bin/tsc --noEmit -p apps/mobile/tsconfig.json
echo "exit=$?"   # Expected: 0

# In another terminal: cd apps/mobile && npx expo start --clear
# Reload the simulator. Open Profile tab. Toggle the switch on/off.
# Verify with curl that /auth/me shows the same value.
```

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/features/profile/ProfileScreen.tsx
git commit -m "feat(mobile): Profile 'Share my library' toggle

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Mobile Library — header search icon + nav types + screen registration

**Goal:** Library tab header gets a search icon next to the existing `+`. Tapping pushes a new `FriendSearchScreen`.

**Files:**
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/stacks/LibraryStack.tsx`
- Modify: `apps/mobile/src/features/library/LibraryListScreen.tsx`
- Create (placeholder): `apps/mobile/src/features/library/FriendSearchScreen.tsx`
- Create (placeholder): `apps/mobile/src/features/library/FriendLibraryScreen.tsx`

The two screens get full implementations in Tasks 11 and 12; here we register placeholders so the navigation typing/wiring compiles.

- [ ] **Step 1: Extend `LibraryStackParamList`**

In `apps/mobile/src/navigation/types.ts`:

```ts
export type LibraryStackParamList = {
  LibraryList: undefined;
  RecipeDetail: { recipeId: string };
  RecipeEdit: { recipeId?: string } | undefined;
  FriendSearch: undefined;
  FriendLibrary: { userId: string; email: string };
};
```

- [ ] **Step 2: Stub the two new screens**

```tsx
// apps/mobile/src/features/library/FriendSearchScreen.tsx
import React from "react";
import { Text, View, StyleSheet } from "react-native";
import { colors, spacing, typography } from "../../theme";

export function FriendSearchScreen() {
  return (
    <View style={styles.center}>
      <Text style={styles.placeholder}>Friend search — coming next task</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.lg },
  placeholder: { ...typography.body, color: colors.onSurfaceVariant },
});
```

```tsx
// apps/mobile/src/features/library/FriendLibraryScreen.tsx
import React from "react";
import { Text, View, StyleSheet } from "react-native";
import { colors, spacing, typography } from "../../theme";

export function FriendLibraryScreen() {
  return (
    <View style={styles.center}>
      <Text style={styles.placeholder}>Friend library — coming next task</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.lg },
  placeholder: { ...typography.body, color: colors.onSurfaceVariant },
});
```

- [ ] **Step 3: Register both in `LibraryStack.tsx`**

In `apps/mobile/src/navigation/stacks/LibraryStack.tsx`, add the two `<Stack.Screen>` entries:

```tsx
import { FriendSearchScreen } from "../../features/library/FriendSearchScreen";
import { FriendLibraryScreen } from "../../features/library/FriendLibraryScreen";

// inside the navigator JSX, alongside the existing screens:
<Stack.Screen
  name="FriendSearch"
  component={FriendSearchScreen}
  options={{ title: "Find a friend" }}
/>
<Stack.Screen
  name="FriendLibrary"
  component={FriendLibraryScreen}
  options={({ route }) => ({ title: route.params.email })}
/>
```

- [ ] **Step 4: Add the search icon to the Library list header**

In `apps/mobile/src/features/library/LibraryListScreen.tsx`, find the existing `useLayoutEffect` that sets `headerRight`. Replace it with a two-button header (search + import):

```tsx
useLayoutEffect(() => {
  navigation.setOptions({
    headerRight: () => (
      <View style={styles.headerActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Find a friend"
          onPress={() => navigation.navigate("FriendSearch")}
          hitSlop={12}
          style={({ pressed }) => [styles.headerIconBtn, pressed && styles.headerAddPressed]}
        >
          <Ionicons name="search" size={20} color={colors.onSurface} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Import recipe"
          onPress={() => navigation.getParent()?.navigate("ImportModal")}
          hitSlop={12}
          style={({ pressed }) => [styles.headerAdd, pressed && styles.headerAddPressed]}
        >
          <Ionicons name="add" size={22} color={colors.onPrimary} />
        </Pressable>
      </View>
    ),
  });
}, [navigation]);
```

Add styles:

```tsx
headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
headerIconBtn: {
  width: 32,
  height: 32,
  borderRadius: 16,
  backgroundColor: colors.surfaceContainerHigh,
  alignItems: "center",
  justifyContent: "center",
},
```

- [ ] **Step 5: tsc + simulator smoke**

```bash
node ./node_modules/typescript/bin/tsc --noEmit -p apps/mobile/tsconfig.json
echo "exit=$?"   # Expected: 0
```

Reload simulator. On the Library tab, tap the search icon — placeholder screen should appear.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/navigation/types.ts \
        apps/mobile/src/navigation/stacks/LibraryStack.tsx \
        apps/mobile/src/features/library/LibraryListScreen.tsx \
        apps/mobile/src/features/library/FriendSearchScreen.tsx \
        apps/mobile/src/features/library/FriendLibraryScreen.tsx
git commit -m "feat(mobile): wire friend-library nav (search icon, two stub screens)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: Mobile FriendSearchScreen

**Goal:** Email input → call `users.searchByEmail` → result card → tap to navigate to `FriendLibrary`.

**Files:**
- Modify: `apps/mobile/src/features/library/FriendSearchScreen.tsx`

- [ ] **Step 1: Replace the placeholder with the real implementation**

```tsx
// apps/mobile/src/features/library/FriendSearchScreen.tsx
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useApiClient } from "../../lib/api";
import { Button, EmptyState, TextField } from "../../components";
import { colors, radii, spacing, typography } from "../../theme";
import type {
  LibraryStackParamList,
  MainTabsParamList,
  RootStackParamList,
} from "../../navigation/types";

type Props = CompositeScreenProps<
  NativeStackScreenProps<LibraryStackParamList, "FriendSearch">,
  CompositeScreenProps<
    BottomTabScreenProps<MainTabsParamList, "Library">,
    NativeStackScreenProps<RootStackParamList>
  >
>;

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; user: { id: string; email: string } }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

export function FriendSearchScreen({ navigation }: Props) {
  const apiClient = useApiClient();
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<Result>({ kind: "idle" });

  const handleSearch = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setResult({ kind: "error", message: "Enter an email." });
      return;
    }
    setResult({ kind: "loading" });
    try {
      const user = await apiClient.users.searchByEmail(trimmed);
      setResult({ kind: "found", user });
    } catch (e) {
      // The api-client throws Error with the response body for non-2xx.
      // 404 means "no public library for that email" (uniform with other failure cases).
      const message = e instanceof Error ? e.message : "Search failed";
      if (/not found|404|no public library/i.test(message)) {
        setResult({ kind: "not-found" });
      } else {
        setResult({ kind: "error", message });
      }
    }
  };

  return (
    <View style={styles.flex}>
      <View style={styles.inputBlock}>
        <TextField
          label="Friend's email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="friend@example.com"
        />
        <Button
          title={result.kind === "loading" ? "Searching…" : "Search"}
          onPress={() => void handleSearch()}
          loading={result.kind === "loading"}
          disabled={result.kind === "loading"}
          fullWidth
        />
      </View>
      <View style={styles.resultBlock}>
        {result.kind === "found" ? (
          <Pressable
            onPress={() =>
              navigation.navigate("FriendLibrary", {
                userId: result.user.id,
                email: result.user.email,
              })
            }
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            <View style={styles.avatar}>
              <Ionicons name="person" size={20} color={colors.onPrimaryFixed} />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle} numberOfLines={1}>{result.user.email}</Text>
              <Text style={styles.cardSub}>Open library</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
          </Pressable>
        ) : null}
        {result.kind === "not-found" ? (
          <EmptyState
            icon="person-outline"
            title="No public library for that email"
            description="Either no one with that email has shared their library, or the email doesn't match an account here."
          />
        ) : null}
        {result.kind === "error" ? (
          <Text style={styles.error}>{result.message}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  inputBlock: { padding: spacing.lg, gap: spacing.md },
  resultBlock: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    padding: spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 1,
  },
  cardPressed: { opacity: 0.92 },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryFixed,
    alignItems: "center", justifyContent: "center", marginRight: spacing.md,
  },
  cardBody: { flex: 1 },
  cardTitle: { ...typography.headline, color: colors.onSurface },
  cardSub: { ...typography.subhead, color: colors.onSurfaceVariant, marginTop: 2 },
  error: { ...typography.body, color: colors.error },
});
```

- [ ] **Step 2: tsc + simulator smoke**

```bash
node ./node_modules/typescript/bin/tsc --noEmit -p apps/mobile/tsconfig.json
echo "exit=$?"   # Expected: 0
```

In simulator: Library → search icon → type a real public-library email → see result card. Tap it → navigates to FriendLibrary stub.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/features/library/FriendSearchScreen.tsx
git commit -m "feat(mobile): FriendSearchScreen — email search + result card

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: Mobile FriendLibraryScreen + copy flow

**Goal:** Lists the friend's recipes, lets the caller "Add to library" with already-copied detection and an optimistic UI update.

**Files:**
- Modify: `apps/mobile/src/features/library/FriendLibraryScreen.tsx`

- [ ] **Step 1: Replace the placeholder with the full implementation**

```tsx
// apps/mobile/src/features/library/FriendLibraryScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { Recipe } from "@cooking/shared";
import { useApiClient } from "../../lib/api";
import { Button, EmptyState } from "../../components";
import { haptics } from "../../lib/haptics";
import { resolveImageUrl } from "../../lib/imageUrl";
import { colors, radii, spacing, typography } from "../../theme";
import type {
  LibraryStackParamList,
  MainTabsParamList,
  RootStackParamList,
} from "../../navigation/types";

type Props = CompositeScreenProps<
  NativeStackScreenProps<LibraryStackParamList, "FriendLibrary">,
  CompositeScreenProps<
    BottomTabScreenProps<MainTabsParamList, "Library">,
    NativeStackScreenProps<RootStackParamList>
  >
>;

export function FriendLibraryScreen({ route }: Props) {
  const apiClient = useApiClient();
  const { userId } = route.params;
  const [friendRecipes, setFriendRecipes] = useState<Recipe[]>([]);
  const [myRecipes, setMyRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setUnavailable(false);
    try {
      const [theirs, mine] = await Promise.all([
        apiClient.users.libraryRecipes(userId),
        apiClient.recipes.list(),
      ]);
      setFriendRecipes(theirs);
      setMyRecipes(mine);
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (/not found|404|library not found/i.test(message)) {
        setUnavailable(true);
      } else {
        // Render the message inline; keep things simple — no separate error UI for now.
        setUnavailable(true);
      }
    } finally {
      setLoading(false);
    }
  }, [apiClient, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const savedSourceIds = useMemo(() => {
    const ids = new Set<string>();
    myRecipes.forEach((r) => {
      ids.add(r.id);
      if (r.catalog_source_recipe_id) ids.add(r.catalog_source_recipe_id);
    });
    return ids;
  }, [myRecipes]);

  const handleCopy = useCallback(async (recipeId: string) => {
    setCopyingId(recipeId);
    try {
      const copy = await apiClient.users.copyFriendRecipe(userId, recipeId);
      setMyRecipes((prev) => (prev.some((r) => r.id === copy.id) ? prev : [copy, ...prev]));
      haptics.success();
    } catch (e) {
      haptics.error();
      const message = e instanceof Error ? e.message : "";
      if (/not found|404/i.test(message)) {
        setUnavailable(true);
      }
    } finally {
      setCopyingId(null);
    }
  }, [apiClient, userId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (unavailable) {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="lock-closed-outline"
          title="Library is no longer public"
          description="The owner may have turned off sharing. Try again later."
        />
      </View>
    );
  }

  return (
    <FlatList
      data={friendRecipes}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={friendRecipes.length === 0 ? styles.emptyContent : styles.listContent}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={
        <EmptyState
          icon="restaurant-outline"
          title="This library is empty"
          description="No recipes here yet."
        />
      }
      renderItem={({ item }) => {
        const owned = savedSourceIds.has(item.id);
        const url = resolveImageUrl(item.thumbnail_url);
        return (
          <View style={styles.card}>
            {url ? (
              <Image source={{ uri: url }} style={styles.thumb} contentFit="cover" transition={150} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <Ionicons name="restaurant" size={28} color={colors.onPrimaryFixed} />
              </View>
            )}
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.cardSub}>
                {item.ingredients.length} {item.ingredients.length === 1 ? "ingredient" : "ingredients"}
              </Text>
              <View style={styles.action}>
                <Button
                  title={owned ? "In your library" : "Add to library"}
                  onPress={() => void handleCopy(item.id)}
                  variant={owned ? "secondary" : "primary"}
                  loading={copyingId === item.id}
                  disabled={owned}
                />
              </View>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.lg },
  listContent: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  emptyContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.lg },
  separator: { height: spacing.sm },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    padding: spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 1,
  },
  thumb: { width: 64, height: 64, borderRadius: radii.lg, backgroundColor: colors.primaryFixed },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1, marginHorizontal: spacing.md },
  cardTitle: { ...typography.headline, color: colors.onSurface },
  cardSub: { ...typography.subhead, color: colors.onSurfaceVariant, marginTop: 2 },
  action: { marginTop: spacing.sm, alignSelf: "flex-start" },
});
```

- [ ] **Step 2: tsc + simulator smoke**

```bash
node ./node_modules/typescript/bin/tsc --noEmit -p apps/mobile/tsconfig.json
echo "exit=$?"
```

In simulator: search jd@gmail.com → tap result → see jd's recipes with "Add to library" buttons. Tap one → flips to "In your library". Switch to My Library → recipe is there.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/features/library/FriendLibraryScreen.tsx
git commit -m "feat(mobile): FriendLibraryScreen — list + copy with already-copied detection

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 13: Web auth context — extend `User` with `is_library_public`

**Goal:** Web knows the user's `is_library_public` and can flip it (like mobile in Task 8).

**Files:**
- Modify: whatever file holds the web auth context (likely `apps/web/app/lib/auth.tsx` or similar — find and adapt)

- [ ] **Step 1: Find the web auth context**

```bash
grep -rln "is_library_public\|UserContext\|AuthContext\|auth.me\|/auth/me" apps/web/app/ | head -10
```

Look for the file that fetches `/auth/me` and exposes a context for the rest of the web app.

- [ ] **Step 2: Add `is_library_public` to whatever User type lives there**

Whatever the file is, the change pattern is identical:
- The user type gets `is_library_public: boolean`.
- The `/auth/me` consumer captures it on mount.
- Add a `setLibraryVisibility(isPublic: boolean)` method that POSTs to `/auth/library-visibility` and updates context state.

- [ ] **Step 3: Confirm web compiles**

```bash
cd apps/web
npm run lint   # whatever lint catches will catch type drift if Next is strict
# OR if there's a tsc step:
npx tsc --noEmit
```

If lint isn't strict and tsc isn't wired up at the workspace level, manual smoke is fine.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/lib/   # adjust path to whatever you actually touched
git commit -m "feat(web): expose is_library_public + setLibraryVisibility on auth ctx

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 14: Web Settings page — Share-my-library toggle

**Goal:** A web settings page (or section) where the user flips `is_library_public`.

**Files:**
- Modify or create: `apps/web/app/settings/page.tsx` (verify if it exists; create minimally if not)

- [ ] **Step 1: Check if a settings page exists**

```bash
ls apps/web/app/settings/ 2>/dev/null || echo "no settings page yet"
```

- [ ] **Step 2: Either modify the existing page or create a new one**

Minimal new page if none exists:

```tsx
// apps/web/app/settings/page.tsx
"use client";

import { useState } from "react";
// import path to the auth context you set up in Task 13
import { useAuth } from "../lib/auth";

export default function SettingsPage() {
  const { user, setLibraryVisibility } = useAuth();
  const [pending, setPending] = useState(false);

  async function onToggle(next: boolean) {
    if (pending || !user) return;
    setPending(true);
    try {
      await setLibraryVisibility(next);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't update — try again.");
    } finally {
      setPending(false);
    }
  }

  if (!user) return null;

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>Settings</h1>
      <section style={{ marginTop: 24, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <h2 style={{ margin: 0 }}>Share my library</h2>
        <p style={{ color: "#555", margin: "8px 0 16px" }}>
          Anyone who knows your email can browse and copy your recipes.
        </p>
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={user.is_library_public}
            onChange={(e) => onToggle(e.target.checked)}
            disabled={pending}
          />
          {user.is_library_public ? "On" : "Off"}
        </label>
      </section>
    </main>
  );
}
```

(Adapt to the existing web styling conventions — the project uses plain CSS classes from `apps/web/app/globals.css`, not inline styles. Find the existing settings/profile page styling pattern and follow it.)

- [ ] **Step 3: Smoke**

```bash
cd /Users/xiang1err_/Desktop/web_app/Cooking
docker compose up -d   # ensure web container is running
# Open http://localhost:3000/settings — toggle the switch — verify with curl that /auth/me reflects it.
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/settings/
git commit -m "feat(web): Settings page with Share-my-library toggle

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 15: Web Library — search icon in header

**Goal:** Library page header gets a search icon next to wherever existing import / nav lives. Click → navigate to `/library/friends`.

**Files:**
- Modify: `apps/web/app/library/page.tsx`

- [ ] **Step 1: Find the existing header in `library/page.tsx`**

```bash
grep -n "header\|Header\|nav\|className.*lib\|<h1\|<h2" apps/web/app/library/page.tsx | head -20
```

- [ ] **Step 2: Add a search icon button near the top of the page**

Use whatever icon library the existing pages use (Material Symbols, per CLAUDE.md). Add a `<Link>` to `/library/friends` styled as an icon button. Keep the existing import/nav UI alongside it.

- [ ] **Step 3: Manual smoke**

Open `http://localhost:3000/library` → see search icon → click → navigates to `/library/friends`. (404 until Task 16.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/library/page.tsx
git commit -m "feat(web): search icon on Library page links to /library/friends

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 16: Web `/library/friends/page.tsx` — search page

**Goal:** Email input → calls `users.searchByEmail` → result card linking to `/library/friends/[userId]`.

**Files:**
- Create: `apps/web/app/library/friends/page.tsx`

- [ ] **Step 1: Implement the page**

```tsx
// apps/web/app/library/friends/page.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { apiFetch } from "../../lib/apiFetch"; // or whatever the existing client is

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; user: { id: string; email: string } }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

export default function FriendsSearchPage() {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<Result>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setResult({ kind: "error", message: "Enter an email." });
      return;
    }
    setResult({ kind: "loading" });
    const res = await apiFetch(`/users/search?email=${encodeURIComponent(trimmed)}`);
    if (res.status === 404) { setResult({ kind: "not-found" }); return; }
    if (!res.ok) { setResult({ kind: "error", message: await res.text() }); return; }
    const user = await res.json();
    setResult({ kind: "found", user });
  }

  return (
    <main style={{ padding: 24, maxWidth: 640 }}>
      <h1>Find a friend</h1>
      <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, margin: "16px 0" }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="friend@example.com"
          autoComplete="off"
          autoCapitalize="off"
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit" disabled={result.kind === "loading"}>
          {result.kind === "loading" ? "Searching…" : "Search"}
        </button>
      </form>
      {result.kind === "found" ? (
        <Link
          href={`/library/friends/${result.user.id}`}
          style={{ display: "flex", gap: 12, padding: 12, border: "1px solid #ddd", borderRadius: 12, textDecoration: "none", color: "inherit" }}
        >
          <strong>{result.user.email}</strong>
          <span style={{ marginLeft: "auto" }}>Open library →</span>
        </Link>
      ) : null}
      {result.kind === "not-found" ? (
        <p style={{ color: "#555" }}>No public library for that email.</p>
      ) : null}
      {result.kind === "error" ? (
        <p style={{ color: "#b00" }}>{result.message}</p>
      ) : null}
    </main>
  );
}
```

(If web uses the typed `@cooking/api-client` instead of `apiFetch`, swap accordingly. Either is fine — `apiFetch` is the existing pattern in `apps/web/`.)

- [ ] **Step 2: Smoke**

Visit `http://localhost:3000/library/friends` → type a public-library email → see result. Click → navigates to `/library/friends/<userId>` (404 until next task).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/library/friends/page.tsx
git commit -m "feat(web): /library/friends — friend email search

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 17: Web `/library/friends/[userId]/page.tsx` — friend library view + copy

**Goal:** List the friend's recipes; "Add to library" button per recipe with already-copied detection.

**Files:**
- Create: `apps/web/app/library/friends/[userId]/page.tsx`

- [ ] **Step 1: Implement the page**

```tsx
// apps/web/app/library/friends/[userId]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../../lib/apiFetch";
import type { Recipe } from "@cooking/shared";

export default function FriendLibraryPage({ params }: { params: { userId: string } }) {
  const [theirs, setTheirs] = useState<Recipe[]>([]);
  const [mine, setMine] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [a, b] = await Promise.all([
          apiFetch(`/users/${params.userId}/recipes`).then(async (r) => {
            if (r.status === 404) throw new Error("LIBRARY_GONE");
            if (!r.ok) throw new Error(await r.text());
            return (await r.json()) as Recipe[];
          }),
          apiFetch("/recipes").then(async (r) => (r.ok ? ((await r.json()) as Recipe[]) : [])),
        ]);
        if (cancelled) return;
        setTheirs(a);
        setMine(b);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof Error && e.message === "LIBRARY_GONE") setUnavailable(true);
        else setUnavailable(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [params.userId]);

  const savedSourceIds = useMemo(() => {
    const ids = new Set<string>();
    mine.forEach((r) => {
      ids.add(r.id);
      if (r.catalog_source_recipe_id) ids.add(r.catalog_source_recipe_id);
    });
    return ids;
  }, [mine]);

  async function copy(recipeId: string) {
    setCopyingId(recipeId);
    try {
      const res = await apiFetch(
        `/users/${params.userId}/recipes/${encodeURIComponent(recipeId)}/copy`,
        { method: "POST" }
      );
      if (res.status === 404) { setUnavailable(true); return; }
      if (!res.ok) throw new Error(await res.text());
      const newCopy = (await res.json()) as Recipe;
      setMine((prev) => (prev.some((r) => r.id === newCopy.id) ? prev : [newCopy, ...prev]));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't add — try again.");
    } finally {
      setCopyingId(null);
    }
  }

  if (loading) return <main style={{ padding: 24 }}>Loading…</main>;
  if (unavailable) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Library is no longer public</h1>
        <p>The owner may have turned off sharing.</p>
      </main>
    );
  }
  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>Friend's library</h1>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {theirs.map((r) => {
          const owned = savedSourceIds.has(r.id);
          return (
            <li key={r.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, border: "1px solid #ddd", borderRadius: 12, marginBottom: 8 }}>
              <strong style={{ flex: 1 }}>{r.title}</strong>
              <button
                onClick={() => void copy(r.id)}
                disabled={owned || copyingId === r.id}
              >
                {owned ? "In your library" : copyingId === r.id ? "Adding…" : "Add to library"}
              </button>
            </li>
          );
        })}
      </ul>
      {theirs.length === 0 ? <p>This library is empty.</p> : null}
    </main>
  );
}
```

(Style with whatever class system the existing public-catalog rendering uses; the inline styles are placeholders to keep the example complete.)

- [ ] **Step 2: Smoke**

Visit `http://localhost:3000/library/friends/<JD_ID>` → see jd's recipes → click "Add to library" → button flips to "In your library". Visit `/library` → recipe is there.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/library/friends/
git commit -m "feat(web): /library/friends/[userId] — list + copy with already-copied detection

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 18: CLAUDE.md updates

**Goal:** Document the new endpoints and feature so the next session doesn't re-discover this surface.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add to the API table**

In the "API surface (current)" section's table, add four rows alphabetically by path:

```markdown
| POST | `/auth/library-visibility` | Body `{is_public: bool}`. Flips current user's library sharing flag. |
| GET | `/users/search?email=` | Exact email match. 200 with `{id,email,is_library_public}` only when target's library is public AND not the caller. 404 otherwise. |
| GET | `/users/{user_id}/recipes` | List a user's recipes if their library is public. 404 otherwise. |
| POST | `/users/{user_id}/recipes/{recipe_id}/copy` | Idempotent clone into the caller's library. Sets `catalog_source_recipe_id` on the new row. |
```

- [ ] **Step 2: Add a brief architecture note**

Under "Architecture notes that aren't obvious from a single file" add:

```markdown
### Friend library sharing is orthogonal to the public catalog

Two separate visibility models coexist on `RecipeModel`/`UserModel`:

- `RecipeModel.is_public_catalog` — per-recipe flag for the global editor-curated catalog at `/recipes/catalog/*`. Flagging is gated by `PUBLIC_LIBRARY_EDITOR_EMAILS` (currently jerryxiang24@gmail.com only on prod).
- `UserModel.is_library_public` — per-user flag for friend-library sharing at `/users/*`. Anyone can flip this for themselves (no editor gating). When on, your entire library becomes visible to anyone who searches your exact email.

A recipe copied via the friend-library `POST /users/{id}/recipes/{rid}/copy` endpoint sets `catalog_source_recipe_id` on the clone, the same field set by the global catalog copy. This lets both surfaces use the same already-copied detection logic on clients (`Set<catalog_source_recipe_id>`).
```

- [ ] **Step 3: Update Mobile structure section**

In the `apps/mobile` bullet under "Repo shape", append to the surface list:

> Friend library sharing (search icon in Library header → `FriendSearchScreen` → `FriendLibraryScreen` with email-based discovery and copy flow; Profile toggle `Share my library` to opt in)

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: friend library sharing in API table + architecture notes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 19: End-to-end manual smoke

**Goal:** Walk through the full feature on real surfaces (web + mobile) with two accounts.

- [ ] **Step 1: Run the backend smoke script**

```bash
bash backend/scripts/smoke_friend_library.sh "<JD_PW>" "<BOB_PW>"
# Expected last line: ALL GREEN
```

- [ ] **Step 2: Two-tab web smoke**

- Tab 1 (logged in as jd@gmail.com): go to `/settings`, toggle "Share my library" ON.
- Tab 2 (logged in as bob+test@example.com): go to `/library`, click search icon → type `jd@gmail.com` → click result → click "Add to library" on a recipe.
- Tab 2: go to `/library`, confirm the new recipe is in My Library.
- Tab 1: toggle "Share my library" OFF.
- Tab 2: refresh `/library/friends`, search jd@gmail.com → "No public library for that email."

- [ ] **Step 3: Mobile sim smoke**

In the simulator (logged in as bob+test@example.com):
- Library tab → search icon → type `jd@gmail.com` → tap result → see jd's recipes.
- Tap "Add to library" on a recipe — button flips to "In your library", haptic.
- Switch to My Library segment — recipe is there.
- Profile tab → toggle "Share my library" ON for bob.
- Switch back to a real device or another simulator logged in as jd → search bob's email → see bob's library (which now contains the recipe he just copied).

- [ ] **Step 4: Acceptance criteria check**

Tick each line in the spec's "Acceptance criteria" section. All should be ✅.

- [ ] **Step 5: Commit any final tweaks, push, hand off**

```bash
git status   # confirm working tree clean
git push -u origin feat/friend-library-sharing
```

Then either:
- Merge to `main` directly: `git checkout main && git merge --no-ff feat/friend-library-sharing && git push`.
- Or open a PR for review (if the project's workflow uses PRs).

---

## Self-review notes (for the implementer)

- Each backend task is committable on its own (the migration in Task 1 + the model field changes are coupled — keep them in one commit).
- If a curl smoke fails partway, the failing step's expected output is in that step's "Expected" line; compare vs actual and fix before continuing.
- Mobile: every screen + auth-context change is followed by `tsc --noEmit -p apps/mobile/tsconfig.json` to catch type drift before the simulator.
- Web: the project doesn't have a workspace-level tsc, so type drift on the web side surfaces at run time. If you have time, wire up `npx tsc --noEmit` for `apps/web` and run it as part of each web task — but this is improvement, not in scope.
- The acceptance criteria in the spec map to: Task 9 (Alice opts in), Tasks 11–12 (Bob searches + copies), Task 5 (idempotent copy), Tasks 11–12 (toggle off behavior), Task 3 (self-search 404), Tasks 13–17 (web parity), Task 7 + each tsc step (TypeScript clean).
