# Cooking Recipe API (Backend)

Production-ready FastAPI app with async SQLAlchemy, Alembic migrations, and layered structure.

For **end-to-end product flow**, Docker, and frontend integration, see the repo root **`CLAUDE.md`**.

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
alembic current
```

The current Alembic head is `20260825_step_meta`. It canonically backfills stable IDs and tutorial
metadata inside the existing JSON-in-Text `recipes.steps` column; it adds no SQL column.

## Run locally

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Tests

CI uses Python 3.12 and installs both the runtime and development requirement sets before running pytest:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

Run the same commands from `backend/`. For the stricter local release gate, promote every unfiltered Python warning to an error:

```bash
.venv/bin/python -W error -m pytest -q
```

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

**With S3** (`AWS_REGION` + `S3_BUCKET_NAME` set): presigned PUT from the browser, then save `file_url` on the recipe.

**Without S3** (local dev default): `POST /recipes/upload-image` saves the file under `./uploads` (or `LOCAL_IMAGE_UPLOAD_DIR`), serves it at `/uploads/...`, returns `upload_url: ""` and a full `file_url`. The frontend skips the PUT when `upload_url` is empty.

See the root `CLAUDE.md` for Docker volume `./backend/uploads`.

## Structure

- `app/core` — config (pydantic-settings), logging
- `app/db` — SQLAlchemy session, models, repos (recipes, meal_plan)
- `app/services` — extract, refine, shopping aggregation, stores (interface + stub)
- `app/api` — FastAPI routers (recipes, meal-plan, shopping)
