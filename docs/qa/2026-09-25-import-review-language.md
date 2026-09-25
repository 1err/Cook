# Import review and Chinese script follow-up

Status: locally verified; not deployed. Production remains the recipe-editor release recorded in `CLAUDE.md`.

## Behavior

- Web and mobile hide generic action, grounding, completeness, repair, and timestamp diagnostics through one shared presentation helper. Raw diagnostics and backend quality checks remain intact.
- Useful missing-method, amount, temperature, and source-access notices remain visible, including specific notices prefixed by an audit label. Web omits the entire Details to check disclosure when the filtered list is empty.
- New Chinese text, caption, video, and media imports use Simplified Chinese display text. OpenCC 1.4.2 performs offline conversion after grounding and before local timing estimates, backed by explicit extraction/audit prompt instructions.
- Original source excerpts/raw text, timestamps, IDs, URLs, numerical timing, and user title overrides are preserved. Temporary script-equivalent comparison text prevents Traditional source evidence from incorrectly invalidating Simplified steps or stated timers.
- Japanese/Korean prose protects its recipe from conversion; individual kana/Hangul fields remain unchanged within Chinese recipes. Han-only text is inherently language-ambiguous; this is a bounded script heuristic, not general language detection.
- Saved/manual recipes are not rewritten. No extra provider request, schema change, or migration.

## Verification

- Web suite: 591 passed; shared: 103 passed; API client: 36 passed.
- After review narrowed checker-prefix filtering, affected shared and web suites passed again: 30 and 25 tests.
- Native import screen: 17 passed; web and mobile TypeScript checks passed. Native tests used existing dependencies with a temporary test-only React resolution mapper; no dependency or lockfile changes.
- Backend focused integration/regression suites: 211 passed. Includes all four import source modes, audit failure, source fallback titles, script-equivalent stated timing, Japanese/Korean preservation, and rejection of invented quotes, quantities, actions, and ingredient substitutions.
- Next.js build passed. Browser review used a clearly labeled local sample API: all four requested diagnostic examples were absent, Your draft is ready remained, Details to check was absent, and no browser errors were captured.
- OpenCC macOS arm64 Python 3.12 conversion and dependency check passed. Offline Linux amd64 Python 3.12 runtime passed five conversion/preservation checks using the pinned wheel. The initial test's noexec temporary mount was corrected before successful native loading.

These are local deterministic tests and a fixture-based UI check, not a fresh authenticated production/video-provider extraction. No deployment was performed.
