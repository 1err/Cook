# RedNote cn short links

Base source: `d9e1cf4ea965c5d73b73ac73aea68aaf7bea9e66`.

## Change

Recognize exact `xhslink.cn` and `www.xhslink.cn` short-link hosts in backend parsing/fetch redirects and the shared web/mobile parser. Copied native share messages are supported. HTTP is upgraded to HTTPS, query tokens and the original short-link domain are retained, and existing path, credential, port, and redirect validation remain in force. The import preparation state uses the existing RedNote wait estimate for cn links.

## Verification

New regression tests failed before implementation for the missing cn host: shared parser 6, backend 7, web 3, mobile 2. After implementation:

- Shared: 420 passed; API client: 68 passed.
- Web: 885 passed.
- Mobile: 411 passed.
- Backend: 1,526 passed, 135 skipped, 2 dependency deprecation warnings. PostgreSQL/platform-dependent integrations were not exercised by this local run.
- `git diff --check`: passed.
- Web TypeScript: 34 pre-existing diagnostics, identical to an unchanged baseline check. Affected files: `CookWorkspace.test.tsx`, `FocusedCookingStep.navigation.test.tsx`, `library/page.test.tsx`, `settings/page.test.tsx`, and `shopping-list/plannedMeals.test.ts`. These concern Testing Library role options, a Vitest mock call, and a callback signature; no new diagnostics in this change.
- Node v25 reported existing `--localstorage-file` warnings in the web suite; the suite passed.

Anonymous live source fetch using the updated backend and the full provided Chinese share text returned `ok`, note `6aa28fc00000000028036045`, title `零失败的懒人教程｜苹果牛肋条`, 315 source-text characters, and an allowlisted public video URL. No user login/cookies, video download, paid AI request, or saved recipe was involved. This confirms source retrieval, not a newly generated recipe draft.

No deployment performed. No claim is made that App Store region determines which share-link domain RedNote uses.
