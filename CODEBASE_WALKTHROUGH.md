# Cooking Repo Codebase Walkthrough

This walkthrough reflects the current code in this repository and focuses on what is implemented, how data/auth flows work, and what is still incomplete.

## High-level architecture

- Monorepo with two main apps:
  - `backend/`: FastAPI API, async SQLAlchemy, Alembic migrations
  - `frontend/`: Next.js App Router client
- Current deployment shape:
  - Frontend on Vercel
  - Backend on ECS/Fargate behind ALB
  - PostgreSQL on RDS
- Authentication model:
  - JWT in `HttpOnly` cookie (`access_token`)
  - Frontend always calls API with `credentials: "include"`
- Image upload model:
  - Browser requests presigned URL from backend
  - Browser uploads file directly to S3
  - Recipe stores only `thumbnail_url`

---

## Backend walkthrough

### Entry point and app wiring

- `backend/app/main.py`
  - Loads env via `load_dotenv()`.
  - Forces config validation by accessing `settings.DATABASE_URL` before DB setup.
  - Initializes logging (`setup_logging()`) and DB engine in lifespan (`init_engine()`).
  - Adds CORS middleware:
    - `allow_origins` from `get_cors_origins_list()` or `['*']` fallback
    - `allow_credentials=bool(origins)` (cookies only when explicit origins are configured)
  - Includes routers:
    - `/auth`
    - `/recipes`
    - `/meal-plan`
    - `/shopping-list`
  - Exposes `/health`.

### Config, security, logging

- `backend/app/core/config.py`
  - `DATABASE_URL` is required and validated to be postgres + asyncpg.
  - Cookie/auth-related settings:
    - `AUTH_SECRET`
    - `COOKIE_SECURE` (`Field(False, env="COOKIE_SECURE")`)
    - `COOKIE_SAMESITE` (`Field("lax", env="COOKIE_SAMESITE")`)
    - `COOKIE_SAMESITE` normalized to lowercase.
  - CORS setting: `CORS_ALLOW_ORIGINS` comma-separated.
  - OpenAI: `OPENAI_API_KEY` optional.
  - S3 settings: `AWS_REGION`, `S3_BUCKET_NAME` with validator enforcing both-or-neither.
  - `settings = get_settings()` singleton is used across app modules.

- `backend/app/core/security.py`
  - Password hashing/verification via bcrypt.
  - JWT create/decode with expiry (`7 days`).
  - Requires strong `AUTH_SECRET`.

- `backend/app/core/logging.py`
  - Centralized basic logging setup.

### API layer

#### Auth routes (`backend/app/api/auth.py`)

- Endpoints:
  - `POST /auth/register`
  - `POST /auth/login`
  - `POST /auth/logout`
  - `GET /auth/me`
- Cookie behavior in `_set_cookie(...)`:
  - `httponly=True`
  - `secure=settings.COOKIE_SECURE`
  - `samesite=settings.COOKIE_SAMESITE`
  - `path='/'`
  - `max_age=7 days`
- `get_current_user` reads cookie, decodes JWT `sub`, validates UUID, loads user, returns 401 on failure.
- Note: `_set_cookie` currently has debug `print(...)` lines for cookie settings.

#### Recipe routes (`backend/app/api/routes_recipes.py`)

- All routes require auth (`get_current_user`).
- Image upload endpoint:
  - `POST /recipes/upload-image`
  - Validates content type (`jpeg/png/webp/gif`)
  - Validates file size (`<= 10MB`) using file stream seek/tell
  - Calls S3 presign service and returns:
    - `upload_url`
    - `file_url`
- Import endpoints:
  - `POST /recipes/import/link` (YouTube transcript + extraction)
  - `POST /recipes/import/upload` (currently stubbed transcript/OCR path)
  - `POST /recipes/import/transcript`
- CRUD endpoints:
  - `GET /recipes`
  - `GET /recipes/{recipe_id}`
  - `POST /recipes`
  - `PATCH /recipes/{recipe_id}`
  - `DELETE /recipes/{recipe_id}`

#### Meal plan routes (`backend/app/api/routes_mealplan.py`)

- `GET /meal-plan?start=&end=` returns range.
- `PUT /meal-plan/{date}` writes `recipe_ids` for one date.
- Auth-required and user-scoped.

#### Shopping routes (`backend/app/api/routes_shopping.py`)

- `GET /shopping-list?start=&end=`:
  - loads plans in range
  - fetches referenced recipes
  - aggregates ingredient quantities
- `POST /shopping-list/refine`:
  - sends aggregated items to refine service
  - returns `remove`, `likely_pantry`, `purchase_items`
- Auth-required.

### DB layer and data model

- `backend/app/db/session.py`
  - Async SQLAlchemy engine/sessionmaker.
  - Request dependency handles commit/rollback/close.

- `backend/app/db/models.py`
  - `users`
  - `auth_identities` (provider + provider_user_id unique)
  - `recipes` (includes `user_id`, `thumbnail_url`, ingredients JSON text)
  - `meal_plan` (composite PK: `user_id`, `date`)

- Repositories:
  - `repo_auth.py`: user + auth identity operations
  - `repo_recipes.py`: recipe CRUD (scoped by `user_id`)
  - `repo_mealplan.py`: date-range read + put/merge (scoped by `user_id`)

### Services

- `backend/app/services/storage_service.py`
  - Builds S3 presigned PUT URL.
  - Key format: `recipes/{uuid}{ext}` where ext comes from `mimetypes.guess_extension(content_type)`.
  - Returns signed `upload_url` and public `file_url`.

- `backend/app/services/extract_service.py`
  - Thin wrapper around extraction functions in `app/extract.py`.

- `backend/app/services/refine_service.py`
  - Thin wrapper around `app/refine.py`.

- `backend/app/services/shopping_service.py`
  - Deterministic aggregation logic for ingredient quantities.

- `backend/app/services/stores/`
  - `base.py`: protocol/abstractions.
  - `amazon.py`: stub implementation (returns empty list).

### Extraction/refine internals

- `backend/app/extract.py`
  - Parses YouTube IDs.
  - Uses `youtube-transcript-api` for transcript on link imports.
  - `get_transcript_from_uploaded_file(...)` is stubbed.
  - `get_ocr_text_from_video(...)` is stubbed.
  - If `OPENAI_API_KEY` missing, falls back to stub extraction.

- `backend/app/refine.py`
  - LLM-powered shopping refinement when API key exists.
  - Fallback mode returns reasonable defaults if LLM is unavailable.

- `backend/app/models.py`
  - Pydantic app models: recipe, ingredients, meal plan, shopping list items.

---

## Frontend walkthrough

### Core config and API helper

- `frontend/app/config.ts`
  - API base resolution:
    - use `NEXT_PUBLIC_API_BASE` when set
    - otherwise fallback to `http://localhost:8000`
  - No more `window.location` hostname derivation.

- `frontend/app/lib/api.ts`
  - `apiFetch(path, options)` always calls `fetch(`${getApiBase()}${path}`, ...)`.
  - Always includes `credentials: 'include'`.
  - Handles FormData vs JSON `Content-Type`.
  - Redirects to `/login` on 401 (except while already on auth pages).

### Auth state management

- `frontend/app/lib/auth.tsx`
  - `AuthProvider` calls `/auth/me` on mount.
  - Exposes `user`, `loading`, `refreshUser`, `logout`.
  - `logout` calls `/auth/logout`, clears local state, navigates to `/login`.

- `frontend/app/components/RequireAuth.tsx`
  - Guards protected pages: redirects unauthenticated users to login.

### Pages and user flows

- `frontend/app/page.tsx`
  - Root redirect based on auth state.

- `frontend/app/login/page.tsx`
  - Submits to `/auth/login` via `apiFetch`.
  - On success calls `refreshUser()` and goes to `/library`.

- `frontend/app/register/page.tsx`
  - Submits to `/auth/register` via `apiFetch`.
  - On success calls `refreshUser()` and goes to `/library`.

- `frontend/app/library/page.tsx`
  - Lists recipes, delete support, navigation to detail/edit/import.

- `frontend/app/library/[id]/page.tsx`
  - Recipe editing.
  - S3 image upload flow implemented:
    1. POST `/recipes/upload-image` with file FormData
    2. `PUT` to returned `upload_url`
    3. Save returned `file_url` in recipe `thumbnail_url` via PATCH

- `frontend/app/recipe/[id]/page.tsx`
  - Read-only recipe view.

- `frontend/app/import/page.tsx`
  - Import from video link or transcript.

- `frontend/app/planner/page.tsx`
  - Weekly planning UI; reads/writes meal plan API.

- `frontend/app/shopping-list/page.tsx`
  - Aggregated list by week + optional refine call.

- `frontend/app/store-preview/page.tsx`
  - Frontend-only store search preview based on sessionStorage data.

### Shared UI and utils

- Components:
  - `Header.tsx`
  - `NavAuth.tsx`
  - `RecipeCard.tsx`
- Utils:
  - `lib/week.ts`
  - `lib/store.ts`
  - `types.ts`

---

## Infrastructure and deployment files

- `backend/alembic/env.py` + `backend/alembic/versions/*`
  - DB migration setup and migration history for schema/auth evolution.

- `backend/Dockerfile`
  - FastAPI container build.

- `frontend/Dockerfile`
  - Next standalone build/runtime.

- `frontend/next.config.mjs`
  - `output: 'standalone'`.

- `docker-compose.yml`
  - Backend + frontend services for local containerized run.
  - Still mounts `./backend/uploads` although image serving now uses S3 flow.

- Env templates:
  - `backend/.env.example`
  - `frontend/.env.local.example`

---

## What is implemented end-to-end

- Cookie-based auth with register/login/logout/me.
- Multi-user scoping via `user_id` in recipes/meal plans.
- Recipe CRUD.
- S3 presigned image upload from browser.
- Recipe import from links/transcript.
- Meal planning API + frontend planner.
- Shopping list aggregation + optional refine endpoint.

---

## What is not done yet / known gaps

1. Uploaded video transcript extraction is still a stub.
2. OCR extraction path is still a stub.
3. Store integrations are not fully implemented (Amazon service is stubbed).
4. `_set_cookie` has debug `print(...)` statements that should be replaced with logging or removed.
5. `frontend/.env.local.example` comments mention old hostname behavior and are now outdated.
6. `docker-compose.yml` still includes legacy uploads volume mount not used by current S3 workflow.

---

## Risks and technical debt

- Cross-site auth is sensitive to environment configuration:
  - backend must set `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none`
  - CORS must include exact frontend origin(s)
  - frontend must keep `credentials: 'include'`
- Extraction/refine have fallback behavior that can hide degraded mode (no OpenAI key).
- No backend store-search integration yet despite UI flows.

---

## Recommended next priorities (top 5)

1. Implement real uploaded-video transcript pipeline (e.g., Whisper) and wire `/recipes/import/upload` fully.
2. Implement OCR extraction from frames or remove OCR branch until implemented.
3. Remove debug cookie prints in `auth.py` and add structured logs.
4. Update `frontend/.env.local.example` to match current `getApiBase()` behavior.
5. Clean `docker-compose.yml` legacy uploads mount and align compose/docs with current architecture.
