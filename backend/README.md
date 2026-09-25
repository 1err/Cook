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

Clients create authenticated jobs with `POST /recipes/import-jobs` (`mode: link` or `text`), or send a video to `POST /recipes/import-jobs/media` as multipart `file`, then poll `/recipes/import-jobs/{id}`. Drafts still require an explicit save. Media uploads use the existing Gemini analysis and recipe-quality pipeline; `GET /recipes/import-capabilities` reports availability and the 30 MiB media limit (31 MiB request envelope). No synchronous `/recipes/parse/video` route is provided.

Link jobs accept public YouTube, TikTok, and RedNote / 小红书 URLs, including RedNote share text and `xhslink.com` redirects. RedNote retrieval only contacts exact allowlisted post/CDN hosts with bounded reads and redirects, without cookies or login bypass. Accessible video bytes are analyzed by the same Gemini pipeline; public post text remains a fallback. Login-required posts return `source_access_required` with upload/text recovery guidance.

A RedNote share token is retained only in the private queued link payload so retrieval can work. Completed, failed, cancelled, revoked, or expired jobs clear or remove that payload through the existing queue lifecycle. Recipe attribution and uploaded-media/text attribution use canonical URLs without share tokens. No database migration or provider/budget configuration change is needed for the RedNote integration.

The media cap is application-owned: Gemini's [current inline-input table](https://ai.google.dev/gemini-api/docs/video-understanding) permits inputs below 100 MB, following the [January 8, 2026 limit increase](https://ai.google.dev/gemini-api/docs/changelog#january-8-2026). A 30 MiB file becomes 40 MiB of base64; the existing prompt, model, token bounds, timeouts, two-call operation cap, queue capacity, and account upload-byte quotas remain unchanged. The default 50 MiB daily upload allowance still applies, so two maximum-size uploads can exceed that account allowance.

Larger files increase upload buffers, PostgreSQL temporary job storage, and worker memory. At the unchanged 32-job queue ceiling, stored file bytes can approach 960 MiB across the queue; base64 adds 40 MiB per active maximum-size analysis before JSON serialization and HTTP buffers. This change does not establish concurrent capacity for the 1 GiB API task.

## AI recipe covers

Signed-in users can generate a cover from an unsaved import or the recipe they are editing. Regular users have up to 3 attempts/day and verified administrators up to 100/day, subject to shared daily, monthly AI, and cumulative storage allowances. Generation returns a preview URL; it never saves or edits a recipe. The client must explicitly select the image and then save the recipe. AI-generated covers are illustrative and may differ from the actual dish.

Apply `alembic upgrade head` before enabling this release. Migration `20260925_recipe_images` follows `20260924_video_import` and adds `recipe_image_generations` and `feature_entitlements`. Existing image uploads, recipes, and text-import quotas are unchanged. Missing tables fail closed without a provider call.

Configuration in `backend/.env.example`:

| Setting | Default | Purpose |
| --- | --- | --- |
| `AI_IMAGE_GENERATION_ENABLED` | `true` | Feature switch; a configured `OPENAI_API_KEY` is also required |
| `AI_IMAGE_ACCESS_MODE` | `registered` | `registered` allows signed-in users; `members` requires an active DB grant |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` | Server-selected model; clients cannot override it |
| `OPENAI_IMAGE_TIMEOUT_SECONDS` | `45` | Provider wall-clock deadline, bounded to at most 120 seconds |
| `AI_IMAGE_USER_REQUESTS_PER_MINUTE` | `1` | Per-account admission cap |
| `AI_IMAGE_USER_REQUESTS_PER_DAY` | `3` | Per-account allowance, resetting at midnight UTC |
| `AI_IMAGE_ADMIN_REQUESTS_PER_DAY` | `100` | Administrator image allowance; identity comes from `ADMIN_USER_IDS` |
| `AI_IMAGE_GLOBAL_REQUESTS_PER_MINUTE` | `10` | Shared admission cap across workers/accounts |
| `AI_IMAGE_GLOBAL_REQUESTS_PER_DAY` | `100` | Shared daily admission cap |

Each admitted request asks for one 1024×1024 PNG at low quality. It uses the existing application-owned OpenAI client with no automatic retries, validates the returned base64/PNG signature and 10 MiB maximum, and stores the image through the existing ownership/cleanup lifecycle and local/S3 helpers. Cumulative image storage counts/bytes still apply; generation uses its own minute/day limits and does not consume the manual-upload hourly quota. A full storage allowance rejects before calling the provider; actual bytes are atomically reserved before storage, so concurrent capacity changes may still prevent delivery after generation. The SDK wire contract is tested with mocked HTTP; provider account/model access still needs verification before rollout. No real provider calls are made by these tests.

The API is authenticated and returns `Cache-Control: no-store` for access/results:

- `GET /recipes/image-generation/access` returns `{enabled, allowed, reason, daily_limit, remaining, resets_at}`. Reasons are `disabled`, `unavailable`, `membership_required`, `daily_limit`, or `global_limit`; `resets_at` is UTC. The displayed allowance is daily; short-term rate caps are enforced on admission.
- `POST /recipes/generate-image` accepts `{request_id, title, description, ingredients, steps}`. `request_id` is a new UUID for an explicit new generation; all recipe fields are bounded. It returns `{request_id, status, file_url, error_code}`. A first admitted request completes synchronously; replay returns its original completed/failed result, or HTTP 202 while pending. Admission errors use `{detail: {code, message}}`; HTTP 429 includes `Retry-After`.
- `GET /recipes/image-generation/{request_id}` recovers that account's result after a lost response. Unknown or other-account IDs return 404. Keep the request ID when recovering; never generate a fresh ID merely because a response was lost.

Admission creates a durable, user-scoped request record and atomically reserves separate `image:` counters, a shared AI concurrency lease, and a conservative monetary amount in the existing `ai_call_ledger`/`ai_monthly_budgets` transaction before contacting the provider. Reusing an ID with different recipe content returns 409. Monetary or concurrency rejection rolls back image counters too. Regular images use the configured account monthly allowance; administrator images can use the configured app allowance as their account ceiling. Both remain subject to the same app-wide monthly budget and repository-enforced $30 hard cap shared with text and Gemini calls. No existing configured global budget is raised.

Image pricing was reviewed against the [official image guide](https://developers.openai.com/api/docs/guides/image-generation) on 2026-09-25: standard Image API text input $5/M tokens and image output $30/M tokens. The low-quality 1024-square example is about $0.006 output plus text input. The implementation reserves a UTF-8-byte input bound plus framing margin and 512 output tokens for this fixed format. It accepts only reviewed `gpt-image-2`/`gpt-image-2-2026-04-21` models; other configured models fail closed until their prices/bounds are reviewed. Returned usage reconciles the reservation before image validation, so invalid results or later storage failures still appear in estimated provider spend. Missing usage, timeout, and ambiguous failures retain the reservation; confirmed provider rejection refunds it. These are provider usage estimates using versioned standard rates, not invoice totals or guaranteed net charges after caching/discounts.

Failed admitted requests count against their daily image allowance and are never sent to the provider again. One overall deadline covers admission, provider, storage and finalization, capped by `AI_OPERATION_TIMEOUT_SECONDS`; explicit pre-provider expiry checking prevents delayed admission from starting work under an expired lease. Rollback/reconciliation/lease cleanup are bounded. Requests stuck past the provider deadline plus a 75-second completion margin become `generation_interrupted`. Generation/storage hold no DB connection. Completed/failed request records remain as idempotency tombstones until account deletion; removing them would allow reused IDs to generate again. Keep provider-project spending controls as a separate safeguard.

`GET /admin/ai-costs` requires administrator authorization and reports this UTC month's app-managed text, video and image calls grouped by provider/model/operation. Known usage estimates, unresolved reservations, unknown charges, tokens, generation outcomes, and remaining shared budget are separate. The earliest ledger record indicates available coverage; it does not assert when instrumentation began or invent pre-ledger costs. These totals exclude other API-key activity, taxes and hosting. The existing `/admin/ai-usage` and `/admin/operating-limits` endpoints remain available. Infrastructure estimates are separately available at `/admin/infrastructure-costs` and identify their AWS account-wide scope.

To later restrict access, set `AI_IMAGE_ACCESS_MODE=members` and have a **trusted server-side billing integration** upsert `feature_entitlements` with the verified account UUID, `feature_key='recipe_image_generation'`, and a paid-through `expires_at` in UTC. A null expiration is a non-expiring trusted grant. Revoke by deleting the row or expiring it. Verify billing webhook signatures and derive the account/expiry from trusted subscription data; no client endpoint grants entitlements, and client claims such as `is_paid` are rejected. Billing checkout, payment processing, and webhook integration are not included here.

Before production rollout, ensure the proxy request timeout exceeds the configured generation deadline plus storage time and that the application key can access the configured model. All generation work uses the API project's billing, not a user's ChatGPT subscription. Use S3 for persistent production images as with manual uploads.
