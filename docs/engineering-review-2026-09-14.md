# Chef World engineering review — September 14–15, 2026

This review covers the web/mobile feature flows, shared packages, API authorization, recipe and cooking persistence, AI integration, uploads, provider boundaries, Docker packaging, deployment scripts, dependencies and test setup. It preserves the existing product structure. It is an engineering review of the local checkout, not an independent penetration test, a live infrastructure assessment, or an App Store approval.

The checkout already contained substantial uncommitted shopping/import work. A separate active task also added Instacart support during this review. Those changes were preserved; this document attributes the hardening work below separately from that feature development.

## Changes implemented

| Priority | Verified defect or weakness | Change |
| --- | --- | --- |
| Critical | A recipe POST could overwrite a known recipe ID belonging to another account through an ownership-blind ORM merge | Atomic PostgreSQL upsert with an owner predicate; collisions return 409; server controls publication/provenance |
| Critical | Backend Docker `COPY . .` could include the local `.env` because the backend build context had no ignore file | Separate backend ignore rules, stricter root rules, committed-source deployment context and packaging regression checks |
| High | Hardcoded email granted administrator access without verified ownership of that email | Explicit account UUID grants; default deny; server-provided `is_admin` capability |
| High | Cookie-authenticated mutations relied on CORS without server-side origin enforcement | Trusted-origin checks before application work; native bearer compatibility retained |
| High | Account changes could reuse another account's week-only shopping/cart caches | Account-scoped storage and ownership binding; logout/401/race regression coverage |
| High | Shared recipes and cross-account copies exposed original import text, including personal guidance | Shared projections and new copies omit raw import text; owners and historical data remain intact |
| High | Post-login redirect accepted protocol-relative external destinations | Shared safe internal redirect validation |
| High | AI calls had no app-level spend admission, default SDK retries and no output budget; missing credentials fabricated a demo recipe | Persistent account/global operation caps, bounded shared client, safe errors/telemetry, no fake imports |
| High | The S3 presigned PUT could upload more data than the initial multipart size check allowed | Backend stores exactly the validated bytes; original response contract remains compatible |
| High | Removing a non-final cooking dish could violate immediate unique position constraints | Two-phase position updates within the existing session lock |
| High | Expiry-updating cooking reads could overwrite a concurrent step action | Reads use the same session row lock as mutations |
| Medium | Bcrypt silently truncated new passwords and blocked async request processing | Explicit 72-byte registration maximum and thread offloading; existing long-password compatibility retained |
| Medium | Duplicate/case-varied registration could surface a database error | Canonical email handling and controlled duplicate responses |
| Medium | Native fetch could retain a login cookie across logout and block the next login under origin enforcement | Bearer clients explicitly omit cookies, including tokenless login/registration; cookie-jar lifecycle regression coverage |
| Medium | Validation responses could echo a submitted password into client error text | API errors omit submitted values/context; clients render only validation messages |
| Medium | Access logs included email search and other query values | Application access logs retain method/path/status while omitting query strings; proxy logs still need a separate configuration review |
| Medium | Simultaneous catalog/friend copies could create duplicates and later fail | Shared account lock for both copy paths; deterministic lookup preserves existing duplicate data |
| Medium | Oversized recipe fields and null required PATCH fields could cause database/server errors | Request-specific storage limits and null validation; legacy response compatibility retained |
| Medium | Legacy meal-plan input could silently erase a day's slots | Normalize only explicitly supplied fields; validate dates and reversed ranges |
| Medium | Rapid native planner updates could overwrite each other | Per-day serialization, optimistic queue rebasing and stale-result protection |
| Medium | Loading public recipes could hide the user's own library when the public request failed | Independent request outcomes and per-tab errors |
| Medium | Stored source links could use unsafe URL schemes | Shared external-URL validation before rendering navigable links |
| Medium | Shopping aggregation fetched every distinct recipe sequentially | One owned-recipe query while retaining repeated-meal quantities |
| Medium | Stateless external work retained database connections while waiting for AI, image storage or retail responses | Explicit read-session release at provider boundaries; real ORM transaction regressions verify release before the wait |
| Maintenance | Unused service facades were broken, and production code included obsolete demo extraction | Removed the unused facades, demo implementation and unused web re-export shims |
| Delivery | Mutable image tags and dirty working-tree builds made deployment provenance unreliable | Deploy the digest emitted by this build, validate the prior service revision, and verify rollout, running digest and HTTP responses |

Verification results and dependency findings are recorded below.

## Verification evidence

- **Backend:** 518 tests passed against a fresh Python 3.12 runtime with the updated requirements, including real-browser DOM tests and real ORM transaction checks at external-service boundaries. The default suite skips only the seven explicitly configured PostgreSQL integrations. Two dependency deprecation warnings remain in the test-client stack.
- **PostgreSQL:** All seven additional tests passed using an isolated local PostgreSQL 18 database with synthetic accounts and no real application data. The full Alembic chain applied successfully. Checks cover cross-account ID collisions, cooking read/action locking, dish positions, account/global AI counter concurrency, mixed catalog/friend copy concurrency and legacy duplicate preservation. CI now provisions its own PostgreSQL 16 service and applies migrations before these tests.
- **Provider boundary:** The updated environment successfully constructed and closed the existing OpenAI client using a synthetic key, without making a provider request. Import, refinement, quota, timeout and failure regressions use simulated providers.
- **Release scripts:** Eleven tests passed for committed-source packaging, dirty-input rejection, concurrent registry/service changes, exact rollout/digest checks, HTTP failures and repository hygiene. The tracked-file scan checked 484 files and reported no matches in its supported secret/artifact patterns; it does not inspect all historical Git objects or prove every credential is absent.
- **Client regressions:** Web: 51 test files / 329 tests passed. Native: 42 suites / 283 tests passed. Shared domain: 32 tests passed. API client: ten tests passed, including native cookie isolation and the preserved web cookie lifecycle. Both client TypeScript checks, the design-token test, and the Metro resolution test passed.
- **Browser flows:** 59 Playwright tests passed across phone, tablet and desktop, with 13 intentional viewport/platform skips. Coverage includes import/review/save, personal/public library, recipe editing, tutorial timing, planner interactions, offline cooking/replay, shopping and retailer handoff. These browser tests simulate API responses; they do not validate live provider contracts. The desktop shopping baseline was visually reviewed and updated for the independently added Instacart panel; layout and Weee behavior are retained.
- **Native bundle:** An actual iOS Hermes JavaScript export completed with 1,812 modules and a 4.95 MB bundle. This validates Metro/package resolution, not native compilation, signing, Share Sheet behavior or device operation.
- **Web build:** The final Next.js 15.5.24 production build completed, including type validation, all 16 static pages and the dynamic routes. Local client verification used Node 25.2.1; CI and container configuration target Node 22 and still require their own completed release checks.
- **Dependencies:** The final locked JavaScript audit reports zero critical, zero high, 21 moderate and zero low affected-package aggregates. Those moderate aggregates trace to two leaf advisories, including one in the mobile runtime graph. The Python runtime requirements scan reports no known vulnerabilities across 54 packages. Installer/test-tool findings remain in the separate development-environment scan. See the [dependency and delivery report](qa/2026-09-15-dependency-audit.md) for exact versions, findings, source links and reproduction commands.
- **Containers and CI limits:** Actual BuildKit fixture checks confirmed 15 private-file exclusions and six source/example inclusions. Both web Docker manifest sets passed pinned-npm install dry runs. The full backend image attempt stopped during slow dependency installation; the final full web image was not built locally. Full image builds and the regression/audit checks are configured in CI, but no new remote CI result or production rollout is claimed here.

## AI account, cost and scale

The application uses `OPENAI_API_KEY` on the backend. There is no consumer ChatGPT login/session integration in the reviewed code. This is the right technical boundary for a commercial app, but it does not prove that the current API credential is owned by the business or has appropriate billing controls.

Production should use a company-controlled organization/project and a service identity, with separate development credentials, least privilege, named owners, key rotation, alerts and a tested spend cutoff. The local cleanup does not create or transfer accounts, rotate deployed keys or change provider billing. These practices follow [OpenAI's production guidance](https://developers.openai.com/api/docs/guides/production-best-practices).

The implemented defaults are 6 admitted operations/minute and 50/day per account, plus 60/minute and 1,000/day globally. They are configurable environment settings. Every admitted request consumes its allowance even if a later provider call fails. Extraction can make two calls; each defaults to 35 seconds and 4,000 output tokens, with a 60,000-character total prompt ceiling and no automatic retries. These bound request exposure but are not currency-denominated budgets. Provider usage/spend limits must be verified separately.

PostgreSQL enforces the counters across replicas and restarts. Model-call logs contain token counts, operation/model and latency; raw source text is not logged by this layer. A persistent per-account token/cost ledger, abuse detection, paid entitlements, and measured capacity tests remain appropriate before materially larger usage. No real paid AI requests were made by this review.

## Actions before production rollout

1. **Treat earlier backend images as potentially containing local secrets.** The build-context defect establishes an exposure path, not proof that a specific pushed image contained a key. Inspect accessible historical images and rotate any credential that may have been packaged; restrict/remove affected image access as appropriate. Do not paste keys into tickets or logs.
2. **Configure the hardened environment before traffic.** Use `APP_ENV=production`, a random JWT secret of at least 32 characters, secure cookies, exact HTTPS origins, and verified `ADMIN_USER_IDS` / `PUBLIC_LIBRARY_EDITOR_USER_IDS`. The former email/local-host exemptions are gone. Configure the AI project and caps; apply the migration before AI traffic. Existing task definitions must be reviewed for these changes.
3. **Build and test a real staging release.** Verify auth in browser and on native hardware, image uploads, imports, planner/cooking races, quota errors, CORS, logs and rollback using the exact release artifact. Local tests do not establish that cloud IAM, bucket policy, TLS, secrets, migrations or native signing are correct.
4. **Review provider permissions.** Existing Weee scraping is a separately documented permission and scaling issue. Retain only permitted access for commercial use. The independent Instacart implementation needs its own credential/allowlist and live contract validation; code presence does not establish provider approval or fulfillment.

## Remaining product and security work

| Work | Why it matters | Completion evidence |
| --- | --- | --- |
| In-app account deletion and complete data lifecycle | Account creation currently has no corresponding deletion flow; historical image ownership also needs treatment | End-to-end deletion of account, private/shared content, stored images, tokens, local caches and provider-held state where applicable; published retention policy |
| Privacy policy, support and App Store declarations | These require accurate business decisions and inventory of collected/shared data | Published policy/support links, accurate App Store privacy answers and reviewed third-party data practices |
| Password reset, email verification and session revocation | A lost password cannot be recovered; logout alone does not revoke an already-issued bearer token | Verified email recovery, short-lived/rotatable sessions and tests showing revoked credentials fail |
| Login/signup abuse protection | AI operation caps do not protect password hashing, account creation or all other endpoints | Shared rate limiting and/or configured edge controls with tests, monitoring and an operational response |
| Paginated recipe summaries | Library/public/friend endpoints return full recipes including steps and ingredients | Cursor-based, bounded list endpoints; detail fetched on demand; tested large-library behavior |
| Planner revisions across devices | Per-client queues do not prevent two devices overwriting the same day | Version checks/conflict handling exercised with concurrent independent clients |
| Image lifecycle and stronger validation | Public object URLs and signature checks are not a complete privacy or media safety system | Ownership/backfill, deletion jobs, orphan cleanup, verified bucket policies and safe image decoding |
| Deployment/staging operations | Startup migrations and process-local scraper/warmer are not a scalable release architecture; ECS has no conditional service-update API | Serialize production deployment jobs, use dedicated migration/worker execution, and verify readiness, backup restores, alerts and load behavior |
| Native release validation | Type checks and Metro do not prove iOS extension/signing/device behavior; `apps/mobile/eas.json` still has placeholder submission identifiers | Confirm Apple/EAS team ownership, supply submission IDs, build with EAS, and complete TestFlight checks for share-sheet import, offline cooking/notifications and permissions |

Apple requires apps that support account creation to let users initiate deletion in the app. This is a launch requirement, not merely a code-style improvement. See [Apple's deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/) and [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/).

## Maintainability decisions

Keep the shared domain packages, layered backend and platform-specific screens. Avoid a framework rewrite or a large state-management migration during security cleanup. Keep compatibility handling for stored meal-plan/tag/tutorial formats until actual production data is inspected and an audited migration makes removal safe. Break up larger shopping/cooking modules at stable behavioral boundaries, with their current regression coverage in place.

For an investor or professional handoff, pair this repository with a staging demo, the [architecture map](architecture.md), [data inventory](data-inventory.md), a named deployment/operator owner, test/build evidence, infrastructure ownership records and the open release items above. Do not describe local test success as a security certification or public-launch signoff.
