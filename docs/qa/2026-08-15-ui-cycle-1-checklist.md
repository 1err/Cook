# UI Cycle 1 iOS simulator verification

This record is intentionally evidence-first. Check an item only after observing it on the named simulator and language. Store screenshots under `docs/qa/artifacts/ui-cycle-1/`; do not capture or record real account credentials or tokens.

## Run 1 — iPhone SE, English

- Simulator OS: iOS 26.4 (26.4.1, build 23E254a)
- Commit SHA: `f11db0a`
- Reviewer: Codex
- Date: 2026-08-15
- Screenshot paths: `docs/qa/artifacts/ui-cycle-1/iphone-se-login-en.png`

- [ ] Exactly three tabs are visible: Library, Planner, Shopping.
- [ ] The global plus and account avatar controls each have a 44-point target.
- [ ] Add Recipe opens and Cancel returns to the originating screen.
- [ ] Account opens without adding a fourth tab.
- [ ] English selection updates tab and header copy.
- [ ] Layout remains usable at Accessibility Large Dynamic Type.
- [ ] VoiceOver announces useful labels in logical order.
- [ ] Reduce Motion preserves navigation and control behavior.
- [ ] Light appearance uses the warm editorial palette without gradients or glass.
- [ ] Library content loads.
- [ ] Planner content loads.
- [ ] Shopping content loads.

## Run 2 — iPhone SE, Chinese

- Simulator OS: iOS 26.4 (26.4.1, build 23E254a)
- Commit SHA: `f11db0a`
- Reviewer: Codex
- Date: 2026-08-15
- Screenshot paths: None; authenticated Chinese state was not reachable without credentials.

- [ ] Exactly three tabs are visible: Library, Planner, Shopping.
- [ ] The global plus and account avatar controls each have a 44-point target.
- [ ] Add Recipe opens and Cancel returns to the originating screen.
- [ ] Account opens without adding a fourth tab.
- [ ] Chinese selection updates tab and header copy.
- [ ] Layout remains usable at Accessibility Large Dynamic Type.
- [ ] VoiceOver announces useful labels in logical order.
- [ ] Reduce Motion preserves navigation and control behavior.
- [ ] Light appearance uses the warm editorial palette without gradients or glass.
- [ ] Library content loads.
- [ ] Planner content loads.
- [ ] Shopping content loads.

## Run 3 — iPhone 16 Pro, English

- Simulator OS: iOS 26.4 (26.4.1, build 23E254a)
- Commit SHA: `f11db0a`
- Reviewer: Codex
- Date: 2026-08-15
- Screenshot paths: `docs/qa/artifacts/ui-cycle-1/iphone-16-pro-login-en.png`

- [ ] Exactly three tabs are visible: Library, Planner, Shopping.
- [ ] The global plus and account avatar controls each have a 44-point target.
- [ ] Add Recipe opens and Cancel returns to the originating screen.
- [ ] Account opens without adding a fourth tab.
- [ ] English selection updates tab and header copy.
- [ ] Layout remains usable at Accessibility Large Dynamic Type.
- [ ] VoiceOver announces useful labels in logical order.
- [ ] Reduce Motion preserves navigation and control behavior.
- [ ] Light appearance uses the warm editorial palette without gradients or glass.
- [ ] Library content loads.
- [ ] Planner content loads.
- [ ] Shopping content loads.

## Run 4 — iPhone 16 Pro, Chinese

- Simulator OS: iOS 26.4 (26.4.1, build 23E254a)
- Commit SHA: `f11db0a`
- Reviewer: Codex
- Date: 2026-08-15
- Screenshot paths: None; authenticated Chinese state was not reachable without credentials.

- [ ] Exactly three tabs are visible: Library, Planner, Shopping.
- [ ] The global plus and account avatar controls each have a 44-point target.
- [ ] Add Recipe opens and Cancel returns to the originating screen.
- [ ] Account opens without adding a fourth tab.
- [ ] Chinese selection updates tab and header copy.
- [ ] Layout remains usable at Accessibility Large Dynamic Type.
- [ ] VoiceOver announces useful labels in logical order.
- [ ] Reduce Motion preserves navigation and control behavior.
- [ ] Light appearance uses the warm editorial palette without gradients or glass.
- [ ] Library content loads.
- [ ] Planner content loads.
- [ ] Shopping content loads.

## Evidence notes and blockers

- The installed runtime did not initially contain the requested profiles. Created `Chef World iPhone SE` (`B731E073-6EEA-4485-9691-4B6342D621ED`) and `Chef World iPhone 16 Pro` (`435A9C78-2C30-4A3D-9E89-1FE46B3B5493`) on iOS 26.4.
- The sandboxed `npm run mobile:ios` attempt could not bind a port and ended with `RangeError [ERR_SOCKET_BAD_PORT]` after reaching port `65536`.
- The approved retry started Metro but auto-selected an unrelated iPhone 17. Its recommended Expo Go 54.0.7 download remained at 1% while the displayed ETA grew past 3,600 seconds, so it was canceled without further download retries.
- Expo CLI in this workspace rejects `--offline --localhost` as mutually exclusive. The supported `expo start --offline` mode was used, and each exact target received one explicit `simctl openurl exp://127.0.0.1:8081` launch attempt.
- Both exact targets ran the locally installed Expo Go 54.0.6 bundle and rendered the English Chef World login screen. Metro bundled successfully but reported `Offline and no cached development certificate found, unable to sign manifest` and the existing `src/lib/auth.tsx -> src/lib/api.ts -> src/lib/auth.tsx` require-cycle warning.
- Visual inspection confirmed the login views use the warm light palette and contain only synthetic placeholders (`you@example.com`, `Your password`); no real credentials, account data, or tokens were entered or captured.
- The requested checklist exercises authenticated shell and feature flows. Without an authorized synthetic native session or backend fixture, exactly-three-tabs, plus/avatar sizing, Add Recipe cancellation, account routing, bilingual tab/header copy, Dynamic Type, VoiceOver, Reduce Motion, and feature-content loading could not be observed. Every affected row therefore remains unchecked.
