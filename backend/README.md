# Cooking Recipe API (Backend)

Production-ready FastAPI app with async SQLAlchemy, Alembic migrations, and layered structure.

## Setup

```bash
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and set `DATABASE_URL` (required), `CORS_ALLOW_ORIGINS`, and optionally `OPENAI_API_KEY`.

## Database

Postgres only. `DATABASE_URL` is required and must be a Postgres URL (e.g. `postgresql+asyncpg://user:pass@host:5432/dbname`). If missing or SQLite, the app raises at startup.

**No schema drops on startup.** Create/update schema with Alembic:

```bash
alembic upgrade head
```

## Run locally

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Docker

From repo root. Backend requires Postgres; use the postgres profile so the database is running:

```bash
docker compose --profile postgres up -d postgres
docker compose run --rm backend alembic upgrade head   # first time or after schema change
docker compose up backend
```

Or bring everything up (including postgres) with:

```bash
docker compose --profile postgres up --build
```

## Image Uploads

Images are uploaded directly from the browser to AWS S3 using presigned URLs.

**Flow:**

1. Browser → FastAPI (generate presigned URL)
2. Browser → PUT image to S3
3. Frontend saves returned `file_url` as `recipe.thumbnail_url`

**Required env vars:**

- `AWS_REGION`
- `S3_BUCKET_NAME`

## Structure

- `app/core` — config (pydantic-settings), logging
- `app/db` — SQLAlchemy session, models, repos (recipes, meal_plan)
- `app/services` — extract, refine, shopping aggregation, stores (interface + stub)
- `app/api` — FastAPI routers (recipes, meal-plan, shopping)
