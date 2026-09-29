# Luna and smart-shopping release — September 29, 2026

## Production identity

- Application source: `8dbb5c7738d0f37e080d41296d9b8b5f9ae09313`, built from a clean isolated checkout. This combines Luna/shopping source `b843570ec570ae8f32c54d22ccce9145de226074` with the independently approved library-timing source `62d769346dd0691de069c4c977ed7a649711c86b`.
- API: `cooking-backend:32`, immutable image `sha256:561f6477a3d876d10caf2f36357c1f83cc1ae26bd7a8ab59e1d012cb0063767e`.
- Website: Vercel `dpl_CbYEXheXbCWHEpGPqeZEMqkXXC67`, promoted without rebuilding to https://chef-world.com and https://www.chef-world.com.
- The original dirty checkout was not used for deployment. The coordinating beta-readiness task held its separate deployment; one owner released the combined source.

## Behavior

All existing OpenAI text operations now use `gpt-6-luna`: shopping refinement, recipe extraction/auditing, tutorial timing and menu design. The central client sends Luna-compatible completion/reasoning options; the previous GPT-4o-mini configuration remains supported for rollback. Dedicated Gemini video and image-generation models remain unchanged.

Shopping refinement receives original ingredient names and amounts, each with a unique source ID. The model combines clear synonyms and compatible quantities into one concise total or range. Numeric portions can be estimated with an approximate marker. Every source ID must appear exactly once; missing, duplicated, unknown or arithmetically inconsistent inputs cause a lossless fallback. Specialty ingredients remain distinct. Measured totals omit taste/conversion add-ons. Changed quantity-cache versions request a refresh while retaining compatible checkmarks.

The separately approved library timing display and accessible short breakdown are included. A narrow existing recipe-evidence bug was also fixed: an ingredient heading in one sentence no longer hides all subsequent tutorial sentences in the same paragraph.

## Verification

- Backend: **1,408 passed, 130 skipped**, with two existing dependency deprecation warnings.
- Shared package: **391 passed**; API client: **66 passed**; web: **835 passed**; web TypeScript passed.
- Fresh committed-source backend and web production images passed runtime checks as non-root UID 1001. All 114 backend application files matched the final archive. Backend checks covered source coverage, aliases, ranges, estimates, specialty distinctions, invalid/provider-failure fallbacks, migration repeatability, health/readiness/auth/CORS and bundled Chromium.
- Web image: 17 routes, 40 assets and six fonts verified; eight desktop/phone shopping tests plus two strict-origin browser checks passed. Dependency installs were fresh for this release session; retained base/setup layers and their provenance are recorded in the receipts.
- Independent timing database checks exercised complete, partial and quick recipes through owned/public/friend details and summaries; ownership/privacy and stored steps were preserved. Tests used an isolated database and rolled back fixture data.
- Real Luna provider evaluations used synthetic recipes and the application's existing provider connection. Two Chinese and English trials plus a varied-portion trial passed. Examples: `13 g + 5–10 g` became `18–23 g`; carrot `200 g + 1 小段` became `约 220–240 g`; sugar `约 15.2 g + 10–20 g` became `约 25–35 g`. Five final shopping calls took 2.54–8.04 seconds and had a conservative accounted total of **$0.001812375**. Recipe extraction, timing and menu-design provider checks also passed. Earlier failed trials were retained and informed the final arithmetic prompt and recipe-evidence fix.
- Protected hosted shopping checks passed at desktop/phone widths. The independent nine-case hosted timing matrix passed, including keyboard, hover, touch, 320px English/Chinese layouts and owned/public/friend details. Existing preview authorization was reused through a read-only project request; protection was not changed.
- After promotion, both public domains passed 36 HTML-route checks, 122 exact candidate asset/service-worker matches and 32 feature-media matches. Recovery-route security headers and service-worker scope/cache policy passed. Direct public shopping desktop/phone checks and the independent nine-case public timing matrix passed with no browser errors. Browser API traffic was intercepted with synthetic fixtures; these checks did not write production user data.

## Release gates and safeguards

The exact image ran the advisory-locked production migration successfully before API replacement: task `ec9ba9afdc2449d4996ea9c878b95397`, revision 32, exit 0, matching digest. ECS completed with one intended running task; its container and load-balancer target were healthy. Health/readiness returned 200; protected shopping returned 401; production refinement CORS passed. Bounded new-task log scans found no errors, tracebacks, provider failures or HTTP 5xx. An independent audit also verified the migration, API, schema, CORS, logs and configuration.

Only these environment settings changed with the image: `OPENAI_MODEL=gpt-6-luna`, `AI_PRICE_MODEL=gpt-6-luna`, `AI_PRICE_VERSION=openai-gpt-6-luna-standard-cache-bound-2026-09-29`, input price `0.125` and output price `0.50` USD per million tokens. Pricing uses the reviewed conservative bound. All other environment values, secret references, service settings and the store-worker revision remained unchanged.

The first post-rollout verifier incorrectly required the old draining load-balancer target to be healthy. Its corrected check requires every new task IP to be healthy and permits draining only for old targets. Independent inspection confirmed normal connection draining; no deployment retry was performed.

## Limits and rollback

Finite model examples cannot guarantee every recipe's interpretation; invalid model output retains the lossless fallback. Hosted/public browser checks used fixture APIs, while separate provider and isolated-database checks exercised those layers. No native binary or OTA was published. Focused mobile shopping checks passed; the full mobile run still has unrelated existing `expo-file-system/legacy` failures.

Rollback references: API revision `cooking-backend:31` with image `sha256:ae421f8ce75fa87c5c9427facbd6775bc67cd2980306b8c0a687bcec47e1dd5b`, and website `dpl_Ciwo5jxo2MAPdGX7ujnuyXBo5NSe`. Restore the complete previous API task definition to keep the model and pricing settings aligned.

Sanitized release receipts and full local logs are retained under `/private/tmp/chef-luna-timing-release-20260929`; provider trials under `/private/tmp/chef-luna-release-20260929`; independent timing/runtime/audit receipts under `/private/tmp/chef-library-timing-release-20260929` and `/private/tmp/chef-library-timing-audit-20260929`. These temporary directories are local evidence, not durable external storage.
