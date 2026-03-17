# Cooking App — Codebase Walkthrough JJXX

A full-stack cooking/recipe app: **FastAPI** backend (auth, recipes, meal plan, shopping list, S3 image uploads) and **Next.js** frontend on Vercel. Backend can run on AWS ECS + RDS; frontend uses `api.chef-world.com` for the API.

---

## 1. High-level architecture

| Layer        | Tech              | Purpose |
|-------------|-------------------|--------|
| Frontend    | Next.js (App Router) | Vercel: cook-lake-alpha.vercel.app |
| Backend API | FastAPI           | ECS: api.chef-world.com |
| DB          | PostgreSQL (RDS)  | Users, recipes, meal plans |
| Auth        | JWT in HttpOnly cookie | Cross-origin: Secure, SameSite=None |
| Images      | S3 presigned URLs  | Browser uploads directly to S3; recipe `thumbnail_url` |

---

## 2. Backend (FastAPI)

### 2.1 Entry and config

- **`app/main.py`**  
  Loads env (`load_dotenv`), validates `DATABASE_URL`, sets up CORS (origins from config; `allow_credentials=True` when origins are set), lifespan (init DB engine), mounts routers: auth, recipes, meal-plan, shopping. Exposes `/health`. No static uploads mount (images are S3).

- **`app/core/config.py`**  
  Pydantic Settings from env:
  - **Required:** `DATABASE_URL` (must be `postgresql+asyncpg://...`), validated at startup.
  - **Auth:** `AUTH_SECRET`, `COOKIE_SECURE`, `COOKIE_SAMESITE` (explicit `env="COOKIE_*"` for ECS). SameSite normalized to lowercase.
  - **CORS:** `CORS_ALLOW_ORIGINS` (comma-separated; must list frontend origin for cookies).
  - **Optional:** `OPENAI_API_KEY`, `AWS_REGION`, `S3_BUCKET_NAME` (S3 pair: both or neither).
  - **S3:** Validator ensures `AWS_REGION` and `S3_BUCKET_NAME` are both set or both empty.

- **`app/core/security.py`**  
  JWT create/decode (AUTH_SECRET), bcrypt password hashing.

- **`app/core/logging.py`**  
  Logging configuration.

### 2.2 API routes

| Prefix        | File                 | Endpoints | Auth |
|---------------|----------------------|-----------|------|
| `/auth`       | `app/api/auth.py`    | POST register, login, logout; GET me | register/login no cookie; others use cookie |
| `/recipes`    | `app/api/routes_recipes.py` | CRUD (list, get, create, PATCH, delete); POST upload-image (presigned URL); import (link, upload, transcript) | All auth |
| `/meal-plan`  | `app/api/routes_mealplan.py` | GET ?start=&end=; PUT /{date} with recipe_ids | All auth |
| (none)        | `app/api/routes_shopping.py` | GET /shopping-list?start=&end=; POST /shopping-list/refine | All auth |

- **Auth**  
  Register: create user + local identity (email + hashed password), set JWT cookie. Login: verify identity, set same cookie. Logout: clear cookie. `/me`: return current user from cookie. Cookie: `access_token`, HttpOnly, path `/`, configurable Secure + SameSite for cross-origin.

- **Recipes**  
  Full CRUD; `upload-image` accepts file for content-type only, returns S3 presigned `upload_url` and public `file_url` (used as `thumbnail_url`). Import: link (YouTube transcript + optional OCR → LLM → save), upload (video file; transcript stubbed), transcript (pasted text). All use `get_current_user`.

- **Meal plan**  
  Range query by date; PUT per date with list of recipe IDs (breakfast/lunch/dinner encoded in order or structure on frontend).

- **Shopping list**  
  Aggregates ingredients from meal plans in date range (service layer); refine endpoint sends aggregated list to LLM, returns remove / likely_pantry / purchase_items (stateless).

### 2.3 Database

- **`app/db/session.py`**  
  Async engine from `DATABASE_URL`, `async_sessionmaker`; `get_session()` dependency (commit on success, rollback on exception).

- **`app/db/models.py`**  
  SQLAlchemy: `UserModel`, `AuthIdentityModel` (provider, provider_user_id, password_hash), `RecipeModel` (user_id, title, source_url, thumbnail_url, ingredients JSON, raw_extraction_text), `MealPlanModel` (user_id, date, recipe_ids JSON). All tenant-scoped by `user_id`.

- **Repos**  
  `repo_auth.py`: user and identity CRUD. `repo_recipes.py`: save/get/list/delete recipes. `repo_mealplan.py`: get range, put by date. No shopping table; shopping is computed from meal plans + recipes.

### 2.4 Services

- **`app/services/storage_service.py`**  
  S3 presigned PUT URL for image uploads; key `recipes/{uuid}{ext}` (mimetypes); returns `upload_url` and public `file_url`. Uses `AWS_REGION` and `S3_BUCKET_NAME` from config.

- **`app/services/extract_service.py`**  
  Thin wrapper around `app.extract`: transcript, OCR stubs, `extract_recipe_from_text`.

- **`app/services/refine_service.py`**  
  Wraps `app.refine.refine_shopping_list` (LLM).

- **`app/services/shopping_service.py`**  
  Pure logic: parse quantities, aggregate by ingredient name (same unit), no DB.

- **`app/services/stores/base.py`**  
  Protocol/interface for store search (`StoreItem`, search method).

- **`app/services/stores/amazon.py`**  
  Stub: `search` returns `[]`; TODO PA-API.

### 2.5 Recipe extraction and refine (LLM)

- **`app/extract.py`**  
  - YouTube URL → video ID; `get_transcript_from_video_link` uses youtube-transcript-api (en/zh).  
  - `get_transcript_from_uploaded_file` and `get_ocr_text_from_video` are **stubs** (empty/placeholder).  
  - Builds prompt from transcript + OCR text; calls OpenAI (`gpt-4o-mini`) for JSON recipe. Without `OPENAI_API_KEY` uses `_stub_extraction` (e.g. demo “Mapo Tofu”). Returns Pydantic `Recipe`.

- **`app/refine.py`**  
  `refine_shopping_list(items, pantry_names)`: sends items to OpenAI; returns remove, likely_pantry, purchase_items. Stateless; `pantry_names` accepted but not used in prompt (compatibility). Fallback if no key or on error.

### 2.6 Pydantic models (API / app layer)

- **`app/models.py`**  
  `IngredientItem`, `RecipeCreate`, `Recipe` (with id), `MealPlan`, `ShoppingListItem`. Used in routes and repos.

---

## 3. Frontend (Next.js)

### 3.1 App structure

- **`app/config.ts`**  
  `getApiBase()`: `NEXT_PUBLIC_API_BASE` if set, else `http://localhost:8000`. No `window.location`; production uses env from Vercel.

- **`app/layout.tsx`**  
  Root layout; wraps with `AuthProvider`; `Header` (nav + `NavAuth`).

- **`app/page.tsx`**  
  Home: if authenticated → redirect `/library`, else → `/login`.

### 3.2 Auth and API

- **`app/lib/auth.tsx`**  
  `AuthProvider`: on mount calls `GET /auth/me` (credentials), sets user/loading; exposes `user`, `loading`, `refreshUser`, `logout`. `useAuth()` for consumers. Logout calls `POST /auth/logout` then redirect.

- **`app/lib/api.ts`**  
  `apiFetch(path, options)`: `getApiBase() + path`, `credentials: "include"`, JSON or FormData. On 401 and not on login/register, redirect to `/login`. All backend calls (auth, recipes, meal-plan, shopping) go through this.

### 3.3 Pages (routes)

| Route            | File                    | Purpose |
|------------------|-------------------------|--------|
| `/`              | `app/page.tsx`          | Redirect to library or login |
| `/login`         | `app/login/page.tsx`    | Email/password → POST /auth/login → refreshUser → /library |
| `/register`      | `app/register/page.tsx` | Same for POST /auth/register |
| `/library`       | `app/library/page.tsx` | List recipes (GET /recipes), grid of cards; delete; link to import and edit; optional ?highlight= |
| `/library/[id]`  | `app/library/[id]/page.tsx` | Edit recipe: load PATCH save; image upload = POST upload-image → PUT to S3 → set thumbnail_url |
| `/recipe/[id]`   | `app/recipe/[id]/page.tsx` | Read-only recipe view; links to Edit and Add to Planner |
| `/import`        | `app/import/page.tsx`   | Tabs: video link or paste transcript; POST import/link or import/transcript; redirect to library?highlight=id |
| `/planner`       | `app/planner/page.tsx`  | Week view; draggable recipes; grid breakfast/lunch/dinner; GET/PUT meal-plan |
| `/shopping-list` | `app/shopping-list/page.tsx` | Week; GET shopping-list; “Prepare Smart Shopping List” → POST refine; copy; store links; store preview |
| `/store-preview` | `app/store-preview/page.tsx` | Reads refined list from sessionStorage; “Search on [store]” and “Open all”; no backend |

### 3.4 Components and lib

- **`app/components/Header.tsx`**  
  Logo; links: Library, Planner, Shopping List, Import (when logged in); `NavAuth`.

- **`app/components/NavAuth.tsx`**  
  Loading / Login+Register links / avatar dropdown (email, Logout).

- **`app/components/RequireAuth.tsx`**  
  If not loading and no user → redirect `/login`; else children. Wraps protected pages.

- **`app/components/RecipeCard.tsx`**  
  Thumbnail, title, ingredient preview; link to recipe; menu: Edit, Delete, Source.

- **`app/lib/week.ts`**  
  Week bounds (`getWeekBounds`), prev/next week, format label for planner/shopping.

- **`app/lib/store.ts`**  
  Store types (weee, yami, amazon), labels, search URLs, preferred store (localStorage), sessionStorage key for store-preview items.

- **`app/types.ts`**  
  Frontend types (e.g. Recipe, IngredientItem) aligned with API.

---

## 4. DevOps and env

- **Backend**  
  `Dockerfile`: Python 3.12, uvicorn. Migrations (Alembic) run separately (e.g. `alembic upgrade head`). `.env.example`: DATABASE_URL, AUTH_SECRET, CORS_ALLOW_ORIGINS, COOKIE_SECURE, COOKIE_SAMESITE, OPENAI_API_KEY, AWS_REGION, S3_BUCKET_NAME.

- **Frontend**  
  Next.js build; `NEXT_PUBLIC_API_BASE` in Vercel for production (e.g. https://api.chef-world.com).

- **docker-compose.yml**  
  Backend (port 8000, env_file backend/.env, volumes for data/uploads). Frontend (port 3000, NEXT_PUBLIC_API_BASE=http://localhost:8000). No Postgres in compose (assumes RDS or external DB).

- **Alembic**  
  `20250209_initial_schema.py` (recipes, meal_plan); `20250228_add_users_and_auth.py` (users, auth_identities, user_id on recipes/meal_plan).

---

## 5. What’s built end-to-end

- Auth: register, login, logout, /me; JWT in HttpOnly cookie; cross-origin cookie (Secure, SameSite=None) when env is set.
- Recipes: full CRUD; S3 image upload (presigned URL → browser PUT → thumbnail_url).
- Recipe import: YouTube link (transcript + LLM extraction); paste transcript; upload (video accepted but transcript stubbed).
- Meal plan: by-week view; get/put by date and recipe IDs.
- Shopping list: aggregate from meal plan; LLM refine (remove, likely_pantry, purchase_items); copy list; store links and store-preview from sessionStorage.
- Multi-tenant: all data keyed by user_id.

---

## 6. Not done / TODOs

- **Extract**
  - Transcript from **uploaded video**: stubbed; real impl would use Whisper (or similar).
  - **OCR from video**: stubbed; would sample frames and run OCR for on-screen ingredient lists.

- **Stores**
  - **Amazon** (and any backend store search): `stores/amazon.py` is a stub; TODO integrate PA-API and map to `StoreItem`. Weee/Yami have no backend; frontend only opens external search URLs with the item query.

- **Refine**
  - `pantry_names` is accepted but not used in the LLM prompt (stateless; kept for API compatibility).

- **Auth**
  - **Debug prints** in `app/api/auth.py` inside `_set_cookie`: `print("COOKIE_SECURE:", ...)` and `print("COOKIE_SAMESITE:", ...)`. Safe to remove or replace with logging.

- **Docker / local**
  - Compose has no Postgres service; use external DB or add a `db` service for local dev.
  - Backend compose still mounts `./backend/uploads`; backend no longer writes there (S3 only); volume can be removed for clarity.

- **Frontend**
  - Store preview and “refined list” are sessionStorage-only; no backend persistence of refined list or pantry preferences.
  - “Shop on Weee/Yami/Amazon” only opens external URLs with query string; no in-app store search.

---

## 7. Quick reference: env (production)

**Backend (ECS)**  
`DATABASE_URL`, `AUTH_SECRET`, `CORS_ALLOW_ORIGINS` (include frontend origin), `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none`, `OPENAI_API_KEY` (for extract/refine), `AWS_REGION`, `S3_BUCKET_NAME` (for image uploads).

**Frontend (Vercel)**  
`NEXT_PUBLIC_API_BASE=https://api.chef-world.com`

---

*Generated as a one-pass walkthrough of the Cooking codebase.*
