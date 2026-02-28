# Cooking Recipe Planner

Video-first recipe planner: import from video link or transcript → recipe library → (later) meal plan → shopping list.

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

Copy `.env.example` to `.env` and set your API key (see [YouTube Transcript Support](#youtube-transcript-support) and env vars below):

```bash
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=sk-...
```

Run:

```bash
python run.py
```

API: http://localhost:8000. Docs: http://localhost:8000/docs.

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

App: http://localhost:3000.

**API base (for desktop, phone, or deployed):** The frontend calls the backend using `NEXT_PUBLIC_API_BASE`. Copy `frontend/.env.local.example` to `frontend/.env.local` and set:

- **Desktop (same machine):** `NEXT_PUBLIC_API_BASE=http://localhost:8000`
- **Phone on same Wi‑Fi:** Use your computer’s local IP, e.g. `NEXT_PUBLIC_API_BASE=http://192.168.1.XX:8000`
- **Deployed (same origin):** Leave empty or omit so the app uses relative URLs.

If unset, the app uses same-origin requests (works when frontend and API are served from the same host).

## Flow

1. **Import** (http://localhost:3000/import): Paste a video link or paste transcript text → backend extracts dish name + ingredients (stubbed or LLM) → recipe is saved.
2. **Library** (http://localhost:3000/library): View all saved recipes and their ingredients.

Meal planner and shopping list are not built yet (per MVP scope).

## YouTube Transcript Support

YouTube links are supported **without** Google Cloud or OAuth. The backend uses the [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api) Python library to fetch captions.

- **How it works:** When you import by link, the backend parses the YouTube video ID, requests the caption track (preferring English or Chinese if available), and sends the combined transcript into the existing LLM extraction pipeline.
- **Limitations:** Only YouTube is supported (TikTok/RedNote are not). Captions must exist and be available; some videos have captions disabled or region-locked. No authentication, so private or age-restricted videos will not work.
- **Env:** Create a `backend/.env` file (see `.env.example`). Set `OPENAI_API_KEY=sk-...` for real recipe extraction; without it, the app still runs and uses stub extraction.
- **Testing:** Paste a public YouTube cooking video URL (e.g. `https://www.youtube.com/watch?v=...`) on the Import page and click “Import recipe”. Check the backend terminal for log lines: “Fetching transcript for video_id=…”, “Transcript fetched successfully…”, or “Captions disabled / Video unavailable” if something fails.
- **When captions are unavailable:** The backend returns an empty transcript; the extraction step still runs (LLM gets placeholder text or stub recipe), so the flow does not break—you just get a generic or stub recipe. You can always use “Paste transcript” to paste captions manually.

## TODOs (integrations)

- Transcript from video link: YouTube done via youtube-transcript-api; TikTok / RedNote not yet.
- Transcript from upload: Whisper (or similar) on uploaded video.
- Optional OCR on frames that show ingredient lists.
