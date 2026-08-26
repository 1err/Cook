# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**This file is the authoritative reference for what the codebase currently does.** The older `CODEBASE_WALKTHROUGH.md` has been removed — there is no parallel narrative anymore. Trust this file plus the code. **When you change behavior, API surface, file layout, env vars, or deployment, update the matching section here in the same change.**

## Product summary

A personal cooking assistant. Each user has an account and a private library of recipes. They populate the library by either (a) pasting a written transcript or (b) submitting a YouTube video link (captions only — there is no audio/Whisper path). Both imports first produce an editable draft; extraction preserves the source procedure while adding duration, provenance, attention, and action metadata to each tutorial step. Web and mobile import review let the user correct that metadata before explicitly saving. Recipe detail then renders transparent timing labels plus an existing step image or a shared action pictogram, and offers a focused tutorial editor. The backend now owns one normalized active cooking session per account, including immutable dish/step snapshots, explicit passive timers, revisions, and idempotent mutations; the web/mobile Cook workspaces are the next checkpoint and are not yet exposed in navigation.

Users can also assign recipes to days of the week in the planner (breakfast / lunch / dinner slots). The centered desktop Planner keeps the complete week in one viewport; each populated meal slot adaptively fills one to three compact recipe rows and scrolls in place for a fourth or later recipe. Its saved-recipe rail has no footer action (the empty-state import guidance remains). The desktop recipe picker uses a three-column, image-rich card grid with a visible Add action for each result. The shopping list page aggregates ingredients across the planned week inside the same restrained 1120px shell and title rhythm as Library, and can produce a "smart" grouped grocery list via an LLM call plus suggested store products from Weee backed by a multi-layer cache.

The cache is shared across all users: when one user triggers a fresh scrape, every subsequent user gets the cached row instantly. A background warmer keeps the most common queries hot.

## Repo shape (npm workspaces + Python)

- `apps/web` — Next.js 14 App Router (`@cooking/web`). Cookie-based auth. Source of nearly all real product UI today. Pages: `import/`, `library/{,[id]}`, `library/friends/{,[userId]/{,[recipeId]}}` (friend library search + read-only browse + copy), `planner/`, `shopping-list/`, `recipe/[id]` (timed tutorial read view), `recipe/[id]/tutorial/edit` (focused tutorial editing and preview-only enrichment), `preview/` (admin cache console), `settings/` ("Share my library" toggle), `login/`, `register/`. Settings link lives in the NavAuth dropdown.
- `apps/mobile` — Expo / React Native iOS app (`@cooking/mobile`). Bottom tab bar (Library / Planner / Shopping / Profile) over per-tab native stacks, with Import as a root-level modal. Source layout is feature-folders + a small design system (see "Mobile structure" below). All product surfaces ship: auth flow, Library list with **segmented control between "My Library" and "Public Library"** (catalog browse + one-tap copy-to-library, already-copied detection via `catalog_source_recipe_id`), **friend library sharing** (search icon in Library header → `FriendSearchScreen` (email lookup) → `FriendLibraryScreen` (list + copy with already-copied detection); Profile toggle "Share my library" flips `users.is_library_public`), Recipe detail (timed tutorial labels, images/pictograms, and an Edit tutorial action; also the editor-only "Add/Remove public library" menu item gated by `/recipes/catalog/editor-status`), focused or full Recipe edit, Planner (week navigation + bottom-sheet recipe picker), Shopping (smart list + per-ingredient Weee product picks + **"Load top picks from Weee" bulk-scrape button** that opens all panels and fetches at concurrency 3 + per-category **"Already have" subsection for checked items** + planner-stale detection), Import (YouTube link + transcript with image upload and tutorial metadata review).
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
- **Vercel project setting *Root Directory* = empty.** The whole build runs from the repo root.
- **Repo-root `vercel.json`** is the single source of truth:
  - `framework: "nextjs"`
  - `installCommand: "npm ci --no-audit --no-fund --workspace=@cooking/web --include-workspace-root"` — `npm ci` is faster and deterministic from the lockfile (and avoids the `Tracker "idealTree" already exists` collision `npm install` hit). `--workspace=@cooking/web --include-workspace-root` scopes the install to only the web workspace + workspace root; the `@cooking/mobile` workspace (Expo / React Native) is **skipped on Vercel**, which removes ~770 packages and all of its old-transitive-dep deprecation warnings (`glob@7`, `inflight`, `rimraf@2/3`, `@babel/plugin-proposal-*`, `uuid@7`). Mobile is built locally with Expo and never on Vercel. `--no-audit --no-fund` silences security-audit and funding-message lines.
  - `buildCommand: "npm --workspace @cooking/web run build"` — runs `next build` inside the `@cooking/web` workspace.
  - `outputDirectory: "apps/web/.next"` — relative to the repo root.
- **Repo-root `package.json` lists `next` as a `devDependency`.** This is required: Vercel's framework detector reads the project's root `package.json` (regardless of Root Directory) and refuses to deploy without seeing `"next"` listed. The version must match what `apps/web/package.json` declares. When upgrading Next, update both files.
- **All Build & Development Settings overrides in the dashboard must be OFF.** `vercel.json` is the source of truth. Dashboard overrides layer on top of Vercel's default install pass and reintroduce the idealTree collision.
- **`@types/react@^18.3.12` + `@types/react-dom@^18.3.0` are pinned at the workspace ROOT** (`package.json::devDependencies`). This is non-obvious but load-bearing: mobile pins `@types/react@~19.1.0` for SDK 54, which npm would otherwise hoist and shadow web's React 18 types, failing the Next.js prod build with `Type 'bigint' is not assignable to type 'ReactNode'` in `apps/web/app/lib/i18n.tsx`. Root pin → v18 wins at root → mobile's v19 lives only in `apps/mobile/node_modules/`. `apps/web/tsconfig.json` also has explicit `paths` for `react` / `react-dom` pointing at apps/web's own copies as defense-in-depth. **Don't remove either pin without verifying `npm --workspace @cooking/web run build` still succeeds.**
- Production env vars (Vercel → Settings → Environment Variables → Production):
  - `NEXT_PUBLIC_API_BASE = https://api.chef-world.com` (so the browser calls the ECS backend, not localhost).
- History notes (don't repeat these mistakes):
  - Root Directory used to read `frontend/` from before the monorepo split, which broke every deploy with `The specified Root Directory "frontend" does not exist`.
  - Setting Root Directory to `apps/web` *seems* logical but doesn't help: Vercel still reads the repo-root `package.json` for its Next.js version check, and we can't reach a clean configuration from there without a dashboard install-command override that hits idealTree collisions. Root Directory must be empty.
  - `framework: "nextjs"` in `vercel.json` does **not** bypass the version-detection check; it only pins the framework choice. The check still requires `next` in the project's root `package.json`.

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
  - `OPENAI_API_KEY=<real key>` — set in the ECS task def env (not in this repo). When unset/empty, `app/core/llm.py::get_openai_client()` returns `None` and callers fall back to deterministic stubs (extract → demo Mapo Tofu / generic placeholder; refine → passthrough categorized as `Other`).
- Database: AWS RDS Postgres at `cooking-db.co944gii0fur.us-east-1.rds.amazonaws.com:5432`, database `postgres`, user `cooking`. `DATABASE_SSL` is **not** set in the task def today; if RDS forces TLS this should be flipped to `true`.
- Image storage: S3 bucket `cooking-images-930067562682` in `us-east-1`. Recipe uploads use presigned PUT directly from the browser when both `AWS_REGION` and `S3_BUCKET_NAME` are set (true in prod).
- Migrations: backend container runs `alembic upgrade head` on startup (`backend/Dockerfile` CMD). New tasks therefore self-migrate; no separate migration step is wired up.

**Deploy procedure (single script):**

```bash
bash scripts/deploy-backend.sh
```

What it does: ECR login → `docker buildx build --platform linux/amd64` from `./backend` → push two tags (`:latest` for the running task def + `:<git-sha>` for rollback) → `aws ecs update-service --force-new-deployment` against `cooking-cluster` / `cooking-backend-service` → wait for stable → smoke `/health` plus a route that should exist post-deploy. Fails fast if the smoke route 404s (deploy didn't actually roll). Defaults are hardcoded for the live account (`930067562682.dkr.ecr.us-east-1.amazonaws.com/cooking-backend`); override via env vars (`SERVICE`, `PROBE_PATH`, etc.) for other configs.

**Rollback:** every successful deploy leaves `cooking-backend:<git-sha>` in ECR. To revert, pull that tag, re-tag it as `:latest`, push, and re-run the update-service step from the script. Procedure in the script's footer.

**Deploy order when a feature spans backend + web** (e.g., friend-library, future similar features): deploy backend FIRST (`scripts/deploy-backend.sh`), verify the new route returns `401` not `404` against `https://api.chef-world.com`, THEN merge the feature branch to `main` (which auto-triggers Vercel). Reversed order ships web UI hitting 404s on prod backend.

### Local Docker stack

`docker-compose.yml` brings up Postgres + backend + web. Backend `.env` is loaded via `env_file: backend/.env`, but local compose-level overrides force `DATABASE_URL`, `DATABASE_SSL=false`, and a localhost CORS list. The web container is built with `NEXT_PUBLIC_API_BASE=http://localhost:8000` so the browser still talks to the host-published port. `./backend/uploads` is bind-mounted into `/app/uploads` so locally-uploaded recipe images survive container rebuilds (matters when `S3_BUCKET_NAME` is not set in local `backend/.env`).

### iOS — EAS Build

- App is published as `Chef World` (`apps/mobile/app.json::expo.name`). Bundle identifier: `com.chefworld.cooking` (iOS + Android). Deep-link scheme: `cooking://`.
- **Expo SDK 54** (`expo@^54.0.0`, `react@19.1.0`, `react-native@0.81.5`). New Architecture is enabled (`app.json::expo.newArchEnabled: true`) — required because Reanimated 4 (which SDK 54 ships) doesn't support the Legacy Architecture. SDK 55 will drop Legacy entirely, so we're already on the only supported path. Reanimated 4 splits worklets into `react-native-worklets` (peer); the Babel plugin name is `react-native-worklets/plugin`, **not** the legacy `react-native-reanimated/plugin`.
- Build profiles live in `apps/mobile/eas.json`:
  - `development` — dev client + simulator. `EXPO_PUBLIC_API_BASE=http://localhost:8000`. Use this for day-to-day iteration.
  - `preview` — internal-distribution build pointed at production API (`https://api.chef-world.com`). No dedicated staging environment exists yet; revisit `eas.json` when one does.
  - `production` — store-bound build. `autoIncrement: true` so EAS owns build numbers (matches `appVersionSource: "remote"`).
- Submit profile (`eas.json::submit.production.ios`) has placeholder `appleId` / `ascAppId` / `appleTeamId` — fill in before the first `eas submit -p ios`.
- One-time prerequisites:
  ```bash
  npm i -g eas-cli            # only if you don't already have it
  eas login                   # interactive Expo account login
  eas build:configure         # creates the project ID on Expo's side (only once)
  ```
- Typical flow:
  ```bash
  cd apps/mobile
  eas build --profile development --platform ios   # dev client for sim/device
  eas build --profile preview --platform ios       # shareable internal build
  eas build --profile production --platform ios && eas submit -p ios
  ```
- Real-device dev: set `EXPO_PUBLIC_API_BASE=http://<lan-ip>:8000` in your shell before `expo start --dev-client` (the `localhost` default resolves to the phone itself, not your machine).

#### Running the dev client locally — gotchas worth remembering

Three things will eat hours if you don't know them up front. The simulator's redbox error message is misleading in two of these cases ("Could not connect to development server" when Metro is actually fine).

1. **Backend must be running first.** The dev client hits `http://localhost:8000` by default (`apps/mobile/src/config.ts::getApiBase`). Without `docker compose up --build -d` from the repo root, every API call returns "Network request failed" — the simulator boots fine but login fails immediately. Easy to forget after a fresh laptop reboot. Verify with `curl http://localhost:8000/health`.

2. **Hotspot / "constrained" network interfaces blackhole the bundle.** When the Mac's active interface is on a phone hotspot (typically `172.20.10.x`, marked `flags=…constrained` in `ifconfig`), Expo prints `exp://<hotspot-ip>:8081` on startup and the simulator's bundle fetch silently times out at 30s. Metro is healthy (`curl http://localhost:8081/status` returns 200), but the simulator can't reach the hotspot IP. Fix:
   ```bash
   cd apps/mobile
   REACT_NATIVE_PACKAGER_HOSTNAME=localhost npx expo start --ios --clear
   ```
   Forces Metro's bundle URL to `http://localhost:8081/...`. The simulator can always reach `localhost`.

3. **Don't run `npm run mobile:ios -- --clear` from the repo root.** npm strips the `--clear` flag with an `Unknown cli config "--clear"` warning, so Metro starts with a stale Babel cache. The worklets plugin (`react-native-worklets/plugin`, used by Reanimated 4) needs the cache cleared on fresh installs (otherwise you'll get cryptic "Reanimated is not configured properly" failures). Run the expo CLI directly:
   ```bash
   cd apps/mobile && npx expo start --ios --clear
   ```

If you see the "Could not connect" redbox, check in this order: is `curl http://localhost:8081/status` returning 200 (Metro alive)? is the bundle URL on-screen using `localhost` and not a hotspot IP (gotcha #2)? did the bundle compile finish (look for `Bundled <ms> apps/mobile/index.js (N modules)` in Metro stdout)? If Metro alive + URL is localhost + bundle never compiles, suspect a workspace resolution failure — `apps/mobile/metro.config.js` must be present (see "Cross-package imports" below).

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
npm run test:web          # web Vitest suite
npm run test:mobile       # mobile Jest suite
npm --workspace @cooking/web run test:e2e  # web Playwright suite (starts Next dev)
npx tsc -p apps/web/tsconfig.json --noEmit
npx tsc -p apps/mobile/tsconfig.json --noEmit
```

The web unit suite uses Vitest, native mobile uses Jest/RNTL, browser flows use Playwright, and the backend uses pytest. A focused test can be passed after `--`, for example `npm --workspace @cooking/web test -- StepListEditor.test.tsx` or `npm --workspace @cooking/web run test:e2e -- tutorial.spec.ts`.

### Backend (run from `backend/`)

Requires Python 3.11, 3.12, or 3.13 (3.14 is not supported — pydantic-core Rust bindings).

```bash
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
playwright install chromium    # store scraper uses Playwright

cp .env.example .env
# Required: DATABASE_URL (postgresql+asyncpg://...), AUTH_SECRET (≥16 chars).
# Optional: OPENAI_API_KEY, AWS_REGION+S3_BUCKET_NAME, COOKIE_SECURE/SAMESITE, PUBLIC_LIBRARY_EDITOR_EMAILS.

alembic upgrade head           # apply migrations
python run.py                  # uvicorn on :8000 with reload
.venv/bin/python -m pytest -q  # full backend pytest suite
```

`AUTH_SECRET` must be ≥16 characters (`backend/app/core/security.py::_get_secret`) — auth endpoints raise at runtime otherwise. The `.env.example` placeholder must be replaced.

`DATABASE_URL` must be `postgresql+asyncpg://...`; startup hard-fails on SQLite or missing URL (`backend/app/core/config.py::Settings.require_postgres`). Special characters in the password (notably `%`) must be URL-encoded.

Alembic head is `20260827_cook_sess` (chain tail: `20260510_user_lib` → `20260514_recipe_tut` → `20260825_step_meta` → `20260827_cook_sess`; see `backend/alembic/versions/`). `20260825_step_meta` canonically backfills existing JSON tutorial steps; `20260827_cook_sess` adds normalized active-session, dish-snapshot, step-state, and mutation-idempotency tables. New revisions: `alembic revision -m "msg"` then edit the generated file.

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
# Friend-library end-to-end smoke (requires jq + 2 test accounts):
JD_EMAIL=jd@gmail.com BOB_EMAIL=bob+test@example.com \
  bash backend/scripts/smoke_friend_library.sh <jd-pw> <bob-pw>
```

## API surface (current)

Mounted in `backend/app/main.py`. All routes except `/auth/{register,login,logout}`, `/health`, and `/uploads/*` require auth (`get_current_user`).

| Method | Path | Notes |
|--------|------|-------|
| POST | `/auth/register` | Sets HttpOnly cookie + returns `access_token` in body (mobile uses body). 8-char min password. |
| POST | `/auth/login` | Same |
| POST | `/auth/logout` | Clears cookie |
| GET | `/auth/me` | Returns `{id, email, is_library_public}` |
| POST | `/auth/library-visibility` | Body `{is_public: bool}`. Flips current user's library-sharing flag. Returns `{is_library_public: bool}` |
| POST | `/recipes/parse/link` | Returns a draft Recipe from a YouTube URL **without saving** — caller edits then `POST /recipes` |
| POST | `/recipes/parse/transcript` | Returns a draft Recipe from pasted transcript **without saving** |
| POST | `/recipes/upload-image` | Multipart. S3 presigned PUT if `AWS_REGION`+`S3_BUCKET_NAME` set, else local disk + `/uploads/...` URL |
| GET | `/recipes` | List user's recipes |
| POST | `/recipes` | Create |
| GET | `/recipes/{id}` | |
| PATCH | `/recipes/{id}` | Partial update of `title`, `thumbnail_url`, `ingredients`, `library_tags`, `description`, `total_time_minutes`, `steps`, `tips`, `equipment` |
| POST | `/recipes/{id}/tutorial/estimate` | Owned-recipe check plus preview-only enrichment of submitted `{steps}`. Returns `{steps}` without saving; only a later `PATCH /recipes/{id}` persists the user's draft. |
| DELETE | `/recipes/{id}` | 204 |
| GET | `/recipes/catalog` | Public recipe catalog |
| GET | `/recipes/catalog/editor-status` | `{ can_manage: bool }` based on `PUBLIC_LIBRARY_EDITOR_EMAILS` |
| POST | `/recipes/catalog/{id}/copy` | Clone a public recipe into the caller's library (idempotent via `catalog_source_recipe_id`) |
| POST | `/recipes/{id}/catalog` | `{ is_public: bool }` — toggle catalog visibility (editor-only) |
| GET | `/users/search?email=` | Exact email match. 200 with `{id, email, is_library_public}` only when target's library is public AND not the caller. 404 otherwise (uniform — no enumeration leak). |
| GET | `/users/{user_id}/recipes` | List a user's recipes if `is_library_public=true` and not self. 404 otherwise. |
| POST | `/users/{user_id}/recipes/{recipe_id}/copy` | Idempotent clone into the caller's library. Sets `catalog_source_recipe_id` on the new row. |
| GET | `/meal-plan?start=&end=` | Inclusive YYYY-MM-DD range |
| PUT | `/meal-plan/{date}` | Body accepts `{breakfast,lunch,dinner: string[]}` **or** legacy `{recipe_ids: string[]}` (normalized into dinner slot) |
| GET | `/cooking-session/active` | Current user's canonical active snapshot or `null`; persists elapsed running timers as `needs_attention` without completing them |
| POST | `/cooking-session` | Body `{recipe_ids}`. Snapshots owned recipes; 409 `active_session_exists` when the account already has a session |
| POST | `/cooking-session/{id}/dishes` | Add owned recipe snapshots to the active session |
| DELETE | `/cooking-session/{id}/dishes/{dish_id}` | Remove a dish; removing the final dish discards the session |
| POST | `/cooking-session/{id}/steps/{step_id}/actions` | Idempotent revision-checked transition: start/pause/resume/extend timer, complete, skip, reopen, or take alert ownership |
| POST | `/cooking-session/{id}/finish` | Deletes an all-resolved session; unresolved work returns 409 `session_not_complete` |
| DELETE | `/cooking-session/{id}` | Explicitly discard the active session |
| GET | `/shopping-list?start=&end=` | Aggregates ingredients across week's meal plans |
| POST | `/shopping-list/refine` | LLM grocery list. Stateless. Body `{items: [{name,quantity}]}`. Returns `{remove: [], likely_pantry: [], purchase_items: [...]}` — `remove`/`likely_pantry` are always empty (legacy contract; staples come back inside `purchase_items` with `category: "Pantry & Dry Goods"`) |
| GET | `/store-products?query=` | Omitted `store` returns `{products, expires_at}`; explicit legacy `store=weee` returns `StoreProduct[]`; Amazon/unknown return 400 before lookup. In-memory L1 → Postgres L2 → Playwright scrape |
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

### Cooking-session domain and concurrency

`cooking_sessions.user_id` is unique, so an account has at most one active session. `cooking_session_dishes` and `cooking_session_steps` copy recipe title, image, ingredients, tutorial text, timing provenance, attention type, action type, and existing step image. They deliberately retain `recipe_id` only as provenance rather than a foreign key: later recipe edits/deletion cannot alter an in-progress cook. Finishing or discarding deletes the normalized session and all children; V1 keeps no history.

Step mutations lock the user-scoped session row and require the step's current `revision`. Every request carries a random mutation UUID and device ID; `cooking_session_mutations` makes retries idempotent. Two devices can safely advance different dishes because revisions live on steps. A stale mutation returns a stable 409 `detail.{code,message}`; ownership misses use 404. Starting/resuming a passive timer records an absolute `timer_ends_at` plus alert owner. Reads turn elapsed running timers into `needs_attention`; they never auto-complete or advance the dish. Completing/skipping explicitly advances the earliest locked step. Time-weighted progress and deterministic attention ordering live in `packages/shared/src/cookingSession.ts` for both clients.

### Where LLM logic lives

OpenAI prompts + calls live in `backend/app/extract.py` (recipe extraction) and `backend/app/refine.py` (smart shopping list). Both go through `app/core/llm.py::get_openai_client()`, which returns `None` when `OPENAI_API_KEY` is unset so callers fall back to deterministic stubs (extract → demo Mapo Tofu / generic placeholder; refine → passthrough categorized as `Other`). Model is `gpt-4o-mini`. The `app/services/{extract,refine}_service.py` shims that used to live above these modules have been removed — routers import from `app.extract` / `app.refine` directly. The empty-`remove`/`likely_pantry` legacy contract for `/shopping-list/refine` is now hardcoded in `routes_shopping.py` instead of a wrapper service.

### Refine is on-demand and per-week-cached

`/shopping-list/refine` only fires when the user clicks **Prepare smart shopping list**. The shopping page persists three keys per week:

- `smartShoppingList:{weekMonday}` — refined payload + `_ui.{hidden,checked}` + `_plannerFingerprint` (`sessionStorage`); writes and removals are best effort when quota/privacy settings deny storage
- `smartShoppingProducts:{weekMonday}:weee` — Weee product picks with authoritative expiry (`sessionStorage`); open panels without a retained positive are requeued on reload, and writes/removals are best effort
- `plannerWeekFingerprint:{weekMonday}` — written by planner; shopping page compares against `_plannerFingerprint` to mark the smart list **stale** when the planner changed afterward (`localStorage`)

Don’t add automatic refine triggers — token cost is intentional.

### Import flow (two-step)

`apps/web/app/import/page.tsx` calls `/recipes/parse/{link,transcript}` to get a draft Recipe, lets the user edit recipe fields and every tutorial step's text, duration, attention type, and action illustration, then calls `POST /recipes` only after review. Mobile follows the same two-step behavior in its Import modal. There is no single-step "import + save" endpoint anymore (the legacy `/recipes/import/*` routes were removed). The link path is YouTube-only via `youtube-transcript-api`; uploaded video files (Whisper) are not supported. A pasted written recipe or video transcript belongs in the Transcript source field, not in the ingredient editor.

Normal extraction asks the existing model call for step metadata without making a second enrichment call. It may infer metadata but must preserve supplied instruction text/order and must not add, split, merge, or invent procedural steps. Missing or malformed metadata remains editable and is normalized to a transparent fallback rather than failing the whole draft.

### Store-product lookup has three layers

`GET /store-products?query=`: omitted `store` returns `{products, expires_at}` for current clients; explicit legacy `store=weee` returns the same validated/fresh products as an array; Amazon and unknown explicit stores return 400 before service work. The lookup is in-memory `CACHE` (in `store_scraper.py`) → Postgres `cached_store_products` (`CACHE_TTL_SECONDS = 86400`, `CACHE_VERSION = "v7"`) → live Playwright scrape. Queries are normalized in `prepare_store_query` (lowercased, banned modifiers like `新鲜` / `切块` stripped, quantity fragments removed). Weee uses zh locale + zh search URL when query has CJK. Product links must be HTTPS URLs on `sayweee.com` or one of its subdomains before PDP navigation or cache/live output; v7 makes older unvalidated rows inert. Detail-page enrichment fills better names/images. **Cache rows are shared across all users**: a fresh scrape from one user becomes an instant L2 hit for everyone else.

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

### Friend library sharing is orthogonal to the public catalog

Two separate visibility models coexist:

- `RecipeModel.is_public_catalog` (per-recipe flag) drives the global editor-curated catalog at `/recipes/catalog/*`. Flagging a recipe is gated by `PUBLIC_LIBRARY_EDITOR_EMAILS` (see "Public catalog gating" above).
- `UserModel.is_library_public` (per-user flag) drives friend-library sharing at `/users/*` (search by email, list a friend's library, copy from it). Anyone can flip this for themselves via `POST /auth/library-visibility` — no editor gating. When on, your entire library becomes visible to anyone who searches your exact email.

`POST /users/{id}/recipes/{rid}/copy` and `POST /recipes/catalog/{id}/copy` both set `catalog_source_recipe_id` on the new row, so client-side already-copied detection (`Set<catalog_source_recipe_id>`) works the same way for both surfaces. The friend-library code lives in `backend/app/db/repo_users.py` + `backend/app/api/routes_users.py`. Smoke testable via `backend/scripts/smoke_friend_library.sh <jd-pw> <bob-pw>`.

**Deploy order for features that add backend endpoints + web UI** (applies to friend-library and anything similar): deploy the new backend ECS task def FIRST so the new routes exist on prod, THEN merge the feature branch to main (which auto-triggers Vercel). If reversed, web ships UI that hits `404` on prod backend until ECS catches up. Quick prod readiness check before merging web: `curl -i https://api.chef-world.com/<new-route>` should return `401 Not authenticated` (route exists, just needs auth) not `404 Not Found` (route doesn't exist yet).

### API base resolution

- Web (`apps/web/app/config.ts::getApiBase`) — `NEXT_PUBLIC_API_BASE` if set, else `http://localhost:8000`. Vercel builds bake in `https://api.chef-world.com`; Docker compose bakes in `http://localhost:8000`.
- Mobile (`apps/mobile/src/config.ts::getApiBase`) — `EXPO_PUBLIC_API_BASE` if set, else `http://localhost:8000` with a one-time console warning. **Real-device** testing requires LAN IP (`http://192.168.x.x:8000`); `localhost` resolves to the phone itself. For testing against prod, set `EXPO_PUBLIC_API_BASE=https://api.chef-world.com` in the Expo env.

### Cross-package imports

Web and mobile depend on `@cooking/shared` and `@cooking/api-client` via `file:` workspace links. `apps/web/next.config.mjs` lists them in `transpilePackages` — add new shared packages there too, or Next won’t transpile them. The web Dockerfile's build context is the **repo root** for the same reason. `@cooking/api-client` exposes the full recipe surface including catalog ops: `recipes.catalog()`, `recipes.copyCatalog(id)`, `recipes.editorStatus()`, `recipes.setCatalogVisibility(id, isPublic)`. Web currently uses raw `apiFetch` for the catalog routes; mobile uses these typed methods.

For mobile, `apps/mobile/metro.config.js` adds the workspace root to `watchFolders` and `resolver.nodeModulesPaths`. The `disableHierarchicalLookup` flag is intentionally left at the default (off): with the SDK 54 dep tree, several Expo transitives (`expo-asset`, `babel-preset-expo`, etc.) end up nested at `apps/mobile/node_modules/expo/node_modules/` rather than hoisted to the root — Metro needs hierarchical walking to find them. Without the workspace-root `watchFolders` + `nodeModulesPaths` entry, Metro hangs on bundle compile (the simulator shows a misleading "Could not connect to development server" red error after a 30s timeout). When adding a new shared package, no Metro changes are needed; just install it in `apps/mobile/package.json`.

The mobile `babel.config.js` uses `require.resolve("babel-preset-expo")` and `require.resolve("react-native-worklets/plugin")` rather than bare specifiers. This is necessary because npm sometimes installs these into `apps/mobile/node_modules/` rather than hoisting to the repo root, and Babel runs from `<root>/node_modules/@babel/core/...` where Node's standard resolver can't reach into a sibling workspace. `require.resolve` runs from the babel.config.js file's location, sidestepping the issue.

Pages and components import shared helpers (week math, meal-plan slot helpers, ingredient formatting, shopping categories, recipe tag groups, `getRecipeTags`) directly from `@cooking/shared` — there are no per-app re-export shims under `apps/web/app/lib/`. The one truly web-only lib is:

- `app/lib/recipeCategories.ts` — re-exports `RECIPE_TAG_GROUPS` / `TAG_LABELS` / `CATEGORY_LABELS` / `LIBRARY_FILTER_CHIPS` / `recipeTagGroupFor` / `RecipeTagSlug` from `@cooking/shared`, plus the web-only `categoryBadgeStyle(slug)` (returns `CSSProperties` — needs the React DOM type). Mobile imports the shared exports directly.
- `app/lib/recipeTags.ts` is a thin re-export of `getRecipeTags` from `@cooking/shared`; existing callers don't need to change. Mobile uses `import { getRecipeTags } from "@cooking/shared"` directly.

The slug union `RecipeTagSlug` lives in `@cooking/shared/types`.

### Recipe tags

Two parallel concepts on `RecipeModel`:

- `library_tags` (string of JSON array; new) — multi-select.
- `library_category` (nullable single string; legacy) — kept in sync as `tags[0]`.

`backend/app/models.py` defines `RECIPE_TAG_SLUGS` (frozen 31-slug set) and `LEGACY_LIBRARY_CATEGORY_TO_TAG` (e.g. `quick_dinner` → `quick`). Anything written to either column passes through `coerce_library_tags`. Request bodies in `routes_recipes.py` use the reusable `LibraryTags = Annotated[list[str], BeforeValidator(coerce_library_tags)]` from `app/api/_types.py` instead of repeating a per-model `@field_validator`. The same slug list is mirrored as a TS union in `packages/shared/src/types.ts::RecipeTagSlug` and re-listed in `packages/shared/src/recipeTags.ts::RECIPE_TAG_GROUPS`. **Adding a tag means three edits**: backend `models.py`, shared `types.ts`, shared `recipeTags.ts`.

### Recipe tutorial fields

`Recipe` carries five backward-compatible fields beyond the base ingredients/title set:
`description`, `total_time_minutes`, `steps`, `tips`, and `equipment`. They are stored in columns
added by `20260514_recipe_tut`; list-shaped fields remain JSON-in-Text, `description` is `Text NULL`,
and `total_time_minutes` is `Integer NULL`. Migration `20260825_step_meta` canonically backfills the
existing step JSON in place and is idempotent.

The canonical `RecipeStep` contract is:

```text
id: UUID string
text: non-empty string
duration_seconds: whole number
duration_source: stated | estimated | user | fallback
attention_type: hands_on | passive
action_type: prep | chop | mix | season | sear | simmer | boil | bake | rest | drain | assemble | plate | other
image_url: string | null
```

Old strings and partial dictionaries remain accepted at request/repository boundaries. Canonical
normalization trims/drops empty instructions, preserves unique valid IDs and existing images, and
generates a stable UUID for missing/duplicate IDs. A legacy numeric duration with no provenance is
`stated`; malformed metadata becomes `fallback` / `hands_on` / `other`. Generated, stated, and
fallback durations clamp to 15–86,400 seconds; explicit user edits clamp to 1–86,400 seconds.
Missing durations use positive remaining stated total time (distributed across missing steps with a
60-second minimum), otherwise the median known duration, otherwise 300 seconds. A source-stated
`total_time_minutes` is preserved; only an absent total is derived as the rounded-up normalized
duration sum.

Web and mobile import review plus saved-recipe tutorial editing preserve step IDs, order, metadata,
and hidden `image_url` values. Changing duration sets `duration_source="user"`. Existing images take
precedence in detail; missing/broken images use the shared vector pictogram. "Estimate missing
tutorial details" only updates local editor state through the preview endpoint; Cancel performs no
PATCH, and Save PATCHes the steps. Reading a recipe or opening a future cooking flow must never
silently rewrite tutorial metadata.

### Recipe view skin (sub-project E)

Recipe detail uses the cross-platform Culinary Workbench system from the UI reset. Web
`apps/web/app/recipe/[id]/page.tsx` keeps its route styling in `RecipeDetail.module.css`
(not `globals.css`), with a two-column ingredients/tutorial layout above its responsive
breakpoint and a single column below. `RecipeTutorial.tsx` owns the timed step read view;
`recipe/[id]/tutorial/edit/page.tsx` owns focused editing. Mobile
`RecipeDetailScreen.tsx` and `RecipeEditScreen.tsx` provide the same read/edit behavior
through native theme primitives and a vertical phone layout. Web SVG and native
`react-native-svg` render the same action primitive data from `@cooking/shared`.

### Meal plan storage

`MealPlanModel.recipe_ids` is a JSON-serialized string in a `Text` column. Newer rows are objects (`{breakfast,lunch,dinner}`); some legacy rows are arrays. `normalize_meal_plan_slots` (in `app/models.py`) handles both shapes on read and on PUT body parsing. Don’t bypass it.

### Mobile structure

`apps/mobile/src/` is organized into:

- `theme/` — `colors.ts`, `spacing.ts`, `radii.ts`, `typography.ts`, `index.ts`. Plain imports (no `useTheme()` hook — no dark mode in scope). All hex codes live here; feature code never inlines colors.
- `lib/imageUrl.ts` — `resolveImageUrl(raw)` rewrites loopback hosts (`localhost`, `127.0.0.1`, `0.0.0.0`, `::1`) in image URLs to the configured `EXPO_PUBLIC_API_BASE` host. Backend's `/recipes/upload-image` stores absolute URLs built from `request.base_url`, which on local docker is `http://localhost:8000/...` — on a real phone, `localhost` is the phone. This helper applies at every image render site (library cards, recipe detail hero, planner picker rows + chips, import preview). Cleaner long-term: backend stores relative URLs and clients prefix; for now the rewrite is mobile-only and doesn't touch web rendering.
- `features/library/Friend{Search,Library}Screen.tsx` — friend-library surface pushed onto `LibraryStackParamList`. Search header icon (`LibraryListScreen.tsx`) → `FriendSearch` (email input, `users.searchByEmail`) → `FriendLibrary` (list + `users.copyFriendRecipe` with already-copied detection on `catalog_source_recipe_id`). Profile toggle `Share my library` in `ProfileScreen.tsx` flips `users.is_library_public` via `useAuth().setLibraryVisibility`.
- `components/` — primitives: `Screen` (safe-area + optional KeyboardAvoidingView + ScrollView with `contentInsetAdjustmentBehavior="automatic"`), `Card`, `Button` (variants `primary | secondary | ghost | destructive`, fires `expo-haptics` selection feedback on primary press-in), `IconButton`, `EmptyState`, `TextField`, `ListRow`. Import from `@/src/components`.
- `navigation/` — `RootStack` swaps between `AuthStack` and `MainTabs` based on `useAuth().token`, with `ImportModal` as a sibling root screen (`presentation: "modal"`). `MainTabs` is a bottom-tab navigator (Library / Planner / Shopping / Profile); each tab owns a native-stack under `navigation/stacks/`. All `ParamList` types live in `navigation/types.ts` (single source of truth — no more `RootStackParamList` exported from `App.tsx`). The slug for the Profile tab is `ProfileTab` (avoids collision with the `Profile` screen inside the stack).
- `features/<area>/` — screens grouped by feature (`auth/`, `library/`, `planner/`, `shopping/`, `import/`, `profile/`). New feature work lands here, not in a flat `screens/` directory.
- `lib/` — `api.ts` (`buildClient` + `useApiClient` hook), `auth.tsx` (`AuthProvider` + `useAuth`; clears `ephemeral` storage on logout), `storage.ts`, `haptics.ts`, plus `config.ts` at `src/` root for `getApiBase()`.

`RootStack` shows a `<SplashGate />` (centered ActivityIndicator) while `useAuth().loading === true`, so cold launches don't flash the Login screen before the SecureStore-saved token resolves.

### Mobile storage conventions

`apps/mobile/src/lib/storage.ts` exposes two backends:

- `persistent` — wraps `@react-native-async-storage/async-storage`. **Mirrors web's `localStorage` keys verbatim** so shared helpers like `plannerFingerprintStorageKey()` from `@cooking/shared` work unchanged. Used for the planner-week fingerprint.
- `ephemeral` — in-memory `Map<string,string>` only. Mirrors web's `sessionStorage`: cleared on app kill, on logout, and on language change (Phase 4). Used for the smart shopping list cache + Weee product cache. **Always re-validate against the planner fingerprint on read** — the cache can be empty mid-session if the app was backgrounded long enough to be killed.

Both backends share the `json.get/set` helpers for typed JSON read/write. Don't reach for MMKV or Zustand — the persistent layer is small, performance is fine for the planner/shopping use cases, and divergent state-management patterns aren't worth it.

## Conventions

- **No `load_dotenv` in modules.** Only `app/main.py` calls it. Modules read settings via `app.core.config.settings`.
- **OpenAI client construction** is centralized in `app/core/llm.py::get_openai_client()` — don't re-implement the env-key check + `AsyncOpenAI(...)` constructor anywhere else.
- **Layering:** routers (`app/api/*`) stay thin; orchestration in `app/services/*` (real services like `shopping_service`, `storage_service`, `store_scraper` — no thin re-export shims); SQL in `app/db/repo_*.py`; general Pydantic models in `app/models.py`; the cohesive cooking-session contracts/state machine live in `app/cooking.py`; SQLAlchemy lives in `app/db/models.py`. Don’t import session/engine into services or models. Reusable Pydantic types shared by routers live in `app/api/_types.py`.
- **All recipe / meal-plan queries scope by `user_id`** (multi-tenant). Repos enforce this — never query `RecipeModel`/`MealPlanModel` directly without it.
- **Recipe IDs are app-generated strings** (`uuid.uuid4().hex` from extract or random UUID from copy); user IDs are real `UUID(as_uuid=True)`.
- **Frontend pages use plain CSS classes** from `apps/web/app/globals.css` (Material/Stitch-inspired palette + Material Symbols icons), not Tailwind. Some inline `style={{}}` objects are sprinkled in; Tailwind utility classes are **not** configured.
- **i18n:** all visible web strings go through `useT()` and `MESSAGE_MAP` from `@cooking/shared` (loaded from `packages/shared/src/messages/{en,zh}.json`). Two-language toggle (English/Chinese) lives in `lib/i18n.tsx`.
- **Hardcoded admin email** (`jerryxiang24@gmail.com`) is duplicated in `backend/app/core/admin.py::ADMIN_EMAIL` and `apps/web/app/lib/admin.ts::ADMIN_EMAIL`. Keep both in sync.
- **Mobile design system rule:** no raw hex codes outside `apps/mobile/src/theme/`. Feature code imports from `../../theme` (or however many `..`s); the linter check is `grep -rE "#[0-9a-fA-F]{6}" apps/mobile/src/{features,navigation,components}` returning hits only inside `theme/` (none everywhere else). Same goes for typography — use the `typography` presets, not ad-hoc `fontSize`/`fontWeight`.
- **Mobile typing:** all `ParamList`s live in `apps/mobile/src/navigation/types.ts`. Use `CompositeScreenProps` for screens that need to navigate across nested navigators (e.g. a Library tab screen pushing `ImportModal`, which is on the Root stack).

## Known cleanup targets (carry forward across sessions)

These are tracked here — not in commit messages — so each session can pick them up:

- `LEGACY_LIBRARY_CATEGORY_TO_TAG` and the dual `library_tags` / `library_category` columns: once we backfill all rows so `library_tags` is always populated, drop the `library_category` column + the legacy mapping + the `getRecipeTags` fallback branch.
- `apps/web/app/globals.css` is ~88 KB. Worth a sweep for orphaned selectors, but only after the next round of UI changes — not blind dead-CSS hunting.
- `cache_warmer_queries.py::ALL_QUERIES` (~200 entries) — audit against actual hit logs and prune entries no one searches for.
- `apps/web/.env.local` is committed to disk locally and contains `NEXT_PUBLIC_API_BASE=http://localhost:8000`. It is gitignored, so this is fine, but the `.env.local.example` should remain the source of truth for new clones.
- **EAS dev-build verification (deferred):** the SDK 52 → 54 upgrade was validated via `tsc --noEmit` + a successful Metro bundle compile, but `eas build --profile development --platform ios` was not run. Do that whenever you next have ~20 minutes to wait on a build, to confirm cloud builds still produce a working dev client.
- **`@react-navigation` v6 → v7 (deferred):** mobile is on `@react-navigation/native@^6.1.18`, `@react-navigation/native-stack@^6.11.0`, `@react-navigation/bottom-tabs@^6.6.1`. v7 is the current line; v6 still works on RN 0.81 + React 19 but won't get new features. Bump as a separate focused session — types tighten between v6 and v7 and most `ParamList` definitions need a sweep.
- **Smoke-test the mobile app on real hardware:** the SDK 54 upgrade unblocks Expo Go on a physical phone (App Store Expo Go is SDK 54-only). Before leaning on this for daily testing, run a full pass on a phone over LAN to confirm planner bottom-sheet animations, smart-list reorder, and image upload all work under the New Architecture (Reanimated v4). The simulator passed but the bottom-sheet is the highest-risk area under New Arch.
- **`@gorhom/bottom-sheet` was force-bumped 5.1.1 → 5.2.13** during the SDK 54 upgrade (auto-resolved during `expo install --fix`). Watch for animation regressions over a few days; if anything feels off in the planner picker, that's the place to look.
- **Remaining mobile i18n coverage:** mobile already has `apps/mobile/src/lib/i18n.tsx` with `I18nProvider` / `useT()`, persists `cooking-ui-language`, and exposes the English/Chinese toggle in Profile. Tutorial, navigation, and core account surfaces use the shared message catalog, but some legacy/development-only mobile strings remain hard-coded. Migrate those strings to `useT()` as their screens are touched.
- **EAS submit credentials:** `apps/mobile/eas.json::submit.production.ios` has `REPLACE_WITH_*` placeholders for `appleId`, `ascAppId`, and `appleTeamId`. Fill these in before the first `eas submit -p ios`.

## Updating this file

Update the affected sections **in the same change** when you:

- Add/rename/remove an HTTP route (update the API table)
- Change an env var or its semantics (update `.env.example` *and* the Deployment section if it affects prod)
- Change an ECS task definition env var, image tag, or hostname (Deployment section)
- Change Vercel project settings or the Vercel build env (Deployment section)
- Add a sessionStorage / localStorage key, or change one
- Add a new package under `packages/` or a new app under `apps/`
- Add a feature surface to the mobile app that didn't exist before — update the `apps/mobile` bullet's surface list and the Mobile structure / storage conventions sections accordingly
- Change `apps/mobile/eas.json` build profiles, bundle identifier, deep-link scheme, or the SDK version
- Change the mobile theme tokens (any file under `apps/mobile/src/theme/`) or add a new component primitive under `apps/mobile/src/components/`
- Add a `persistent` or `ephemeral` storage key in `apps/mobile/src/lib/storage.ts`
- Move LLM prompts/models, change cache TTL/version, or change scraper concurrency
- Add a recipe tag slug (three places noted above)
- Touch admin gating, catalog gating, or any other auth/authorization rule
- Resolve or add to the "Known cleanup targets" list
