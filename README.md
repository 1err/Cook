# Cooking Recipe Planner

Video-first recipe planner: import from a supported video link or pasted recipe text → review the draft → recipe library → meal plan → shopping list.

## Setup

### Backend (FastAPI)

**Python 3.11, 3.12, or 3.13 required.** Python 3.14 is not yet supported (pydantic-core’s Rust bindings don’t support it).

If `python3.12` (or 3.11 / 3.13) is not installed, install it with Homebrew then create the venv:

```bash
# Install Python 3.12 (one-time)
brew install python@3.12

# Backend setup
cd backend
rm -rf .venv
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

Copy `.env.example` to `.env` and set your API key (see [Video import support](#video-import-support) and env vars below):

```bash
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=sk-...
```

Run:

```bash
python run.py
```

API: http://localhost:8000. Docs: http://localhost:8000/docs.

### Web App (Next.js)

```bash
cd apps/web
npm install
npm run dev
```

App: http://localhost:3000.

**API base (for desktop, phone, or deployed):** The web app calls the backend using `NEXT_PUBLIC_API_BASE`. Copy `apps/web/.env.local.example` to `apps/web/.env.local` and set:

- **Desktop (same machine):** Optional — if unset, the app defaults to `http://localhost:8000` (see `apps/web/app/config.ts`).
- **Phone on same Wi‑Fi:** Set `NEXT_PUBLIC_API_BASE=http://192.168.1.XX:8000` (your machine’s LAN IP).
- **Docker Compose (browser on host):** Compose sets `NEXT_PUBLIC_API_BASE=http://localhost:8000` so the **browser** reaches the API on the host.

For the authoritative architecture, API table, deployment notes, and codebase conventions, see **[CLAUDE.md](CLAUDE.md)**.

## Flow

1. **Import** (`/import`): Supported YouTube or TikTok link, or pasted recipe text/transcript, with optional title + tag overrides → extraction (LLM if `OPENAI_API_KEY` is set) → draft review → explicit save.
2. **Library** (`/library`, `/library/[id]`): Browse, edit, delete, optional thumbnail upload (local disk or S3), and copy curated recipes from the shared public library.
3. **Planner** (`/planner`): Weekly meal plan; desktop drag recipes into breakfast / lunch / dinner, while phones use slot-based pickers; tied to `?week=` (Monday).
4. **Shopping list** (`/shopping-list`): Confirms the week and planned meals, then **Prepare smart shopping list** (LLM refine on demand). Smart mode keeps its generated snapshot until the user refreshes, and warns when the planner changed later.

## Video import support

Video-link import does not download audiovisual media. It sends provider-exposed text through the existing recipe extraction and review flow.

| Provider | Text used | Current limitations |
|----------|-----------|---------------------|
| YouTube | Public caption tracks from [`youtube-transcript-api`](https://github.com/jdepoix/youtube-transcript-api), preferring English or Chinese and falling back to another available track; verified public title/description text is used when cloud-IP blocking prevents caption access | Description fallback can be less detailed than captions. Private, age-restricted, region-locked, or unavailable videos may still fail. The final no-key Reader fallback is rate-limited and depends on a third-party public-page service. |
| TikTok | Public post title/caption returned by TikTok's oEmbed endpoint | This does **not** transcribe the video's speech. Sparse, attribution-only, private, or unavailable posts may not contain enough recipe detail. Arbitrary TikTok speech transcription needs a future provider. |

- **Supported links:** Use public HTTPS YouTube or TikTok video URLs. RedNote and uploaded video files are not supported.
- **Env:** Create a `backend/.env` file (see `.env.example`). Set `OPENAI_API_KEY=sk-...` for real recipe extraction; without it, the app still runs and uses stub extraction.
- **Fallback:** When caption retrieval is blocked, YouTube import uses retained player metadata, the public watch page, then bounded keyless requests to YouTube's player hosts. If those are blocked too, it asks Jina Reader's anonymous public endpoint for only the canonical video's bounded description section. No API key or paid transcript service is required; Jina currently limits anonymous use to 20 requests per minute. When provider text is still unavailable or too sparse, paste the recipe or transcript manually. Manual URL entry remains the Share Sheet fallback and the supported Android path.

### iOS Share Sheet

The mobile app can receive public YouTube/TikTok URLs through “Import to Chef World,” but the share extension is native code. Expo Go cannot contain or test it. Build a custom iOS development client, then run Metro in dev-client mode:

```bash
cd apps/mobile
eas build --profile development --platform ios
npx expo start --dev-client
```

The current `development` EAS profile targets the iOS simulator; use the internal `preview` profile or an appropriately configured development-device profile for physical-device testing. Manual pasted-link import still works without the Share Sheet and remains the Android route.

## TODOs (integrations)

- Arbitrary TikTok speech transcription via a future provider; current TikTok import uses public oEmbed title/caption text only.
- RedNote link import.
- Transcript from upload: Whisper (or similar) on uploaded video.
- Optional OCR on frames that show ingredient lists.
