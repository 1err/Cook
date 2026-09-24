# Cooking Recipe API (Backend)

FastAPI backend with async SQLAlchemy, Alembic migrations, and explicit ownership boundaries. See [the engineering review](../docs/engineering-review-2026-09-14.md) for verified changes and remaining release requirements.

For **end-to-end product flow**, Docker, and frontend integration, see the repo root **`CLAUDE.md`**.

## Setup

```bash
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and set `DATABASE_URL`, a random `AUTH_SECRET`, `CORS_ALLOW_ORIGINS`, and optionally `OPENAI_API_KEY`. Keep real credentials outside source control and image build contexts.

## Database

Postgres only. `DATABASE_URL` is required and must be a Postgres URL (e.g. `postgresql+asyncpg://user:pass@host:5432/dbname`). If missing or SQLite, the app raises at startup.

**No schema drops on startup.** Create/update schema with Alembic:

```bash
alembic upgrade head
alembic current
```

The hardening migration adds `ai_usage_counters` after the cooking-session tables. Always use
`alembic heads` and `alembic current` to inspect the actual release and database revision.
AI-enabled endpoints require the counter migration before traffic is admitted.

## Run locally

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Tests

CI uses Python 3.12 and installs both the runtime and development requirement sets before running pytest:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -r requirements-dev.txt
.venv/bin/python -m playwright install chromium
.venv/bin/python -m pytest -q
```

Run these commands from `backend/`. On Linux, Playwright may also require `--with-deps`. The default suite skips the dedicated PostgreSQL concurrency module unless `TEST_DATABASE_URL` explicitly names `cooking_audit_test` on loopback or the task-owned local socket. Use an isolated database, apply Alembic there first, then pass its URL to the tests; never reuse application data. CI provisions its own database service. The current test-client stack emits two documented dependency deprecation warnings.

Focused tutorial timing and persistence checks:

```bash
.venv/bin/python -m pytest \
  tests/test_tutorial.py \
  tests/test_tutorial_step_migration.py \
  tests/test_recipe_tutorial_repository.py \
  tests/test_extract_tutorial.py \
  tests/test_tutorial_estimation.py \
  tests/test_recipe_tutorial_routes.py -q
```

## Docker

From repo root. Backend requires the Compose `postgres` service to be running:

```bash
docker compose up -d postgres
docker compose run --rm backend alembic upgrade head   # first time or after schema change
docker compose up backend
```

Or bring everything up (including postgres) with:

```bash
docker compose up --build
```

## Image uploads

**With S3** (`AWS_REGION` + `S3_BUCKET_NAME` set): the backend checks the actual bytes (10 MB maximum and matching JPEG/PNG/GIF/WebP signature), then stores exactly those bytes in an account-prefixed S3 key using a worker thread. It returns `upload_url: ""` and the final `file_url`; clients do not upload a second time. Signature checks do not replace a full image decoder or malware scanner.

**Without S3** (local dev default): `POST /recipes/upload-image` saves the file under `./uploads` (or `LOCAL_IMAGE_UPLOAD_DIR`), serves it at `/uploads/...`, returns `upload_url: ""` and a full `file_url`. The frontend skips the PUT when `upload_url` is empty.

See the root `CLAUDE.md` for Docker volume `./backend/uploads`.

## Structure

- `app/core` — config (pydantic-settings), logging
- `app/db` — SQLAlchemy session, models, repos (recipes, meal_plan)
- `app/services` — shopping aggregation, image storage, retailer services
- `app/api` — FastAPI routers (recipes, meal-plan, shopping)

## Production configuration

Set `APP_ENV=production`, a random `AUTH_SECRET` of at least 32 characters, `COOKIE_SECURE=true`, and exact HTTPS `CORS_ALLOW_ORIGINS`. `COOKIE_SAMESITE=none` requires secure cookies; sibling HTTPS app/API subdomains are normally same-site and can use `lax` if no cross-site preview origin is required. Browser mutations are checked against trusted origins; native bearer requests remain supported.

Grant administrator/catalog privileges with `ADMIN_USER_IDS` and `PUBLIC_LIBRARY_EDITOR_USER_IDS`, using verified account UUIDs. Empty lists deny access. The previous email allowlist is deliberately unsupported.

OpenAI settings and account/global request caps are in `.env.example`. Keep separate development and production provider projects and use a company-owned service identity. The backend owns one reusable client, bounds requests, records token counts without prompts, and closes the client at shutdown. Accepted operations consume their allowance even if subsequent provider work fails; these counters are not a dollar billing system.

## Recipe import jobs

Clients create authenticated jobs with `POST /recipes/import-jobs` (`mode: link` or `text`), or send a video to `POST /recipes/import-jobs/media` as multipart `file`, then poll `/recipes/import-jobs/{id}`. Drafts still require an explicit save. Media uploads use the existing Gemini analysis and recipe-quality pipeline; `GET /recipes/import-capabilities` reports availability and the 14 MiB media limit (15 MiB request envelope). No synchronous `/recipes/parse/video` route is provided.

Link jobs accept public YouTube, TikTok, and RedNote / 小红书 URLs, including RedNote share text and `xhslink.com` redirects. RedNote retrieval only contacts exact allowlisted post/CDN hosts with bounded reads and redirects, without cookies or login bypass. Accessible video bytes are analyzed by the same Gemini pipeline; public post text remains a fallback. Login-required posts return `source_access_required` with upload/text recovery guidance.

A RedNote share token is retained only in the private queued link payload so retrieval can work. Completed, failed, cancelled, revoked, or expired jobs clear or remove that payload through the existing queue lifecycle. Recipe attribution and uploaded-media/text attribution use canonical URLs without share tokens. No database migration or provider/budget configuration change is needed for the RedNote integration.
