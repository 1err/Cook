# Professional hardening implementation plan

**Goal:** Preserve Chef World's recipe, planner, cooking, shopping, sharing, web, and mobile experiences while correcting verified security and reliability defects and making release risks reviewable.

**Architecture:** Keep the existing monorepo and FastAPI/Postgres backend. Strengthen authorization at database writes, centralize resource limits and AI lifecycle, derive privileges from server configuration, isolate client account state, and make deployment inputs reproducible. Avoid replacing working features or changing frameworks during a security pass.

**Constraints:** Preserve the pre-existing local changes (baseline captured before edits). No production deployment, live account creation, real user data mutation, paid AI calls, or secret values in test output. Keep source import provenance and the user-confirmed retailer handoff. Verification uses simulated providers and disposable databases.

## Work and verification

- [x] Recipe integrity: replace ownership-blind merge with an atomic owner-guarded write; keep publication and copy provenance server controlled. Verify foreign-ID collisions, owned retries, publication spoofing, and existing tutorials.
- [x] Authentication: bound new passwords according to bcrypt's UTF-8 input limit, offload hashing, normalize duplicate registration, and enforce trusted browser origins for mutations. Verify cookie and bearer modes.
- [x] Privileges and settings: remove email-based administrative identity, add explicit account-ID configuration and server-provided capabilities, reject insecure production settings. Verify denied-by-default access and correct explicit grants.
- [x] AI operations: reuse and close the provider client, bound input/output/time/retries, make missing extraction service fail honestly, retain safe deterministic shopping/timing fallbacks, and introduce database-backed per-account/global admission limits. Verify failure, cancellation, quotas, and concurrency without real API calls.
- [x] Client state: reject unsafe post-login redirects, clear only application-owned account caches, make logout reliable when storage fails, and avoid stale auth completions. Verify account switching, transport failure, unauthorized responses, and existing shopping/cooking tests.
- [x] Delivery: exclude secrets/local artifacts from both Docker contexts, build committed inputs, deploy immutable digests with verifiable rollout, and add repeatable release checks. Test script control flow using mocked cloud commands; run available builds and dependency scans.
- [x] Maintainability: remove proven unused/broken compatibility code, retain data migrations until production backfill evidence exists, and update operational documentation.
- [x] Final review: inspect integrated diffs, run backend/web/mobile regression suites, type checks, production web build, available browser/container checks, and document exact remaining release gates. Independent final review also caught and verified the native cookie-jar fix. Full production image builds, remote CI, staging and native device/signing checks remain explicit release prerequisites in the engineering review.

## Deliberate release boundaries

Actual cloud credentials, organization ownership, deployed secret rotation, private signing information, a live staging environment, App Store privacy declarations, and store submission require external configuration. Code changes will not be presented as evidence that those have happened. Existing retailer scraping needs permitted provider access before scaling beyond its documented single-process constraints.
