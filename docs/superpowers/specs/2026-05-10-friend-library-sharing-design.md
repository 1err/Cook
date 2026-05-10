# Friend library sharing — design

**Date:** 2026-05-10
**Status:** Approved (user signed off on approach B + nav placement + profile toggle copy)
**Branch:** Implementation lands on a fresh `feat/friend-library-sharing` branch cut from `main`. The spec commit (currently on `chore/expo-sdk-54`) is cherry-picked to `main` first so the new branch starts with this doc in place.
**Coexistence with global public catalog:** The existing editor-gated `/recipes/catalog/*` endpoints and the "Public Library" segment of the Library tab stay untouched. The friend-library feature is purely additive — two separate discovery surfaces (curated featured list, social friends-of-friends graph).

## Context & motivation

Today, a user's recipe library is private. The only cross-user discovery surface is the global "Public Library" — recipes individually flagged `is_public_catalog=true`, gated to a single editor account (`jerryxiang24@gmail.com`). That doesn't cover "I want to share my recipes with my friend Alice."

The new feature: **a user can opt to make their entire library publicly visible to anyone who knows their email**, and other users can search by exact email, browse the resulting library, and copy recipes into their own library. No friend-request flow, no per-recipe granularity (yet) — one user-level toggle, open discovery, full library.

Mobile and web both ship in the same change.

## Out of scope (intentionally deferred)

- Per-recipe hide-from-friends (override after opting in). Add later if a user reports needing it.
- Mutual friend lists, follow / "added by me" history, notifications.
- Username-based discovery (only email for now — no `username` column on `users`).
- Fuzzy email matching, "did you mean…" suggestions.
- Activity feeds, leaderboards, social signals.
- Cross-shipping the new backend changes to AWS ECS prod (separate deploy session, same as the meal-plan-cleanup change deferred earlier).

---

## Data model

**One column added.** New alembic migration `backend/alembic/versions/20260510_user_library_public.py`:

```python
def upgrade():
    op.add_column(
        "users",
        sa.Column(
            "is_library_public",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

def downgrade():
    op.drop_column("users", "is_library_public")
```

`UserModel` in `backend/app/db/models.py` gets `is_library_public: Mapped[bool] = mapped_column(sa.Boolean(), nullable=False, server_default=sa.false())`.

No other schema changes. `RecipeModel.is_public_catalog` and `catalog_source_recipe_id` are reused as-is.

---

## Backend API

Four new endpoints (three new + one toggle). All require `get_current_user` like the rest of the API.

### 1. `GET /users/search?email=<exact>`

Look up another user by exact email match for the friend-library flow.

- **Query param:** `email` (required, exact-match, lowercased server-side before lookup).
- **Response 200:** `{id: str, email: str, is_library_public: bool}`. Always `is_library_public=true` when 200 is returned (we don't surface non-public users at all).
- **Response 404:** when (a) no user with that email exists, (b) the user exists but `is_library_public=false`, or (c) the user is the caller themselves. Same 404 for all three to avoid leaking which users exist.
- **Response 422:** if `email` is missing or syntactically invalid.

Implementation: new file `backend/app/db/repo_users.py` containing `search_public_library_user(session, email, exclude_user_id)`. Friend-library logic is conceptually user-scoped, not recipe-scoped, so a new repo file keeps `repo_recipes.py` focused.

### 2. `GET /users/{user_id}/recipes`

List all recipes owned by `user_id`, but only if their library is public.

- **Path param:** `user_id` (UUID).
- **Response 200:** `Recipe[]` (same shape as `GET /recipes` and `GET /recipes/catalog`).
- **Response 404:** if user doesn't exist, has `is_library_public=false`, or `user_id == current_user.id` (no point listing your own library through this endpoint — use `GET /recipes` for that).

Implementation: `repo_users.list_friend_library_recipes(session, owner_user_id)` — query `RecipeModel` by `user_id`. Authorization is in the route layer (`if owner.is_library_public is not True: raise HTTPException(404)`).

### 3. `POST /users/{user_id}/recipes/{recipe_id}/copy`

Idempotently clone `recipe_id` (owned by `user_id`) into the caller's library.

- **Path params:** `user_id` (UUID, source library owner), `recipe_id` (str, target recipe).
- **Response 200:** the new (or already-existing idempotent) `Recipe` owned by the caller.
- **Response 404:** source user's library isn't public, source recipe doesn't exist, source recipe isn't owned by `user_id`, or `user_id == current_user.id`.

Implementation: `repo_users.copy_friend_recipe_to_user(session, source_user_id, recipe_id, caller_user_id)`. Behavior mirrors the existing `repo_recipes.copy_public_recipe_to_user`:
- Look up the source recipe by id+user_id.
- Verify the source user's `is_library_public` is true.
- Idempotency: if caller already has a row with `catalog_source_recipe_id == recipe_id`, return that existing row instead of creating a duplicate.
- Otherwise insert a clone with `is_public_catalog=false`, `catalog_source_recipe_id=source.id`.

This matches the existing public-catalog copy semantics so the same already-copied detection (`Set<catalog_source_recipe_id>`) works on both surfaces.

### 4. `POST /auth/library-visibility`

Flip the caller's `is_library_public` flag.

- **Body:** `{is_public: bool}`.
- **Response 200:** `{is_library_public: bool}` (updated value).

Implementation: simple update on `UserModel`.

(Alternative: a `PATCH /auth/me` route. Dedicated endpoint is clearer for one boolean and avoids touching `/auth/me` semantics.)

### Why these endpoints aren't part of `/recipes/catalog`

Existing `/recipes/catalog/*` routes gate on `RecipeModel.is_public_catalog=True` per recipe. The friend-library flow gates on `UserModel.is_library_public=True` per user. Different visibility model → different routes. Code reuse happens at the repo layer (the clone helper), not the route layer.

---

## API client (`packages/api-client/src/index.ts`)

Add four typed methods:

```ts
users: {
  searchByEmail: (email: string) =>
    json<{ id: string; email: string; is_library_public: boolean }>(
      `/users/search?email=${encodeURIComponent(email)}`
    ),
  libraryRecipes: (userId: string) =>
    json<Recipe[]>(`/users/${encodeURIComponent(userId)}/recipes`),
  copyFriendRecipe: (userId: string, recipeId: string) =>
    json<Recipe>(
      `/users/${encodeURIComponent(userId)}/recipes/${encodeURIComponent(recipeId)}/copy`,
      { method: "POST" }
    ),
},
auth: {
  // ...existing
  setLibraryVisibility: (isPublic: boolean) =>
    json<{ is_library_public: boolean }>("/auth/library-visibility", {
      method: "POST",
      body: JSON.stringify({ is_public: isPublic }),
    }),
},
```

Both web and mobile use these. Web's existing `apiFetch` continues to work for surfaces that already use it; new code on web can use the typed client too.

---

## Mobile UI

### Header search icon (Library tab)

`apps/mobile/src/features/library/LibraryListScreen.tsx`:
- Header right currently has a `+` import button. Add a magnifying-glass icon next to it (e.g., `Ionicons "search"`), tappable.
- Tap → `navigation.navigate("FriendSearch")` (new route on `LibraryStackParamList`).

### `FriendSearchScreen.tsx` (new, in `apps/mobile/src/features/library/`)

Full screen pushed onto the Library stack:
- A `TextField` for email + "Search" Button.
- Submitting calls `apiClient.users.searchByEmail(email)`.
- Success → render a single result card (avatar placeholder + email + "Open library" Button).
- 404 / not found → `EmptyState` ("No public library for that email"). 422 → inline validation message.
- Tap a result → `navigation.navigate("FriendLibrary", { userId, email })`.

### `FriendLibraryScreen.tsx` (new)

Push-on-stack:
- Header title: friend's email (truncated if long).
- Calls `apiClient.users.libraryRecipes(userId)` on mount.
- Renders a list visually identical to the existing Public Library tab in `LibraryListScreen.tsx`'s public-catalog branch: card per recipe with thumbnail + "Add to library" / "In your library" button.
- Already-copied detection: load the caller's own recipes once, build a `Set<string>` of `catalog_source_recipe_id` values, and use it to disable the button on already-copied recipes (same pattern as `LibraryListScreen.savedPublicIds`).
- Tap "Add to library" → `apiClient.users.copyFriendRecipe(userId, recipeId)` → optimistic insert + refetch (same pattern as the existing catalog copy in `LibraryListScreen.handleCopy`).
- 404 anywhere → `EmptyState` ("This library is no longer public").

### Navigation types

`apps/mobile/src/navigation/types.ts` — extend `LibraryStackParamList`:
```ts
export type LibraryStackParamList = {
  LibraryList: undefined;
  RecipeDetail: { recipeId: string };
  RecipeEdit: { recipeId?: string } | undefined;
  FriendSearch: undefined;
  FriendLibrary: { userId: string; email: string };
};
```

`apps/mobile/src/navigation/stacks/LibraryStack.tsx` registers both new screens.

### Profile toggle (mobile)

`apps/mobile/src/features/profile/ProfileScreen.tsx`:
- Add a row using the existing `ListRow` primitive from `apps/mobile/src/components/`.
- Title: **"Share my library"**
- Subtitle: **"Anyone who knows your email can browse and copy your recipes."**
- Trailing: React Native `Switch`. Defaults to false. State sourced from `useAuth()` after the auth context is extended (see below).
- Toggle calls `apiClient.auth.setLibraryVisibility(next)`. On error, revert the optimistic UI update and show an `Alert`.

### Auth context update

`apps/mobile/src/lib/auth.tsx`:
- The `MobileUser` type currently is `{id, email}`. Extend to `{id, email, is_library_public: boolean}`.
- After login, fetch `/auth/me` to populate `is_library_public` (or change the login response to include it).
- Expose a setter `setLibraryVisibility(next: boolean)` on the auth context that calls the API and updates local state.

---

## Web UI

Path: `apps/web/app/library/friends/`. Use Next.js routing.

### Search icon in the Library header

`apps/web/app/library/page.tsx`:
- Add a search-icon button in the page header, between the title and the existing import/segmented controls.
- Click → navigate to `/library/friends` (Next `Link`).

### `/library/friends/page.tsx` (new)

- Email input + Search button. Same flow as mobile.
- Result card → `Link` to `/library/friends/[userId]/page.tsx`.
- 404 / 422 → inline message styles consistent with existing pages.

### `/library/friends/[userId]/page.tsx` (new)

- Server-rendered or client-side fetched (match whatever pattern `apps/web/app/library/page.tsx` uses).
- Lists the friend's recipes with the same card style as existing Public Library cards.
- "Add to library" button per recipe; already-copied detection via the caller's own recipe IDs and `catalog_source_recipe_id`.

### Settings page

`apps/web/app/settings/page.tsx` (or wherever the existing user-settings live — check during implementation):
- Add the same "Share my library" toggle with the same copy as mobile.
- Use `apiFetch` to POST `/auth/library-visibility` (or migrate to typed client; not required for this feature).

### Web nav placement note

The plan calls for a search **icon** in the Library header rather than a top-nav link. Keeps the Library page as the single home for all recipe-discovery flows (mine, public catalog, friends).

---

## Edge cases (each must be tested)

- Search blank / whitespace email → frontend doesn't call backend, shows "Enter an email."
- Search syntactically invalid email → backend 422 → frontend "Not a valid email."
- Search for a real email whose owner has `is_library_public=false` → 404 → "No public library for that email." (Same wording as "user doesn't exist" — no enumeration leak.)
- Search for own email → 404 (treated as no result; no "you can't search yourself" message because that itself is information).
- View URL directly while owner is not public → 404 → "This library is no longer public" empty state.
- Owner toggles library off mid-flow:
  - Listing page poll: nothing fancy, the next render fails with 404 and shows the empty state.
  - Copy at the moment of flipping: backend returns 404 → frontend shows "Couldn't add — this library is no longer public."
- Source user gets deleted after a copy: caller's cloned recipe row stays (it's a clone, not a foreign-key reference).
- Source user changes/deletes a recipe after copying: caller's clone is unaffected (separate row).
- Idempotency of copy: tapping "Add" twice → the second call returns the same existing copy, no duplicate row.
- Two simultaneous copies of the same friend recipe (rare race): unique-ish via `(user_id, catalog_source_recipe_id)` lookup in repo; if a duplicate sneaks through, manual cleanup is acceptable for this feature's scale.

---

## Testing strategy

- **Backend:** No pytest in this round — the project has zero pytest today (per CLAUDE.md "no test scripts anywhere"), and adding tests for one feature creates an inconsistent pattern. Verification is manual smoke + `curl` against the running container, scripted as a small bash file `backend/scripts/smoke_friend_library.sh` that hits all four endpoints with two test users. Building out a real pytest suite is a separate project-wide initiative.
- **Mobile:** TypeScript clean (`tsc --noEmit -p apps/mobile/tsconfig.json` exit 0). Manual smoke test on simulator (against local Docker backend): set Alice's library public, search Alice's email from Bob's account, browse, copy, confirm the recipe appears in Bob's library and can't be re-added.
- **Web:** `npm --workspace @cooking/web run lint`. Manual smoke test at `http://localhost:3000/library/friends`.
- **End-to-end:** Two browser tabs (one logged in as Alice, one as Bob). Alice toggles Share, Bob searches Alice's email, copies a recipe, sees it in his library. Then Alice toggles off → Bob's existing copy survives, but Bob can no longer browse Alice's library.

---

## Files to create / modify

**Backend (new):**
- `backend/alembic/versions/20260510_user_library_public.py`
- `backend/app/api/routes_users.py` (new router file — friend-library endpoints + `/auth/library-visibility` if we don't fold the toggle into `auth.py`)
- `backend/app/db/repo_users.py` (search + list + copy helpers)
- `backend/scripts/smoke_friend_library.sh` (curl-driven smoke test)

**Backend (modify):**
- `backend/app/db/models.py` — `UserModel` gets `is_library_public`
- `backend/app/api/auth.py` — add `POST /auth/library-visibility` and surface `is_library_public` in `/auth/me` and login responses
- `backend/app/main.py` — wire `routes_users`

**Shared:**
- `packages/api-client/src/index.ts` — four new methods
- `packages/shared/src/types.ts` — extend `User` (or whatever the auth-user type is) with `is_library_public`

**Mobile (new):**
- `apps/mobile/src/features/library/FriendSearchScreen.tsx`
- `apps/mobile/src/features/library/FriendLibraryScreen.tsx`

**Mobile (modify):**
- `apps/mobile/src/features/library/LibraryListScreen.tsx` — header search icon
- `apps/mobile/src/features/profile/ProfileScreen.tsx` — Share-my-library toggle
- `apps/mobile/src/lib/auth.tsx` — extend `MobileUser`, expose `setLibraryVisibility`
- `apps/mobile/src/navigation/types.ts` — `LibraryStackParamList`
- `apps/mobile/src/navigation/stacks/LibraryStack.tsx` — register new screens

**Web (new):**
- `apps/web/app/library/friends/page.tsx`
- `apps/web/app/library/friends/[userId]/page.tsx`

**Web (modify):**
- `apps/web/app/library/page.tsx` — search icon in header
- The web settings/profile page (location to be confirmed in the implementation pass — there's no settings route in `apps/web/app/` yet that I've verified; if the toggle has nowhere to live, the implementation step adds a minimal `apps/web/app/settings/page.tsx` first)
- The web auth context (`apps/web/app/lib/`) — extend with `is_library_public` and a setter

**Docs:**
- `CLAUDE.md` — add the new endpoints to the API table; add a short paragraph in "Architecture notes" about friend library sharing being orthogonal to the global public catalog.

---

## Rollout & rollback

- Feature is purely additive on the backend (new column with default `false`, new endpoints). No existing behavior changes.
- `alembic upgrade head` runs on backend container startup → safe.
- Rollback: `alembic downgrade -1` drops the column. Mobile/web UI just stops surfacing the toggle, but the new code paths return 404 from the missing endpoints if shipped without the migration. Order of deploy: migration first, then backend, then web/mobile.
- For prod: same deploy story as the existing meal-plan-cleanup change — also deferred to a separate session.

---

## Acceptance criteria (a single line each)

- [ ] Alice (a regular user, not the editor) can flip "Share my library" on in mobile Profile, and the toggle sticks across app restarts.
- [ ] Bob, signed in on a different device, can tap the Library header search icon, type Alice's email exactly, and see a "Open library" result.
- [ ] Bob can open Alice's library, see all her recipes with their thumbnails, and tap "Add to library" to copy one. The button flips to "In your library" and the recipe appears in Bob's My Library.
- [ ] Bob tapping "Add" twice on the same recipe doesn't create a duplicate.
- [ ] If Alice flips "Share my library" off, Bob's previously copied recipes stay in his library, but searching Alice's email returns no result, and visiting her library URL directly shows a "no longer public" message.
- [ ] Alice searching her own email returns no result.
- [ ] Same flows work on the web at `localhost:3000/library/friends`.
- [ ] `tsc --noEmit` passes for `packages/api-client` and `apps/mobile`. Web lint passes.
