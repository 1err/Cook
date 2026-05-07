# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**This file is the authoritative reference for what the codebase currently does.** The older `CODEBASE_WALKTHROUGH.md` has been removed — there is no parallel narrative anymore. Trust this file plus the code. **When you change behavior, API surface, file layout, env vars, or deployment, update the matching section here in the same change.**

## Product summary

A personal cooking assistant. Each user has an account and a private library of recipes. They populate the library by either (a) pasting a written transcript or (b) submitting a YouTube video link (captions only — there is no audio/Whisper path). They then assign recipes to days of the week in the planner (breakfast / lunch / dinner slots). The shopping list page aggregates ingredients across the planned week and can produce a "smart" grouped grocery list via an LLM call, plus suggested store products from Weee or Amazon backed by a multi-layer cache.

The cache is shared across all users: when one user triggers a fresh scrape, every subsequent user gets the cached row instantly. A background warmer keeps the most common queries hot.

## Repo shape (npm workspaces + Python)

- `apps/web` — Next.js 14 App Router (`@cooking/web`). Cookie-based auth. Source of nearly all real product UI today. Pages: `import/`, `library/{,[id]}`, `planner/`, `shopping-list/`, `recipe/[id]`, `preview/` (admin cache console), `login/`, `register/`.
- `apps/mobile` — Expo / React Native (`@cooking/mobile`). **Early scaffolding for a real iOS app — currently messy and not at parity.** Only `Login`, `Register`, `Library`, `RecipeDetail`, and `Settings` are real. `Planner`, `ShoppingList`, and `Import` are still `PlaceholderScreen` stubs (`apps/mobile/src/screens/{Planner,ShoppingList,Import}Screen.tsx`). Don't claim mobile parity in commit messages or docs.
- `packages/shared` — types, week/meal-plan/ingredient/category helpers, store enum, i18n strings (`packages/shared/src/messages/{en,zh}.json`). **Single source for these helpers** — pages import from `@cooking/shared` directly; no per-app re-export shims under `apps/web/app/lib/`.
- `packages/api-client` — `createApiClient({ baseUrl, auth })`. `auth.kind: "cookie"` adds `credentials: "include"`; `auth.kind: "bearer"` reads a token via `getToken()` and adds `Authorization: Bearer …`.
- `backend/` — FastAPI + async SQLAlchemy + Alembic. **Postgres only** (asyncpg).
- `scripts/` — manual cache warming and cleanup utilities, plus `docker-up.sh`.

## Deployment (current production)

The user's typical local dev loop:

```bash
docker compose down && docker compose up --build -d   # then open http://localhost:3000
```

### Frontend — Vercel

- Project hosts both `chef-world.com` and `www.chef-world.com` plus the auto preview URL `cook-lake-alpha.vercel.app`.
- Build env: `NEXT_PUBLIC_API_BASE=https://api.chef-world.com` (so the browser hits the ECS backend, not localhost).
- Build is pinned by `vercel.json` at the repo root: framework `nextjs`, `installCommand: npm install`, `buildCommand: npm --workspace @cooking/web run build`, `outputDirectory: apps/web/.next`. Install runs from repo root so `file:`-linked workspaces (`@cooking/shared`, `@cooking/api-client`) resolve.
- **Vercel project setting *Root Directory* must be empty (preferred) or `apps/web`.** It used to read `frontend/` (a path that no longer exists from the monorepo split) which broke every deploy. After saving an empty Root Directory the `vercel.json` here drives the build.

### Backend — AWS ECS

- Cluster: `cooking-cluster`. Service runs task definition `cooking-backend:8` (revision number bumps with each deploy).
- Image: built from `backend/Dockerfile` (Python 3.12 slim + Playwright Chromium). Listens on `:8000`.
- Public hostname: `https://api.chef-world.com` (fronted by ALB / domain mapping outside this repo).
- Production env vars (live in the ECS task definition, **not** in the repo):
  - `AUTH_SECRET=<long random string>`
  - `AWS_REGION=us-east-1`
  - `S3_BUCKET_NAME=cooking-images-930067562682`
  - `DATABASE_URL=postgresql+asyncpg://cooking:<url-encoded-password>@cooking-db.co944gii0fur.us-east-1.rds.amazonaws.com:5432/postgres` — note the `%` in the password is URL-encoded as `%25` in the actual env value (Alembic and asyncpg both fail otherwise; see commit `ea811a6`).
  - `CORS_ALLOW_ORIGINS=http://localhost:3000,https://cook-lake-alpha.vercel.app,https://chef-world.com,https://www.chef-world.com`
  - `COOKIE_SAMESITE=none`, `COOKIE_SECURE=true` — required because the browser is on `chef-world.com` and the API is on `api.chef-world.com` (cross-site). If either is wrong, login appears to succeed but the cookie is dropped on the next request.
  - `OPENAI_API_KEY=<placeholder>` — currently a placeholder, so production silently falls back to stub extraction (`extract.py` returns demo Mapo Tofu / generic placeholder) and stub refine output. The web flow still works end-to-end; it just doesn't actually call OpenAI. **Replace this before claiming LLM features are live.**
- Database: AWS RDS Postgres at `cooking-db.co944gii0fur.us-east-1.rds.amazonaws.com:5432`, database `postgres`, user `cooking`. `DATABASE_SSL` is **not** set in the task def today; if RDS forces TLS this should be flipped to `true`.
- Image storage: S3 bucket `cooking-images-930067562682` in `us-east-1`. Recipe uploads use presigned PUT directly from the browser when both `AWS_REGION` and `S3_BUCKET_NAME` are set (true in prod).
- Migrations: backend container runs `alembic upgrade head` on startup (`backend/Dockerfile` CMD). New tasks therefore self-migrate; no separate migration step is wired up.

### Local Docker stack

`docker-compose.yml` brings up Postgres + backend + web. Backend `.env` is loaded via `env_file: backend/.env`, but local compose-level overrides force `DATABASE_URL`, `DATABASE_SSL=false`, and a localhost CORS list. The web container is built with `NEXT_PUBLIC_API_BASE=http://localhost:8000` so the browser still talks to the host-published port. `./backend/uploads` is bind-mounted into `/app/uploads` so locally-uploaded recipe images survive container rebuilds (matters when `S3_BUCKET_NAME` is not set in local `backend/.env`).

## Commands

### Web / mobile (run from repo root)

```bash
npm install                # installs all workspaces
npm run web:dev            # next dev on :3000
npm run web:build
npm run web:start
npm run web:lint           # next lint — only configured lint in repo
npm run mobile:start       # expo start
npm run mobile:ios         # expo start --ios
npm run mobile:android
```

There are **no test scripts** anywhere in this repo (no Jest/Vitest/pytest config, no `__tests__`/`tests/` dirs). When the user asks to "run tests," verify what they mean before assuming.

### Backend (run from `backend/`)

Requires Python 3.11, 3.12, or 3.13 (3.14 is not supported — pydantic-core Rust bindings).

```bash
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium    # store scraper uses Playwright

cp .env.example .env
# Required: DATABASE_URL (postgresql+asyncpg://...), AUTH_SECRET (≥16 chars).
# Optional: OPENAI_API_KEY, AWS_REGION+S3_BUCKET_NAME, COOKIE_SECURE/SAMESITE, PUBLIC_LIBRARY_EDITOR_EMAILS.

alembic upgrade head           # apply migrations
python run.py                  # uvicorn on :8000 with reload
```

`AUTH_SECRET` must be ≥16 characters (`backend/app/core/security.py::_get_secret`) — auth endpoints raise at runtime otherwise. The `.env.example` placeholder must be replaced.

`DATABASE_URL` must be `postgresql+asyncpg://...`; startup hard-fails on SQLite or missing URL (`backend/app/core/config.py::Settings.require_postgres`). Special characters in the password (notably `%`) must be URL-encoded.

Alembic head is `20260416_store_cache` (see `backend/alembic/versions/`). New revisions: `alembic revision -m "msg"` then edit the generated file.

### Docker

```bash
docker compose up --build              # postgres + backend (auto runs `alembic upgrade head`) + web
./scripts/docker-up.sh                 # same, but retries on Docker Hub 502s
```

The web Dockerfile’s build context is the **repo root** (it needs `packages/`), not `apps/web`. The `./backend/uploads` host dir is bind-mounted to `/app/uploads` for local image persistence when S3 is unset. Backend image installs Playwright Chromium with `--with-deps` (large; expect long first build).

### One-off scripts

```bash
python scripts/precompute_store_products.py          # warms persistent store-product cache
python scripts/cleanup_bad_store_cache_queries.py    # deletes cache rows containing 新鲜 / 切块
```

## API surface (current)

Mounted in `backend/app/main.py`. All routes except `/auth/{register,login,logout}`, `/health`, and `/uploads/*` require auth (`get_current_user`).

| Method | Path | Notes |
|--------|------|-------|
| POST | `/auth/register` | Sets HttpOnly cookie + returns `access_token` in body (mobile uses body). 8-char min password. |
| POST | `/auth/login` | Same |
| POST | `/auth/logout` | Clears cookie |
| GET | `/auth/me` | |
| POST | `/recipes/parse/link` | Returns a draft Recipe from a YouTube URL **without saving** — caller edits then `POST /recipes` |
| POST | `/recipes/parse/transcript` | Returns a draft Recipe from pasted transcript **without saving** |
| POST | `/recipes/upload-image` | Multipart. S3 presigned PUT if `AWS_REGION`+`S3_BUCKET_NAME` set, else local disk + `/uploads/...` URL |
| GET | `/recipes` | List user's recipes |
| POST | `/recipes` | Create |
| GET | `/recipes/{id}` | |
| PATCH | `/recipes/{id}` | Partial update of `title`, `thumbnail_url`, `ingredients`, `library_tags` |
| DELETE | `/recipes/{id}` | 204 |
| GET | `/recipes/catalog` | Public recipe catalog |
| GET | `/recipes/catalog/editor-status` | `{ can_manage: bool }` based on `PUBLIC_LIBRARY_EDITOR_EMAILS` |
| POST | `/recipes/catalog/{id}/copy` | Clone a public recipe into the caller's library (idempotent via `catalog_source_recipe_id`) |
| POST | `/recipes/{id}/catalog` | `{ is_public: bool }` — toggle catalog visibility (editor-only) |
| GET | `/meal-plan?start=&end=` | Inclusive YYYY-MM-DD range |
| PUT | `/meal-plan/{date}` | Body accepts `{breakfast,lunch,dinner: string[]}` **or** legacy `{recipe_ids: string[]}` (normalized into dinner slot) |
| GET | `/shopping-list?start=&end=` | Aggregates ingredients across week's meal plans |
| POST | `/shopping-list/refine` | LLM grocery list. Stateless. Body `{items: [{name,quantity}]}`. Returns `{remove: [], likely_pantry: [], purchase_items: [...]}` — `remove`/`likely_pantry` are always empty (legacy contract; staples come back inside `purchase_items` with `category: "Pantry & Dry Goods"`) |
| GET | `/store-products?query=&store=weee\|amazon` | In-memory L1 → Postgres L2 → Playwright scrape |
| GET | `/admin/cache-preview` | Paginated cached rows, warm-set classification |
| POST | `/admin/cache-refresh` | `{stale_only: bool}` — kicks the warmer task |
| GET | `/admin/cache-refresh-status` | Background task progress |
| POST | `/admin/cache-refresh-one` | Force-refresh a single (query, store) row |
| GET | `/health` | `{status:"ok"}` |
| GET | `/uploads/...` | Static files from `LOCAL_IMAGE_UPLOAD_DIR` (default `<cwd>/uploads`) |

Admin endpoints are gated by `is_admin()` in `backend/app/core/admin.py`, which checks `email == "jerryxiang24@gmail.com"`. The web mirror is `apps/web/app/lib/admin.ts`. To change the admin, both files need to be edited.

## Architecture notes that aren’t obvious from a single file

### Two auth modes share one API

`backend/app/api/auth.py::get_current_user` accepts **either** an `Authorization: Bearer` header (mobile) **or** the `access_token` HttpOnly cookie (web). `/auth/login` and `/auth/register` set the cookie *and* return `access_token` in the body so mobile can stash it in `expo-secure-store` (`apps/mobile/src/lib/auth.tsx`). New authenticated endpoints work for both clients automatically.

For prod cross-origin (web on `chef-world.com`, API on `api.chef-world.com`), the cookie only survives if `COOKIE_SAMESITE=none` and `COOKIE_SECURE=true` — both are set in the live ECS task def. Locally, defaults `lax` / `false` are correct.

### Where LLM logic lives

OpenAI prompts + calls live in `backend/app/extract.py` (recipe extraction) and `backend/app/refine.py` (smart shopping list). Both go through `app/core/llm.py::get_openai_client()`, which returns `None` when `OPENAI_API_KEY` is unset so callers fall back to deterministic stubs (extract → demo Mapo Tofu / generic placeholder; refine → passthrough categorized as `Other`). Model is `gpt-4o-mini`. The `app/services/{extract,refine}_service.py` shims that used to live above these modules have been removed — routers import from `app.extract` / `app.refine` directly. The empty-`remove`/`likely_pantry` legacy contract for `/shopping-list/refine` is now hardcoded in `routes_shopping.py` instead of a wrapper service.

### Refine is on-demand and per-week-cached

`/shopping-list/refine` only fires when the user clicks **Prepare smart shopping list**. The shopping page persists three keys per week:

- `smartShoppingList:{weekMonday}` — refined payload + `_ui.{hidden,checked}` + `_plannerFingerprint` (`sessionStorage`)
- `smartShoppingProducts:{weekMonday}:{store}` — store-product picks per `weee`/`amazon` (`sessionStorage`)
- `plannerWeekFingerprint:{weekMonday}` — written by planner; shopping page compares against `_plannerFingerprint` to mark the smart list **stale** when the planner changed afterward (`localStorage`)

Don’t add automatic refine triggers — token cost is intentional.

### Import flow (two-step)

`apps/web/app/import/page.tsx` calls `/recipes/parse/{link,transcript}` to get a draft Recipe, lets the user edit ingredients / tags / image / title, then calls `POST /recipes` to save. There is no single-step "import + save" endpoint anymore (the legacy `/recipes/import/*` routes were removed). The link path is YouTube-only via `youtube-transcript-api`; uploaded video files (Whisper) are not supported.

### Store-product lookup has three layers

`GET /store-products?query=&store=`: in-memory `CACHE` (in `store_scraper.py`) → Postgres `cached_store_products` (`CACHE_TTL_SECONDS = 86400`, `CACHE_VERSION = "v6"`) → live Playwright scrape. Queries are normalized in `prepare_store_query` (lowercased, banned modifiers like `新鲜` / `切块` stripped, quantity fragments removed). Weee uses zh locale + zh search URL when query has CJK; Amazon is en-only. Detail-page enrichment fills better names/images. **Cache rows are shared across all users**: a fresh scrape from one user becomes an instant L2 hit for everyone else.

`backend/app/jobs/cache_warmer.py` runs the configured query catalog (`cache_warmer_queries.py::ALL_QUERIES`, ~200 entries) on startup (**stale-only**, won’t re-scrape fresh rows) and every 24h via APScheduler (**force_refresh=True**). Admins drive it from `/preview` via `/admin/cache-refresh*`.

### Image uploads switch on env

`POST /recipes/upload-image` (10 MB max; JPEG/PNG/WebP/GIF):

- If `AWS_REGION` **and** `S3_BUCKET_NAME` set (true in prod, bucket `cooking-images-930067562682`): returns S3 presigned PUT + final `file_url`. Frontend does the PUT itself.
- Otherwise: backend writes the bytes to `LOCAL_IMAGE_UPLOAD_DIR` (default `./uploads` relative to **process cwd**, i.e. `backend/uploads` when running locally), returns `upload_url: ""` and a `file_url` pointing at `/uploads/recipes/<uuid>.<ext>`. Frontend skips the PUT when `upload_url` is empty.

Both AWS vars must be either both set or both empty (validated in `Settings.validate_s3_config`).

### Public catalog gating

`get_public_library_editor_emails()` (`backend/app/core/config.py`):

1. If `PUBLIC_LIBRARY_EDITOR_EMAILS` env is set → use it.
2. Else if `DATABASE_URL` host looks local (`@127.0.0.1:`, `@localhost:`, `@postgres:`) → return `[]` (anyone can publish, for dev convenience).
3. Else fall back to `["jerryxiang24@gmail.com"]` (this is what prod uses today since `PUBLIC_LIBRARY_EDITOR_EMAILS` is unset on ECS).

`/recipes/catalog/editor-status` returns `can_manage: true` when `editor_emails == []` **or** the user’s email is in the list.

### API base resolution

- Web (`apps/web/app/config.ts::getApiBase`) — `NEXT_PUBLIC_API_BASE` if set, else `http://localhost:8000`. Vercel builds bake in `https://api.chef-world.com`; Docker compose bakes in `http://localhost:8000`.
- Mobile (`apps/mobile/src/config.ts::getApiBase`) — `EXPO_PUBLIC_API_BASE` if set, else `http://localhost:8000` with a one-time console warning. **Real-device** testing requires LAN IP (`http://192.168.x.x:8000`); `localhost` resolves to the phone itself. For testing against prod, set `EXPO_PUBLIC_API_BASE=https://api.chef-world.com` in the Expo env.

### Cross-package imports

Web and mobile depend on `@cooking/shared` and `@cooking/api-client` via `file:` workspace links. `apps/web/next.config.mjs` lists them in `transpilePackages` — add new shared packages there too, or Next won’t transpile them. The web Dockerfile's build context is the **repo root** for the same reason.

Pages and components import shared helpers (week math, meal-plan slot helpers, ingredient formatting, shopping categories) directly from `@cooking/shared` — there are no per-app re-export shims under `apps/web/app/lib/`. The two real local libs are:

- `app/lib/recipeCategories.ts` — UI-only data (`CATEGORY_LABELS`, `RECIPE_TAG_GROUPS`, `LIBRARY_FILTER_CHIPS`, `categoryBadgeStyle`).
- `app/lib/recipeTags.ts::getRecipeTags(recipe)` — returns `library_tags` or, for legacy rows, `[library_category]`. Use this everywhere instead of the inline `recipe.library_tags ?? (recipe.library_category ? [recipe.library_category] : [])` fallback.

The slug union `RecipeTagSlug` lives in `@cooking/shared/types`.

### Recipe tags

Two parallel concepts on `RecipeModel`:

- `library_tags` (string of JSON array; new) — multi-select.
- `library_category` (nullable single string; legacy) — kept in sync as `tags[0]`.

`backend/app/models.py` defines `RECIPE_TAG_SLUGS` (frozen 31-slug set) and `LEGACY_LIBRARY_CATEGORY_TO_TAG` (e.g. `quick_dinner` → `quick`). Anything written to either column passes through `coerce_library_tags`. Request bodies in `routes_recipes.py` use the reusable `LibraryTags = Annotated[list[str], BeforeValidator(coerce_library_tags)]` from `app/api/_types.py` instead of repeating a per-model `@field_validator`. The same slug list is mirrored as a TS union in `packages/shared/src/types.ts::RecipeTagSlug` and re-listed in `apps/web/app/lib/recipeCategories.ts::RECIPE_TAG_GROUPS`. **Adding a tag means three edits**: backend `models.py`, shared `types.ts`, web `recipeCategories.ts`.

### Meal plan storage

`MealPlanModel.recipe_ids` is a JSON-serialized string in a `Text` column. Newer rows are objects (`{breakfast,lunch,dinner}`); some legacy rows are arrays. `normalize_meal_plan_slots` (in `app/models.py`) handles both shapes on read and on PUT body parsing. Don’t bypass it.

## Conventions

- **No `load_dotenv` in modules.** Only `app/main.py` calls it. Modules read settings via `app.core.config.settings`.
- **OpenAI client construction** is centralized in `app/core/llm.py::get_openai_client()` — don't re-implement the env-key check + `AsyncOpenAI(...)` constructor anywhere else.
- **Layering:** routers (`app/api/*`) stay thin; orchestration in `app/services/*` (real services like `shopping_service`, `storage_service`, `store_scraper` — no thin re-export shims); SQL in `app/db/repo_*.py`; Pydantic models in `app/models.py`; SQLAlchemy in `app/db/models.py`. Don’t import session/engine into services or models. Reusable Pydantic types shared by routers live in `app/api/_types.py`.
- **All recipe / meal-plan queries scope by `user_id`** (multi-tenant). Repos enforce this — never query `RecipeModel`/`MealPlanModel` directly without it.
- **Recipe IDs are app-generated strings** (`uuid.uuid4().hex` from extract or random UUID from copy); user IDs are real `UUID(as_uuid=True)`.
- **Frontend pages use plain CSS classes** from `apps/web/app/globals.css` (Material/Stitch-inspired palette + Material Symbols icons), not Tailwind. Some inline `style={{}}` objects are sprinkled in; Tailwind utility classes are **not** configured.
- **i18n:** all visible web strings go through `useT()` and `MESSAGE_MAP` from `@cooking/shared` (loaded from `packages/shared/src/messages/{en,zh}.json`). Two-language toggle (English/Chinese) lives in `lib/i18n.tsx`.
- **Hardcoded admin email** (`jerryxiang24@gmail.com`) is duplicated in `backend/app/core/admin.py::ADMIN_EMAIL` and `apps/web/app/lib/admin.ts::ADMIN_EMAIL`. Keep both in sync.

## Known cleanup targets (carry forward across sessions)

These are tracked here — not in commit messages — so each session can pick them up:

- ECS task def `cooking-backend` `OPENAI_API_KEY` is still a placeholder string — LLM features silently fall back to stubs in production until a real key is set.
- Vercel dashboard *Root Directory* must be empty (or `apps/web`). The repo now ships a `vercel.json` that pins install/build/output, so once the dashboard is fixed deploys will be reproducible from code. Confirm the dashboard is updated.
- `LEGACY_LIBRARY_CATEGORY_TO_TAG` and the dual `library_tags` / `library_category` columns: once we backfill all rows so `library_tags` is always populated, drop the `library_category` column + the legacy mapping + the `getRecipeTags` fallback branch.
- `apps/web/app/globals.css` is ~88 KB. Worth a sweep for orphaned selectors, but only after the next round of UI changes — not blind dead-CSS hunting.
- `cache_warmer_queries.py::ALL_QUERIES` (~200 entries) — audit against actual hit logs and prune entries no one searches for.
- `apps/web/.env.local` is committed to disk locally and contains `NEXT_PUBLIC_API_BASE=http://localhost:8000`. It is gitignored, so this is fine, but the `.env.local.example` should remain the source of truth for new clones.

## Updating this file

Update the affected sections **in the same change** when you:

- Add/rename/remove an HTTP route (update the API table)
- Change an env var or its semantics (update `.env.example` *and* the Deployment section if it affects prod)
- Change an ECS task definition env var, image tag, or hostname (Deployment section)
- Change Vercel project settings or the Vercel build env (Deployment section)
- Add a sessionStorage / localStorage key, or change one
- Add a new package under `packages/` or a new app under `apps/`
- Add or implement a mobile screen that's currently a placeholder (move it out of the "scaffolded" list)
- Move LLM prompts/models, change cache TTL/version, or change scraper concurrency
- Add a recipe tag slug (three places noted above)
- Touch admin gating, catalog gating, or any other auth/authorization rule
- Resolve or add to the "Known cleanup targets" list
