# Chef World

Video-first recipe planner: import from a supported video link or pasted recipe text → review the draft → recipe library → meal plan → shopping list.

Chef World has a Next.js web app, an Expo/React Native mobile app, and a shared FastAPI/PostgreSQL backend. The repository preserves one set of shared domain types, cooking-session rules, translations, and retailer handoff helpers across both clients.

For engineering review, start with the [architecture](docs/architecture.md), [data inventory](docs/data-inventory.md), and [September 2026 engineering review](docs/engineering-review-2026-09-14.md). These document the implementation, verification evidence, and remaining App Store and production release work. For the current scalability branch, also read the [capacity operating runbook](docs/capacity-operations.md) and [local workload harness](docs/qa/2026-09-18-capacity-harness.md); local test results do not establish production capacity.

Shopping now includes **Shop on Instacart** alongside the existing Weee experience on web and iOS. It exports ingredients to an Instacart review page; a backend developer key is required for real shopping links. See the [Instacart setup guide](docs/qa/2026-09-14-instacart-setup.md).

**Make a menu** turns selected recipes, or the whole private library, into a restaurant-style menu. Choose one of six styles, edit dish names and sections, and optionally generate decorative AI artwork. Non-admins can start one new menu per UTC day; admins are exempt. Editing and exporting the current menu do not count again. Menu edits are separate from saved recipes. Drafts last for the current editing session; web exports PNG pages or Print/PDF, and mobile shares a PDF. See the [menu implementation and verification notes](docs/qa/2026-09-25-library-menu-maker.md).

## Setup

### Backend (FastAPI)

**Python 3.11, 3.12, or 3.13 required.** Python 3.14 is not yet supported (pydantic-core’s Rust bindings don’t support it).

If `python3.12` (or 3.11 / 3.13) is not installed, install it with Homebrew then create the venv:

```bash
# Install Python 3.12 (one-time)
brew install python@3.12

# Backend setup
cd backend
/opt/homebrew/opt/python@3.12/bin/python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

On Intel Macs, Homebrew’s Python is often under `/usr/local/opt/python@3.12/bin/python3.12`. If in doubt, run `brew --prefix python@3.12` to get the base path, then use `$(brew --prefix python@3.12)/bin/python3.12 -m venv .venv`.

If you already have 3.11/3.12/3.13 on your PATH:

```bash
cd backend
python3.12 -m venv .venv   # or python3.11 / python3.13
source .venv/bin/activate
pip install -r requirements.txt
```

If you use [pyenv](https://github.com/pyenv/pyenv), run `pyenv install 3.12` (if needed), then `cd backend` and pyenv will use the version in `.python-version`.

Copy `.env.example` to `.env`. Set `DATABASE_URL` for your local PostgreSQL instance, replace `AUTH_SECRET` with a random value, and optionally configure the server-only `OPENAI_API_KEY` for import:

```bash
cp .env.example .env
# Edit DATABASE_URL, AUTH_SECRET and optional provider settings locally.
```

Start PostgreSQL first (for the included local database, run `docker compose up -d postgres` from the repository root). Then apply migrations and run the API from `backend/`:

```bash
python -m app.migrate
python run.py
```

API: http://localhost:8000. Docs: http://localhost:8000/docs.

### Google sign-in setup (web)

The login and registration pages show Google's official button after the API has a Google Web client ID. Existing email/password accounts enter their Chef World password once to connect Google and keep their existing library. New Google users do not need a Chef World password. Google-only users can verify with Google to delete their account in web Settings.

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) and select or create the Chef World project.
2. Complete **Branding** with app name `Chef World`, a support/contact email you control, homepage `https://chef-world.com`, privacy URL `https://chef-world.com/privacy`, terms URL `https://chef-world.com/terms`, and authorized domain `chef-world.com`. Choose **External** under Audience for public users. While the app is in Testing, add your test accounts as test users.
3. Under **Clients**, create a **Web application** named `Chef World Web`. Add authorized JavaScript origins `https://chef-world.com`, `https://www.chef-world.com`, and `http://localhost:3000` (and `http://127.0.0.1:3000` if used). Use exact origins without paths. Only add preview origins you intend to support, and also allow them in backend CORS. This popup ID-token flow needs no redirect URI or client secret.
4. Set `GOOGLE_CLIENT_ID=<your-web-client-id>.apps.googleusercontent.com` in `backend/.env` locally and in the deployed backend's environment when releasing. Restart/redeploy the backend and release the updated web app. The frontend reads this public ID from the API; no frontend build variable is required. Keep `CORS_ALLOW_ORIGINS` aligned with the authorized app origins and retain secure production cookie settings.
5. Test a new Google account, sign out/sign back in, connect an existing password account, verify its recipes remain, and test Google-only deletion using a disposable account. Move the Google app to Production under Audience before enabling public access. Google may require domain ownership or branding verification; complete any requirements shown in its console.

Only identity is requested; this does not request Gmail, Drive, or Calendar access. Without `GOOGLE_CLIENT_ID`, Google sign-in stays hidden and password login remains available. This implementation is local until deliberately deployed. See [Google's setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

### Web App (Next.js)

Use Node 22 (at least 22.9) and npm 11.19.1. The package-manager version is enforced because older npm versions did not consistently apply the security overrides across workspaces. The install command below uses the pinned version without changing your global npm.

```bash
# From the repository root (npm workspaces):
npx --yes npm@11.19.1 ci
npm run tokens:build
npm run web:dev
```

App: http://localhost:3000.

**API base (for desktop, phone, or deployed):** The web app calls the backend using `NEXT_PUBLIC_API_BASE`. Copy `apps/web/.env.local.example` to `apps/web/.env.local` and set:

- **Desktop (same machine):** Optional — if unset, the app defaults to `http://localhost:8000` (see `apps/web/app/config.ts`).
- **Phone on same Wi‑Fi:** Set `NEXT_PUBLIC_API_BASE=http://192.168.1.XX:8000` (your machine’s LAN IP).
- **Docker Compose (browser on host):** Compose sets `NEXT_PUBLIC_API_BASE=http://localhost:8000` so the **browser** reaches the API on the host.

For the authoritative architecture, API table, deployment notes, and codebase conventions, see **[CLAUDE.md](CLAUDE.md)**.

## Flow

1. **Import** (`/import`): Supported YouTube or RedNote link, or pasted recipe text/transcript, with optional title + tag overrides → server-side AI extraction → draft review → explicit save. Extraction requires a configured API key.
2. **Library** (`/library`, `/library/[id]`): Browse, edit, delete, upload thumbnails (local disk or S3), and copy public or intentionally shared friend recipes.
3. **Planner** (`/planner`): Weekly meal plan; desktop drag recipes into breakfast / lunch / dinner, while phones use slot-based pickers; tied to `?week=` (Monday).
4. **Cook** (`/cook`): Coordinate multiple dishes with ordered steps, passive timers, device synchronization and offline step replay.
5. **Shopping list** (`/shopping-list`): Review planned ingredients, optionally prepare an AI-refined list, select Weee products or export selected ingredients to Instacart. Smart mode preserves its snapshot until refresh and warns when the planner changes.

## Video import support

Public YouTube and RedNote links enter a durable import job and produce an editable recipe draft. Nothing is added to the recipe library until the user saves it.

| Provider | Content used | Availability |
|----------|--------------|--------------|
| YouTube | Public captions and descriptions; configured Gemini video analysis when captions are insufficient | Public videos; blocked or unavailable videos can be uploaded or supplied as recipe text. |
| RedNote (小红书) | Public note description and video retrieved with an anonymous browser-compatible client | Paste a link or full copied share text, including HTTP `xhslink.com` short links. Token-bearing public destinations inside trusted login redirects are retried once. Genuine sign-in requirements remain a fallback. |

- **Supported links:** YouTube and RedNote only. TikTok and Douyin are currently unavailable.
- **Public video preparation:** RedNote CDN downloads are allowlisted, bounded to 150 MiB, and held in temporary files. Videos above the 30 MiB analysis limit are compressed locally with ffmpeg, up to ten minutes and 4K input. Prepared video stays within 30 MiB. The queued RedNote operation has a bounded seven-minute deadline and retains account/global admission and dollar limits. Uploads retain their 30 MiB limit.
- **Retrieval cost:** No paid third-party downloader, platform login, personal cookies, or proxy subscription. AI analysis uses the existing configured providers and quotas.
- **Env:** Create a `backend/.env` file (see `.env.example`). Configure a server-only `OPENAI_API_KEY`, dated model prices, and explicit account/app AI monetary allowances within the combined operating budget for recipe extraction; the default AI monetary allowance is zero. Without a key, import reports that AI is unavailable. Shopping refinement and tutorial timing can use conservative local fallbacks. Never put a provider key in web/mobile public environment variables.
- **Fallback:** When caption retrieval is blocked, YouTube import tries retained player metadata, the public watch page, bounded requests to YouTube player hosts, and finally an anonymous Jina Reader request for the canonical video description. This last fallback depends on a third-party public-page service and can be rate-limited. If extraction finds ingredients but no usable method, the model makes one constrained step-recovery attempt using only the extracted dish and ingredients. If no usable steps remain, the link import returns a clear request for a pasted transcript instead of an empty tutorial. Manual URL entry remains the Share Sheet fallback and the supported Android path.

### iOS Share Sheet

The mobile app can receive public YouTube/RedNote URLs through “Import to Chef World,” but the share extension is native code. Expo Go cannot contain or test it. Build a custom iOS development client, then run Metro in dev-client mode:

```bash
cd apps/mobile
eas build --profile development --platform ios
npx expo start --dev-client
```

The current `development` EAS profile targets the iOS simulator; use the internal `preview` profile or an appropriately configured development-device profile for physical-device testing. Manual pasted-link import still works without the Share Sheet and remains the Android route.

## TODOs (integrations)

- Revisit TikTok and Douyin retrieval when a dependable provider is available.
