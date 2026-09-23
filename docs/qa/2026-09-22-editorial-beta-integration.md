# Editorial and beta integration evidence

**Status:** the combined frontend is locally verified at application commit
`72c0c9459d6719567fe8c26c3df919ec4ebe95c0`. No additional application edits were
needed after the final source comparison. Production deployment remains blocked
by fresh-image dependency download failures and pending cloud-resource approval;
see the [release handoff](2026-09-22-beta-editorial-release.md) and
[web image attempt](2026-09-22-web-image-attempt.md).

## Source identity and final comparison

- Beta base: `fcd133398230cc8c6989bb6b5a06b319a281de56`, including the `b3e7ef8`
  scalability prerequisites.
- Public-site/frontend baseline: `3c87f7b9193efa5a5dad35e94f9c50772d393577`.
  The supplied original editorial file hashes matched this baseline.
- Editorial source: `.worktrees/editorial-ui-20260922`. This is a dirty preview
  checkout whose Git HEAD is `015e1b655e95506399d72aebb9e3a754187207cd`; that HEAD
  alone does **not** identify the design being integrated. Fixed file snapshots
  and three-way comparisons identify the actual source content.
- Release checkout: `.worktrees/beta-editorial-release-20260922`, branch
  `codex/beta-editorial-release-20260922`. The original checkout and editorial
  source were read only during integration.

The final comparison considered 384 paths and checked 352 web/native source
paths after excluding generated screenshots/results and dependency directories.
It included additions and deletions. Relative to fixed snapshot v3, only
`apps/web/app/cook/CookScreen.tsx` and `apps/web/app/layout.tsx` had changed.
Both changes were already represented in the release: the cooking error uses
a local SVG and the external icon stylesheet is removed. There were no missing
material UI changes or source deletions. The release intentionally keeps the
32px error SVG inside the existing circular container; the preview places its
SVG directly on that container.

Local audit artifacts:

- `/private/tmp/chef-world-editorial-integration-20260922-v3/manifest.json`
  identifies the merged design snapshot; SHA-256:
  `e25e5827d85ebfc0e129fe51f169c66a9788f37f2f57d489dbaab0b7018f5adb`.
- `/private/tmp/chef-world-editorial-integration-20260922-finalcheck/manifest.json`
  records the final per-file comparison and captures the two later source files.
  The sorted source-content map SHA-256 is
  `f156b1b1b4f42ec842d2f19f6a78bc509c4e536d67136692bd8b8d80fa9e5382`.
- `/private/tmp/chef-world-editorial-integration-20260922-v3/release-web-manifest.json`
  records release hashes and verification logs. These are local audit files,
  not deployed resources.

## Captured design and intentional beta overrides

The release includes the warm editorial typography and photography, four compact
desktop library columns with left-to-right ordering and natural photo proportions,
responsive planner day cards and recipe rail, reorganized recipe editor,
step illustrations, and matching native styling. Visible Instacart controls are
removed on both clients; dormant provider helpers remain. Display fonts, icons,
and the sign-in hero are served locally.

The following differences from the visual preview are intentional:

| Area | Preserved beta behavior |
| --- | --- |
| Import and empty library | Manual creation uses the existing editor/save flow without a parser call. Required draft fields, stale-save guards, and account-scoped remounts remain. English/Chinese copy includes manual creation. |
| Library and recipe cards | Independent lazy personal/catalog pagination, retry controls, successful content on failure, search/filter requests, server `already_saved` state and copy-race guards remain. Cards accept summary records. Native pagination stays alongside the two-column styling. |
| Planner and cooking | Paginated recipe sources and bounded detail loading remain. Planner writes retain expected revisions, ordered mutations and conflict recovery; the redesigned controls use the same contracts. |
| Accounts and settings | Recovery/auth routes remain public without the app header. Session-generation isolation, capabilities, verification, server logout, logout everywhere, password-confirmed deletion and support/privacy actions remain. Account controls retain the additional layout they need. |
| Groceries and retailer choices | Basic check/copy on web and check/share on native work without AI. Preview errors, retry controls, week isolation, optional refinement, bounded product batches and explicit cart-confirmation semantics remain inside the new layout. |
| Verification fixtures | Fixtures model pagination, revisions, account capabilities and recipe-detail session requests. Beta failure/race regressions remain alongside design tests. Screenshot references come from the combined release. |

## Verification and screenshot review

| Check | Result |
| --- | --- |
| Web unit suite | **389 passed**, 57 files; `/private/tmp/beta-editorial-web-v3.log` |
| Production web build, including type checking | **Passed**; `/private/tmp/beta-editorial-web-build-v3.log` |
| Final normal production-mode browser run (macOS) | **94 passed, 17 intentional viewport skips, zero failures**; `/private/tmp/beta-editorial-browser-v3-final.log` |
| Final normal Linux Chromium run | **94 passed, 17 intentional viewport skips, zero failures**; `/private/tmp/beta-editorial-linux-final.log` |
| Targeted desktop library/planner verification | **12 passed, one viewport skip**; `/private/tmp/beta-editorial-browser-v3-update.log` |

The final browser run used phone, tablet and desktop projects without the
snapshot-update flag. It covered public/auth navigation, import/save, recipe
editing, library ordering/photo ratios/filtering, planner add/remove/drag/open,
cooking progress/timers/outage recovery, grocery choices and explicit cart
confirmation. The viewport skips restrict desktop geometry checks to desktop
and mobile layout checks to phone/tablet.

Nine refreshed macOS PNG references were visually reviewed: import review, public
library, planner, recipe detail/editor, authenticated header at three sizes,
and smart groceries. The separately added three-product-choice reference was
also reviewed. Screenshots use synthetic recipe/product fixtures; they are not
live retailer inventory or production-capacity evidence.

The release owner separately verified a disposable real-API flow through account
creation, manual save, planner insertion, basic groceries, checking/copying and
password-confirmed deletion. The AI ledger remained empty. Native, shared,
delivery and backend evidence is recorded in the release handoff.

### Linux screenshot verification

The cached official `mcr.microsoft.com/playwright:v1.58.0-noble` test image
provided Playwright 1.58.0 / Chromium 1208. Its image ID was
`sha256:35c7d48b4ccaf3aca5018f5f1bf7f50c7da7d61d176c530741f4f2e9ca336c34`.
The CI-required `fonts-wqy-zenhei` package was verified present at version
`0.9.45-8`, including readable Chinese text in the reviewed recipe screenshot.
Existing JavaScript test dependencies were copied into a temporary harness;
no dependencies or browsers were downloaded.

The same phone, tablet and desktop Chromium projects and 2% screenshot tolerance
ran against the existing host production build through a container-local proxy.
The proxy preserved the test origin, and fixtures matched the build's API address
`http://127.0.0.1:8423`. The reference refresh passed **94 tests with 17 intentional
viewport skips** in 3.0 minutes; its log is
`/private/tmp/beta-editorial-linux-update.log`. A subsequent normal run without
the snapshot-update flag passed **94 tests with 17 intentional skips and zero
failures** in 2.8 minutes; its log is
`/private/tmp/beta-editorial-linux-final.log`.

Eight existing Linux references were refreshed and the three-product-choice
reference was added. All nine were visually reviewed: import review, public
library, planner, recipe detail/editor, the header at three sizes and product
choices. Natural photo proportions, four-column library ordering, readable
planner cards, Chinese text and product-selection controls remained clear.
The smart-groceries Linux reference passed unchanged.

This checks Linux browser rendering, not the entire GitHub Actions environment:
the cached test image uses Node 24 rather than CI's Node 22, and Next.js still
runs from the host production build. The Linux/amd64 image runs under emulation
on this arm64 host. It is a test runtime, not a fresh application release image;
the separate fresh-image release blockers remain. No application source changed
for this check.

## Local review and remaining release gates

The provider-free review build is available at `http://127.0.0.1:3333`, configured
for the disposable local API at `http://127.0.0.1:8423`. While both processes remain
running, a reviewer can create a disposable account, choose **Add Recipe → Create
manually**, save a recipe, plan it and use the basic grocery checklist. Optional
AI/provider actions are outside this local review flow. The preview is not a
public deployment and is unavailable after either process stops.

Fresh backend/web images, their runtime checks, the approved migration/API-worker
rollout order and pending cloud setup must be completed before deployment.
See the release handoff for the current blockers; local tests do not replace
those gates.
