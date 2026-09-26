# Recipe equipment removal — release verification

Source: `8ec4dabeea7b0cec77b96db7a31c23e8c4c46f3b` on `codex/remove-recipe-equipment-20260925`, based on production application `eccb6ede7964d04aa6fdb7985c563edea0d767f7` plus documentation `c9a5f64`.

## Scope

Removed equipment sections and controls from web/native recipe details, full editing, import draft review, and import reanalysis. New provider schemas/prompts do not request equipment; stale provider equipment is discarded. Ingredients, instructions, timers, tips, covers, and existing features remain intact. Cooking instructions may still name tools where needed.

Legacy database/model fields remain compatible; no schema migration or destructive data removal is introduced. New web/native create requests omit equipment and edits preserve stored legacy data by omitting that field. The native source is updated; no native binary or OTA release was published.

## Verification

- Web unit suite: 634 tests in 75 files passed; web TypeScript passed.
- Native unit suite: 356 tests in 45 suites passed; native TypeScript passed.
- Shared: 282 tests; API client: 39 tests passed.
- Backend: 1,143 passed, 6 host skips; the six Linux containment cases then passed in the fresh backend image.
- Browser regression: 15 recipe detail/edit/import tests across phone, tablet, and desktop passed. Snapshot comparisons were disabled; existing image goldens were not changed. Current import labels and disclosure behavior were refreshed in the affected tests.
- In-app Browser: sample recipe with old equipment metadata showed ingredients, method, tips, and actions without equipment. Editing/saving kept recipe content and omitted equipment from PATCH. The local sample library fixture produced duplicate-key console warnings; this fixture is not shipped and recipe workflow E2E tests passed.
- Fresh backend image: `sha256:ec1661b9a8e0f81c91aa58d3370a002a226f64482c00cd76d0285ac00218dcfa`; 135 source hashes verified, isolated PostgreSQL migrations/idempotence, all four mocked import paths, failed-audit fallback, nonroot Chromium, media boundaries, API/auth/image quota/admin routes, graceful shutdown, and zero provider calls passed. Temporary runtime containers/network were removed.

- Fresh web image: `sha256:12a55ab74ec34f973aa5643cd4dcf81e956c1647ea5894209a3c2cc35f3dd984`; production build/typecheck/static generation, nonroot isolated runtime, 12 routes, sharing assets, exact source revision, production API, preserved image/admin/Muse features, and absence of equipment UI/styles passed.

## Deployment

- Production backend: `cooking-backend:23`, source `8ec4dabeea7b0cec77b96db7a31c23e8c4c46f3b` and immutable image digest verified against running task and ECR. Migration gate exited successfully; ECS rollout completed with one desired/running API task. Store worker remains `cooking-store-worker:2`.
- Configuration HMAC comparison passed with zero differences: credentials, budgets, Gemini model settings, and service settings preserved.
- Live `/health` and `/ready`: HTTP 200. Authentication boundaries and CORS checks passed. Load-balancer readiness target healthy. Bounded API/worker log window had zero warnings, errors, tracebacks, or HTTP 5xx.
- Website: `dpl_BNzjCpk55z1UjGtrh3S3Gzv3uwPK` promoted to both `chef-world.com` and `www.chef-world.com`. Previous deployment: `dpl_4RmTr4T3uJAQLhZEQXrmYVWw2J9W`.
- All 31 live client assets match the verified staged hashes. Equipment labels/sections absent; current import, recipe-image, administrator-cost, and Muse features preserved. Anonymous page routes and service-worker/manifest checks passed.
- Vercel bounded error/fatal/HTTP-5xx queries returned zero entries.
- Live verification completed at 2026-09-26T04:20:24.229477+00:00.

Detailed logs and immutable metadata: `/private/tmp/chef-equipment-release-20260925/`. No authenticated production recipe import or private account access was used for this verification.
