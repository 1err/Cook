# Video Import Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver reliable YouTube caption imports, no-key TikTok public-text imports, and a native iOS Share Sheet path into the existing recipe review flow.

**Architecture:** A new backend `video_import` module owns strict provider URL parsing and provider-specific text acquisition, while the existing recipe route remains the provider-neutral orchestration boundary. Web and mobile keep the same draft/review/save contract; mobile adds a small share-intent adapter that pre-fills the existing import modal.

**Tech Stack:** Python 3.12, FastAPI, `youtube-transcript-api==0.6.3`, TikTok oEmbed over Python stdlib HTTP, pytest; Next.js 14, React 18, Vitest, Playwright; Expo SDK 54, React Native 0.81, React Navigation 6, Jest/RNTL, `expo-share-intent@5.1.0`, `expo-linking`.

**Spec:** `docs/superpowers/specs/2026-08-28-video-import-reliability-design.md`

## Global Constraints

- Do not add a paid or key-gated video transcript provider in this iteration.
- Do not download YouTube or TikTok audiovisual media, run `yt-dlp`, or claim arbitrary TikTok speech transcription.
- Continue using the existing production `OPENAI_API_KEY` only for the recipe-structuring call already owned by `backend/app/extract.py`; no new key is introduced.
- Preserve cookie auth on web, bearer auth on mobile, the current Recipe response contract, and the existing import review UI.
- The iOS Share Sheet requires a native custom development or EAS build. Expo Go cannot contain the extension target.
- No Android share-target work is required in this iteration, although pasted TikTok/YouTube links must work on Android.
- New behavior must be developed test-first: write and run a focused failing test before changing production code.

---

### Task 1: Strict provider URL parsing

**Files:**
- Create: `backend/app/video_import.py`
- Create: `backend/tests/test_video_import.py`
- Modify: `backend/app/extract.py:44-59`

**Interfaces:**
- Produces: `VideoSource(provider: Literal["youtube", "tiktok"], original_url: str, canonical_url: str, external_id: str | None)`.
- Produces: `parse_video_source(raw_url: str) -> VideoSource` and `UnsupportedVideoUrl(ValueError)`.
- Preserves: `app.extract._parse_youtube_video_id(url: str) -> str | None` as a compatibility wrapper over `parse_video_source`.

- [ ] **Step 1: Write table-driven failing URL tests**

```python
@pytest.mark.parametrize(
    ("raw", "provider", "external_id", "canonical"),
    [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("https://youtu.be/dQw4w9WgXcQ?t=10", "youtube", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("https://m.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("https://www.tiktok.com/@chef/video/7412345678901234567?is_from_webapp=1", "tiktok", "7412345678901234567", "https://www.tiktok.com/@chef/video/7412345678901234567"),
        ("https://vm.tiktok.com/ZMexample/", "tiktok", None, "https://vm.tiktok.com/ZMexample/"),
    ],
)
def test_parse_video_source_accepts_supported_forms(raw, provider, external_id, canonical):
    source = parse_video_source(raw)
    assert (source.provider, source.external_id, source.canonical_url) == (provider, external_id, canonical)

@pytest.mark.parametrize("raw", [
    "", "not-a-url", "http://youtu.be/dQw4w9WgXcQ",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://user@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com:444/watch?v=dQw4w9WgXcQ",
    "https://www.tiktok.com/@chef/photo/7412345678901234567",
])
def test_parse_video_source_rejects_unsafe_or_unsupported_urls(raw):
    with pytest.raises(UnsupportedVideoUrl):
        parse_video_source(raw)
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_video_import.py -q`

Expected: collection fails because `app.video_import` does not exist.

- [ ] **Step 3: Implement the parser and compatibility wrapper**

```python
@dataclass(frozen=True, slots=True)
class VideoSource:
    provider: Literal["youtube", "tiktok"]
    original_url: str
    canonical_url: str
    external_id: str | None

class UnsupportedVideoUrl(ValueError):
    pass

def parse_video_source(raw_url: str) -> VideoSource:
    original = (raw_url or "").strip()
    parsed = urlsplit(original)
    try:
        port = parsed.port
    except ValueError as exc:
        raise UnsupportedVideoUrl("Paste a public YouTube or TikTok video link.") from exc
    if parsed.scheme != "https" or parsed.username or parsed.password or port not in (None, 443):
        raise UnsupportedVideoUrl("Paste a public YouTube or TikTok video link.")
    host = (parsed.hostname or "").lower().rstrip(".")
    youtube_id = _youtube_id(host, parsed.path, parse_qs(parsed.query))
    if youtube_id is not None:
        return VideoSource(
            provider="youtube",
            original_url=original,
            canonical_url=f"https://www.youtube.com/watch?v={youtube_id}",
            external_id=youtube_id,
        )
    tiktok_match = re.fullmatch(r"/@([^/]+)/video/(\d+)/?", parsed.path)
    if host in {"www.tiktok.com", "m.tiktok.com"} and tiktok_match:
        creator, post_id = tiktok_match.groups()
        return VideoSource(
            provider="tiktok",
            original_url=original,
            canonical_url=f"https://www.tiktok.com/@{creator}/video/{post_id}",
            external_id=post_id,
        )
    if (
        host in {"vm.tiktok.com", "vt.tiktok.com"}
        and re.fullmatch(r"/[A-Za-z0-9_-]+/?", parsed.path)
    ) or (
        host == "www.tiktok.com"
        and re.fullmatch(r"/t/[A-Za-z0-9_-]+/?", parsed.path)
    ):
        return VideoSource("tiktok", original, original, None)
    raise UnsupportedVideoUrl("Paste a public YouTube or TikTok video link.")
```

Replace `_parse_youtube_video_id` with a wrapper that catches `UnsupportedVideoUrl`, confirms `provider == "youtube"`, and returns `external_id`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `cd backend && .venv/bin/python -m pytest tests/test_video_import.py -q`

Expected: all URL parsing tests pass.

- [ ] **Step 5: Commit the parser**

```bash
git add backend/app/video_import.py backend/tests/test_video_import.py backend/app/extract.py
git commit -m "feat(import): classify supported video links"
```

### Task 2: YouTube transcript adapter compatible with the pinned library

**Files:**
- Modify: `backend/app/video_import.py`
- Modify: `backend/tests/test_video_import.py`
- Modify: `backend/app/extract.py:37-139`

**Interfaces:**
- Consumes: `VideoSource` from Task 1.
- Produces: `VideoTextResult(status, text, source, message, title, thumbnail_url)`.
- Produces: `fetch_youtube_text(source: VideoSource) -> VideoTextResult` (blocking; caller offloads it).
- Preserves: `TranscriptFetchResult` and `fetch_transcript_from_video_link` as compatibility exports delegating to the new adapter.

- [ ] **Step 1: Write failing adapter tests against a complete 0.6.3-shaped fake**

```python
def test_fetch_youtube_text_uses_063_list_transcripts_and_language_fallback(monkeypatch):
    calls = []
    class Track:
        language_code = "fr"
        def fetch(self):
            return [{"text": "Coupez les oignons."}, {"text": " Faites-les revenir. "}]
    class Tracks:
        def find_transcript(self, languages):
            calls.append(languages)
            raise NoTranscriptFound("id", languages, [])
        def __iter__(self):
            return iter([Track()])
    monkeypatch.setattr(video_import.YouTubeTranscriptApi, "list_transcripts", lambda video_id: Tracks())
    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))
    assert result.status == "ok"
    assert result.text == "Coupez les oignons. Faites-les revenir."
    assert calls == [["en", "zh", "zh-Hans", "zh-Hant"]]
```

Add one focused test each for `TranscriptsDisabled`, `VideoUnavailable`, truly missing tracks, empty snippets, and unexpected network failure. Assert status/message rather than mock call counts.

- [ ] **Step 2: Run the adapter tests and verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_video_import.py -q -k youtube`

Expected: failures because `fetch_youtube_text` and `VideoTextResult` do not exist.

- [ ] **Step 3: Implement 0.6.3-compatible transcript selection**

```python
@dataclass(frozen=True, slots=True)
class VideoTextResult:
    status: str
    text: str
    source: VideoSource
    message: str | None = None
    title: str | None = None
    thumbnail_url: str | None = None

def fetch_youtube_text(source: VideoSource) -> VideoTextResult:
    tracks = YouTubeTranscriptApi.list_transcripts(source.external_id or "")
    try:
        track = tracks.find_transcript(["en", "zh", "zh-Hans", "zh-Hant"])
    except NoTranscriptFound:
        track = next(iter(tracks), None)
        if track is None:
            return _failure(source, "no_transcript", "No usable transcript was found for this YouTube video. Paste a transcript instead.")
    snippets = track.fetch()
    text = " ".join(str(row.get("text", "")).strip() for row in snippets if isinstance(row, dict) and str(row.get("text", "")).strip())
    if not text:
        return _failure(source, "no_transcript", "No usable transcript was found for this YouTube video. Paste a transcript instead.")
    return VideoTextResult(
        status="ok", text=text, source=source,
        thumbnail_url=f"https://img.youtube.com/vi/{source.external_id}/hqdefault.jpg",
    )
```

Catch the library's documented exceptions separately and unexpected exceptions as `fetch_failed`. Keep logs to provider/ID/status/text length only.

- [ ] **Step 4: Keep compatibility imports working**

Move the old network implementation out of `extract.py`; import/re-export `VideoTextResult` as `TranscriptFetchResult` and wrap `fetch_transcript_from_video_link(url)` so any legacy caller receives the current `.transcript`, `.status`, `.message`, and `.video_id` shape.

- [ ] **Step 5: Run focused and extraction tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_video_import.py tests/test_extract_tutorial.py -q`

Expected: all pass, including the regression that would fail if `.fetch()` were called on `YouTubeTranscriptApi()`.

- [ ] **Step 6: Commit the adapter**

```bash
git add backend/app/video_import.py backend/tests/test_video_import.py backend/app/extract.py
git commit -m "fix(import): fetch YouTube captions with pinned API"
```

### Task 3: TikTok public-text acquisition and provider-neutral parse route

**Files:**
- Modify: `backend/app/video_import.py`
- Modify: `backend/tests/test_video_import.py`
- Modify: `backend/app/api/routes_recipes.py:17-125`
- Create: `backend/tests/test_video_import_routes.py`

**Interfaces:**
- Produces: `fetch_tiktok_text(source: VideoSource, *, opener=urlopen) -> VideoTextResult`.
- Produces: `async fetch_video_text(source: VideoSource) -> VideoTextResult`, implemented with `asyncio.to_thread`.
- Route contract remains `POST /recipes/parse/link -> Recipe`.

- [ ] **Step 1: Write failing TikTok oEmbed behavior tests**

```python
def test_fetch_tiktok_text_returns_public_caption_and_thumbnail():
    payload = {
        "version": "1.0", "provider_name": "TikTok", "type": "rich",
        "title": "Crispy chili noodles: noodles, garlic, soy sauce; toss for two minutes.",
        "author_name": "Chef Mei", "thumbnail_url": "https://p16.example/cover.jpeg",
        "html": "<script>must not be retained</script>",
    }
    result = fetch_tiktok_text(TIKTOK_SOURCE, opener=fake_json_response(payload))
    assert result.status == "ok"
    assert result.text == payload["title"]
    assert result.thumbnail_url == payload["thumbnail_url"]
    assert "html" not in result.text

def test_fetch_tiktok_text_rejects_attribution_only_title():
    result = fetch_tiktok_text(TIKTOK_SOURCE, opener=fake_json_response({
        "version": "1.0", "provider_name": "TikTok", "type": "rich",
        "title": "Chef Mei on TikTok", "author_name": "Chef Mei",
    }))
    assert result.status == "no_transcript"
```

Add invalid provider/JSON/thumbnail scheme, `HTTPError(404)`, `HTTPError(500)`, `URLError`, and timeout fixtures. Assert 404 becomes unavailable/422 semantics and 5xx/network becomes temporary/503 semantics.

- [ ] **Step 2: Run TikTok tests and verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_video_import.py -q -k tiktok`

Expected: failures because TikTok acquisition is missing.

- [ ] **Step 3: Implement bounded oEmbed acquisition**

```python
def fetch_tiktok_text(source: VideoSource, *, opener=urlopen) -> VideoTextResult:
    endpoint = "https://www.tiktok.com/oembed?" + urlencode({"url": source.original_url})
    request = Request(endpoint, headers={"User-Agent": "ChefWorld/1.0"})
    with opener(request, timeout=10) as response:
        raw = response.read(1_000_001)
    if len(raw) > 1_000_000:
        return _failure(source, "fetch_failed", "TikTok returned an invalid response. Please try again.")
    payload = json.loads(raw)
    if not isinstance(payload, dict) or payload.get("provider_name") != "TikTok":
        return _failure(source, "fetch_failed", "TikTok returned an invalid response. Please try again.")
    title = payload.get("title") if isinstance(payload.get("title"), str) else ""
    author = payload.get("author_name") if isinstance(payload.get("author_name"), str) else ""
    text = _meaningful_tiktok_text(title, author)
    if not text:
        return _failure(source, "no_transcript", "This TikTok does not expose enough recipe text. Paste its transcript instead.")
    thumbnail = _safe_https_url(payload.get("thumbnail_url"))
    return VideoTextResult("ok", text, source, title=title, thumbnail_url=thumbnail)

async def fetch_video_text(source: VideoSource) -> VideoTextResult:
    fetcher = fetch_youtube_text if source.provider == "youtube" else fetch_tiktok_text
    return await asyncio.to_thread(fetcher, source)
```

- [ ] **Step 4: Write failing route tests**

```python
@pytest.mark.asyncio
async def test_parse_link_uses_canonical_source_and_user_title(monkeypatch):
    source = VideoSource("tiktok", RAW_URL, CANONICAL_URL, POST_ID)
    monkeypatch.setattr(routes_recipes, "parse_video_source", lambda _: source)
    monkeypatch.setattr(routes_recipes, "fetch_video_text", AsyncMock(return_value=VideoTextResult(
        status="ok", text="2 eggs. Whisk and fry.", source=source,
        title="Creator caption", thumbnail_url="https://p16.example/cover.jpeg",
    )))
    monkeypatch.setattr(routes_recipes, "extract_recipe_from_text", AsyncMock(return_value=Recipe(
        id="draft", title="Extracted", ingredients=[{"name": "Eggs", "quantity": "2"}], steps=["Whisk and fry."],
    )))
    result = await routes_recipes.parse_from_link(ParseLinkBody(url=RAW_URL, title="My omelet"), _user=object())
    assert result.title == "My omelet"
    assert result.source_url == CANONICAL_URL
    assert result.thumbnail_url == "https://p16.example/cover.jpeg"
```

Add tests for unsupported URL -> 400, no text -> 422, temporary provider failure -> 503, and structurally empty TikTok draft -> 422. The last fixture must use the current stub placeholder ingredient to ensure it is rejected.

- [ ] **Step 5: Run route tests and verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_video_import_routes.py -q`

Expected: failures because the route still calls the old synchronous YouTube-only function.

- [ ] **Step 6: Implement provider-neutral route orchestration**

```python
try:
    source = parse_video_source(url)
except UnsupportedVideoUrl as exc:
    raise HTTPException(400, str(exc)) from exc

text_result = await fetch_video_text(source)
if text_result.status in {"fetch_failed", "dependency_missing"}:
    raise HTTPException(503, text_result.message or "Video import is temporarily unavailable.")
if text_result.status != "ok":
    raise HTTPException(422, text_result.message or "No usable recipe text was found.")

recipe = await extract_recipe_from_text(_append_import_notes(text_result.text, body.notes))
if source.provider == "tiktok" and not _has_meaningful_draft(recipe):
    raise HTTPException(422, "This TikTok does not expose enough recipe text. Paste its transcript instead.")
recipe = recipe.model_copy(update={
    "source_url": source.canonical_url,
    "thumbnail_url": recipe.thumbnail_url or text_result.thumbnail_url,
})
return _apply_import_overrides(recipe, body.title, body.library_tags)
```

`_has_meaningful_draft` returns true for at least one non-placeholder ingredient or one nonempty canonical step; it explicitly rejects the deterministic `Example ingredient` stub.

- [ ] **Step 7: Run backend import and full backend tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_video_import.py tests/test_video_import_routes.py -q`

Run: `cd backend && .venv/bin/python -m pytest -q`

Expected: all pass.

- [ ] **Step 8: Commit backend TikTok and route behavior**

```bash
git add backend/app/video_import.py backend/app/api/routes_recipes.py backend/tests/test_video_import.py backend/tests/test_video_import_routes.py
git commit -m "feat(import): parse TikTok public recipe text"
```

### Task 4: Provider-neutral web import UX

**Files:**
- Modify: `apps/web/app/import/ImportSourceStep.tsx`
- Modify: `apps/web/app/import/ImportSourceStep.test.tsx`
- Modify: `apps/web/app/import/page.tsx`
- Modify: `apps/web/e2e/import.spec.ts`

**Interfaces:**
- Keeps `ImportSourceValues` and `POST /recipes/parse/link` payload unchanged.
- Visible copy becomes `Video link` and `YouTube or TikTok URL`.

- [ ] **Step 1: Write failing unit tests for copy, control locking, and error clearing**

```tsx
it("accepts YouTube or TikTok links and locks every source control while parsing", async () => {
  render(<ImportSourceStep values={{ ...values, url: "https://vm.tiktok.com/ZMrecipe/" }} parsing error="retry" onChange={onChange} onSubmit={onSubmit} />);
  expect(screen.getByRole("tab", { name: "Video link" })).toBeDisabled();
  expect(screen.getByLabelText("YouTube or TikTok URL")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Optional details" })).toBeDisabled();
});

it("emits a source edit so the page can clear a prior error", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <ImportSourceStep
      values={values}
      parsing={false}
      error="old error"
      onChange={onChange}
      onSubmit={vi.fn()}
    />,
  );
  await user.type(screen.getByLabelText("YouTube or TikTok URL"), "https://youtu.be/dQw4w9WgXcQ");
  expect(onChange).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused web test and verify RED**

Run: `npm --workspace @cooking/web test -- ImportSourceStep.test.tsx`

Expected: copy and disabled-state assertions fail.

- [ ] **Step 3: Implement neutral copy and complete parsing lock**

Disable both tabs, the optional toggle, fieldset/tag buttons, and all source inputs when `parsing`. In `page.tsx`, wrap `setValues` as `handleValuesChange(next) { setValues(next); setError(null); }`.

- [ ] **Step 4: Add TikTok to Playwright's mocked review flow**

Change the fixture test to fill `https://www.tiktok.com/@chef/video/7412345678901234567`, assert the `/recipes/parse/link` body retains it, then complete the same review/save assertions. Keep a YouTube URL assertion in a second lightweight case so both providers remain covered.

- [ ] **Step 5: Run web unit, E2E import, and type checks**

Run: `npm --workspace @cooking/web test -- ImportSourceStep.test.tsx`

Run: `npm --workspace @cooking/web run test:e2e -- import.spec.ts`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Expected: all pass.

- [ ] **Step 6: Commit web UX**

```bash
git add apps/web/app/import/ImportSourceStep.tsx apps/web/app/import/ImportSourceStep.test.tsx apps/web/app/import/page.tsx apps/web/e2e/import.spec.ts
git commit -m "feat(import): accept video links on web"
```

### Task 5: Mobile pasted-link and prefilled-route import

**Files:**
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/features/import/ImportModalScreen.tsx`
- Modify: `apps/mobile/src/features/import/ImportModalScreen.test.tsx`
- Modify: `apps/mobile/src/features/import/LinkInputForm.tsx`
- Modify: `apps/mobile/src/features/import/LinkInputForm.test.tsx`
- Modify: `apps/mobile/src/features/import/ImportSourceTabs.tsx`

**Interfaces:**
- Changes `RootStackParamList["ImportModal"]` to `{ initialUrl?: string } | undefined`.
- `ImportModalScreen` consumes `route.params?.initialUrl` only when creating its reducer state.

- [ ] **Step 1: Write failing tests for neutral copy and route prefill**

```tsx
test("prefills a shared TikTok URL and previews it through the normal link flow", async () => {
  const nav = navigation();
  render(<ImportModalScreen navigation={nav.value as never} route={{ params: { initialUrl: "https://vm.tiktok.com/ZMrecipe/" } } as never} />);
  expect(screen.getByLabelText("YouTube or TikTok URL")).toHaveDisplayValue("https://vm.tiktok.com/ZMrecipe/");
  fireEvent.press(screen.getByRole("button", { name: "Preview recipe" }));
  await waitFor(() => expect(mockParseLink).toHaveBeenCalledWith(expect.objectContaining({ url: "https://vm.tiktok.com/ZMrecipe/" })));
});
```

Update existing tests to query `YouTube or TikTok URL`, and add a `LinkInputForm` assertion for the neutral label/placeholder.

- [ ] **Step 2: Run focused mobile tests and verify RED**

Run: `npm --workspace @cooking/mobile test -- ImportModalScreen.test.tsx LinkInputForm.test.tsx`

Expected: prefill and copy assertions fail.

- [ ] **Step 3: Implement lazy reducer initialization and copy**

```tsx
export function ImportModalScreen({ navigation, route }: Props) {
  const [state, dispatch] = useReducer(
    reducer,
    route.params?.initialUrl,
    (initialUrl): State => ({ ...initialState, mode: "link", url: initialUrl?.trim() ?? "" }),
  );
}
```

Keep the existing callbacks and render body after this initialization change.

Use `Video link` and `YouTube or TikTok URL`; change the blank error to `Paste a YouTube or TikTok URL first.`

- [ ] **Step 4: Run mobile tests and type checks**

Run: `npm --workspace @cooking/mobile test -- ImportModalScreen.test.tsx LinkInputForm.test.tsx`

Run: `npx tsc -p apps/mobile/tsconfig.json --noEmit`

Expected: all pass.

- [ ] **Step 5: Commit mobile route prefill**

```bash
git add apps/mobile/src/navigation/types.ts apps/mobile/src/features/import/ImportModalScreen.tsx apps/mobile/src/features/import/ImportModalScreen.test.tsx apps/mobile/src/features/import/LinkInputForm.tsx apps/mobile/src/features/import/LinkInputForm.test.tsx apps/mobile/src/features/import/ImportSourceTabs.tsx
git commit -m "feat(import): prefill shared video links"
```

### Task 6: Native iOS Share Sheet bridge

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `package-lock.json`
- Modify: `apps/mobile/app.json`
- Modify: `apps/mobile/App.tsx`
- Modify: `apps/mobile/src/navigation/RootStack.tsx`
- Create: `apps/mobile/src/features/import/sharedVideoUrl.ts`
- Create: `apps/mobile/src/features/import/sharedVideoUrl.test.ts`
- Modify: `apps/mobile/jest.setup.ts`
- Possibly create (only if required by `expo-share-intent@5.1.0` install): `patches/xcode+3.0.1.patch`

**Interfaces:**
- Produces: `extractSharedVideoUrl(webUrl: string | null | undefined, text: string | null | undefined) -> string | null`.
- Consumes: `ShareIntentProvider`, `useShareIntentContext()` with `hasShareIntent`, `shareIntent`, `resetShareIntent`.
- Navigates to `ImportModal({ initialUrl })` after auth restoration and navigation readiness.

- [ ] **Step 1: Write failing pure URL extraction tests**

```ts
it.each([
  ["https://youtu.be/dQw4w9WgXcQ", null, "https://youtu.be/dQw4w9WgXcQ"],
  [null, "Try this https://vm.tiktok.com/ZMrecipe/ from TikTok", "https://vm.tiktok.com/ZMrecipe/"],
  ["https://example.com/video", null, null],
  [null, "no link", null],
])("extracts only supported shared video URLs", (webUrl, text, expected) => {
  expect(extractSharedVideoUrl(webUrl, text)).toBe(expected);
});
```

- [ ] **Step 2: Run the helper test and verify RED**

Run: `npm --workspace @cooking/mobile test -- sharedVideoUrl.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement the pure helper**

Use a bounded URL regex only to find candidates, then `new URL(candidate)` and exact host allowlists for YouTube/TikTok. Strip trailing prose punctuation but preserve URL query strings.

- [ ] **Step 4: Install the SDK-54-compatible native dependency**

Run: `npm install --workspace @cooking/mobile expo-share-intent@5.1.0 expo-linking@~8.0.11`

If the installed package's own SDK-54 instructions require the Xcode patch, copy the exact upstream `xcode+3.0.1.patch` into repository `patches/`, install `patch-package`, and add the upstream-required root postinstall command. Do not invent a patch.

- [ ] **Step 5: Configure URL/text-only sharing**

Add to `apps/mobile/app.json`:

```json
[
  "expo-share-intent",
  {
    "iosActivationRules": {
      "NSExtensionActivationSupportsWebURLWithMaxCount": 1,
      "NSExtensionActivationSupportsWebPageWithMaxCount": 1,
      "NSExtensionActivationSupportsText": true
    },
    "iosShareExtensionName": "Import to Chef World",
    "iosAppGroupIdentifier": "group.com.chefworld.cooking.share",
    "disableAndroid": true
  }
]
```

- [ ] **Step 6: Write a failing navigation bridge test**

Mock `expo-share-intent` with a mutable context value. Render `RootStack` with mocked auth first `{ loading: true, token: null }`, then `{ loading: false, token: "token" }`. Assert no navigation while loading, then one `ImportModal` navigation with `initialUrl`, one reset, and no duplicate navigation after rerender.

- [ ] **Step 7: Implement provider and bridge**

Wrap the existing application providers in `<ShareIntentProvider>` at the top of `App.tsx`.

Inside `RootStack`, use `useNavigationContainerRef`, `onReady`, `useAuth`, and `useShareIntentContext`. The effect must require `!loading`, a token, a ready navigation container, `hasShareIntent`, and a supported extracted URL. It navigates once and then calls `resetShareIntent()`. Unsupported payloads are reset only after auth/navigation readiness so they do not loop forever.

- [ ] **Step 8: Add a Jest-native mock and run mobile verification**

Mock `ShareIntentProvider` as a fragment and `useShareIntentContext` as an empty intent by default in `jest.setup.ts`.

Run: `npm --workspace @cooking/mobile test -- sharedVideoUrl.test.ts ImportModalScreen.test.tsx`

Run: `npm run test:mobile`

Run: `npx tsc -p apps/mobile/tsconfig.json --noEmit`

Expected: all pass without loading native extension code.

- [ ] **Step 9: Verify Expo config generation without committing native folders**

Run: `cd apps/mobile && npx expo config --type prebuild`

Run in a temporary directory or clean generated state: `cd apps/mobile && npx expo prebuild --platform ios --no-install --clean`

Expected: exactly one share-extension target is declared and config generation succeeds. Do not commit generated `ios/` or `android/` directories.

- [ ] **Step 10: Commit the native bridge**

```bash
git add apps/mobile/package.json package-lock.json apps/mobile/app.json apps/mobile/App.tsx apps/mobile/src/navigation/RootStack.tsx apps/mobile/src/features/import/sharedVideoUrl.ts apps/mobile/src/features/import/sharedVideoUrl.test.ts apps/mobile/jest.setup.ts patches
git commit -m "feat(mobile): receive shared recipe video links"
```

### Task 7: Documentation and full verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Interfaces:**
- Documents current behavior only; introduces no runtime interface.

- [ ] **Step 1: Update authoritative documentation**

In `CLAUDE.md`, update Product summary, mobile surface list, deployment/EAS prerequisites, API `/recipes/parse/link` note, Import flow, commands, and mobile structure. State explicitly: YouTube uses caption tracks; TikTok uses public oEmbed text only; arbitrary TikTok speech needs a future provider; Share Sheet needs a custom build and Expo Go cannot test it.

In `README.md`, replace the YouTube-only limitations with a provider table and add the iOS Share Sheet custom-build command.

- [ ] **Step 2: Run format and static checks**

Run: `git diff --check`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Run: `npx tsc -p apps/mobile/tsconfig.json --noEmit`

Expected: no errors.

- [ ] **Step 3: Run all automated tests**

Run: `cd backend && .venv/bin/python -m pytest -q`

Run: `npm run test:web`

Run: `npm run test:mobile`

Run: `npm --workspace @cooking/web run test:e2e -- import.spec.ts`

Expected: all pass with no unexpected warnings.

- [ ] **Step 4: Run build/config verification**

Run: `npm --workspace @cooking/web run build`

Run: `cd apps/mobile && npx expo config --type prebuild`

Expected: Next production build and Expo prebuild config resolution succeed.

- [ ] **Step 5: Review the final diff for scope and secrets**

Run: `git status --short`

Run: `git diff --stat HEAD~1`

Inspect only the task files. Confirm no `.env`, generated `ios/` or `android/`, media, credentials, or unrelated user files are staged.

- [ ] **Step 6: Commit documentation and any final test-only corrections**

```bash
git add CLAUDE.md README.md
git commit -m "docs: explain video import capabilities"
```

## Manual Handoff Check

When a custom iOS development build is available:

1. Share a public YouTube cooking URL from Safari to “Import to Chef World.”
2. Confirm Chef World opens Import with the URL prefilled and reaches review.
3. Share a public TikTok cooking URL with a detailed post caption.
4. Confirm it reaches review if the caption contains recipe detail, otherwise shows the transcript fallback without losing the link.
5. Share an unrelated website and confirm normal app launch is not disrupted.
