# Chef World production release — 15 September 2026

The web and backend release is deployed and verified. Both public website domains resolve to the intended frontend deployment; the backend runs the expected immutable image. Live administrator, browser, origin and upload checks passed. Startup logs confirm the database migration completed, with zero error events in the paginated release log scan. Sanitized evidence is preserved in [the release evidence file](2026-09-15-release-evidence.json).

This is a release verification record, not a penetration-test certificate or App Store approval. It supplements the [engineering review](../engineering-review-2026-09-14.md), [architecture map](../architecture.md), [data inventory](../data-inventory.md) and [dependency report](2026-09-15-dependency-audit.md).

## Release identity and scope

| Component | Recorded identity |
| --- | --- |
| Application source | `30a718a55a947ba1edf34f24b58b7df8854b132a` |
| Final backend release source | `748ae762788a022fa31538a62cd4873fa5548607` |
| Local release branch | `codex/professional-hardening-release` |
| Release checkout | `/Users/xiang1err_/Desktop/web_app/Cooking/.worktrees/professional-release-20260915` |
| Backend task definition | `arn:aws:ecs:us-east-1:930067562682:task-definition/cooking-backend:10` |
| Backend image | `930067562682.dkr.ecr.us-east-1.amazonaws.com/cooking-backend@sha256:eb02230ca613b9814989e77586fb15b76309c57e15254df2cafc410a08cf0c48` |
| Backend service | `cooking-cluster` / `cooking-backend-service`, `us-east-1` |
| Frontend deployment | `dpl_By4DGBhUbSE4jnMJhtWMbW2bvt2e` |
| Frontend project | `cook` / `prj_x4dQTj1LKA5VUlOpZrgNG15fDcr0` |
| Public endpoints | <https://chef-world.com>, <https://www.chef-world.com>, <https://api.chef-world.com> |

The second source commit changes only the deployment script and its tests to accept a privately built image after verifying its exact commit tag and digest. The backend, web and shared application files are identical between these two commits. The newer upstream video-import fixes from `origin/main` at `c26dae3b8af703aa66f1cf1ca37633188332d587` were retained. Existing shopping and Instacart work was preserved.

The original working directory and its uncommitted work remain intact. Releases were built from the isolated committed checkout. No branch, pull request or source was published to public GitHub: automatic approval review rejected that publication because it was not explicitly authorized. The frontend was uploaded directly to the existing Vercel project as 152 filtered frontend/shared files, excluding backend source, engineering documents, Git metadata, tests and private environment files. Backend source went only to private AWS build infrastructure and the existing private image repository.

## Administrator access

`jerryxiang24@gmail.com` was matched to its existing account UUID, `15ec5151-06b3-48bb-97c0-012972da5117`. That UUID is now the sole configured `ADMIN_USER_IDS` grant. Access is tied to the account identity rather than an email comparison; changing the account's email does not silently remove its grant, and another account cannot acquire the grant by claiming that email.

The live `/auth/me` response confirms `is_admin: true` for that account. Its `/admin/cache-preview` request succeeds and returns the expected list shape; anonymous access is rejected. The website exposes **Account menu → Store cache** based on the server's administrator capability. Existing authentication secrets were preserved, so this deployment does not intentionally invalidate existing sessions.

An isolated live browser confirmed the Store cache link and Cache Preview heading for this account, with cache HTTP 200. It also confirmed that an anonymous visitor has no administrator link and is redirected from `/preview` to the sign-in form. These browser checks sent no data-changing requests and saved no authentication state or screenshots.

Live authentication checks use a 180-second token held only in memory for this authorized account. No password was requested or printed; these checks are not a password-login or password-recovery test.

## Active limits

| Boundary | Deployed limit |
| --- | --- |
| AI operations per account | 6/minute; 50/day |
| AI operations across the app | 60/minute; 1,000/day |
| Model output per call | 4,000 tokens |
| Model request timeout | 35 seconds per call; automatic SDK retries disabled |
| Total AI prompt | 60,000 characters |
| Uploaded image | 10 MiB; JPEG, PNG, WebP or GIF with matching signature |
| JSON and other non-multipart request bodies | 1 MiB |
| Entire multipart request body | 12 MiB, including form overhead |

AI limits count admitted operations, including operations that subsequently fail. They use fixed UTC minute/day windows; the daily allowance resets at 00:00 UTC (08:00 Shanghai time). Extraction can make two model calls. These are request/output limits, not dollar-denominated budgets, and a per-call timeout is not a universal end-to-end request deadline. Database-backed counters coordinate the allowance across application replicas. No paid AI request was made during this release verification.

The backend uses `OPENAI_API_KEY`; the reviewed application does not sign in through a consumer ChatGPT session. Company ownership of the API project, service credentials, billing limits and spend alerts still requires an operator check.

## Verification evidence

| Check | Result |
| --- | --- |
| Exact backend rollout | Completed service rollout; running task definition and immutable image digest matched this release |
| Production domains | Both `chef-world.com` and `www.chef-world.com` resolve to `dpl_By4DGBhUbSE4jnMJhtWMbW2bvt2e`, READY |
| Live health / protected route | HTTP 200 / HTTP 401 |
| Live administrator identity and cache | Correct account; `is_admin: true`; cache HTTP 200 with expected response shape |
| Browser-origin controls | Exact allowed origin and credentials for both public website domains; untrusted origin denied |
| Live browser | Administrator link visible and usable for the requested account; cache heading visible and API HTTP 200; anonymous link hidden and protected-page redirect verified |
| Migration and logs | Startup records show `20260827_cook_sess -> 20260914_ai_usage`, followed by application startup completion; 286 log events paginated and scanned, zero error events |
| Live image upload | A synthetic 69-byte PNG uploaded successfully; exact stored bytes and public HTTP 200 verified; no second upload required |
| Upload cleanup | Only the new temporary object was deleted; its subsequent storage lookup returned not found; bucket versioning was not enabled; no recipe records changed |
| Backend container | Non-root UID 1001; private build inputs absent; runtime directories writable; health HTTP 200; anonymous admin denied; Chromium 145.0.7632.6 launched and rendered a local page with network disabled |
| Backend regression suite | 556 passed; seven explicitly opt-in PostgreSQL integrations skipped in that run; two dependency deprecation warnings |
| Real PostgreSQL checks | Seven passed earlier against an isolated PostgreSQL 18 database, including migrations and concurrent ownership, cooking and AI-quota operations |
| Deployment script regressions | 19 passed, including prebuilt digest validation, exact commit matching, configuration merge and rollback/concurrency guards; three repository-hygiene regressions also passed |
| Repository scan | 563 tracked files; zero findings in the supported secret/artifact patterns; not a scan of every historical Git object |
| Web tests | 51 files / 329 tests passed |
| Native tests | 42 suites / 283 tests passed |
| Shared / API client | 32 / 10 tests passed; both client type checks, design-token and Metro checks passed |
| Browser regression suite | 59 passed; 13 intentional platform/viewport skips; API responses simulated in this suite |
| Native JavaScript export | iOS Hermes export succeeded: 1,812 modules, 4.95 MB; not a native signed build |
| Vercel production build | Next.js 15.5.24 compile/type checks, 16 static pages and dynamic routes passed; pinned npm 11.19.1 |
| Full web Docker build | Passed; non-root UID 1001, Node 22.23.2; login, three CSS assets and JavaScript asset returned HTTP 200 |
| Dependencies | JavaScript: zero critical/high, 21 moderate affected-package aggregates tracing to two leaf advisories; Python runtime: zero known findings across 54 packages; see dependency report for development-tool findings |

The local backend browser download timed out. The final image was instead built and tested in a private, temporary AWS CodeBuild job, `cooking-release-20260915-62ce314b:549ea91e-8003-48ea-96ef-57a1482c977f`, which succeeded from 01:13:09 to 01:16:08 Shanghai time on 15 September. Its base resolved to `python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea`, matching the locally inspected base. The deployment digest was captured from that build's own pushed-image output, rather than inferred from a subsequently mutable tag.

The temporary source bucket had public access blocked, HTTPS enforced and encryption enabled. The build role was limited to its source object, log group and existing image repository; it could not deploy ECS or read application secrets. The project, source object/bucket, role/policy and temporary log group were removed after evidence was saved. The release image remains in ECR. No `latest` tag was updated.

The web Docker image still emits an informational warning recommending the standalone server entry point for `output: standalone`; its current packaged runtime passed the HTTP checks. No new GitHub CI run is claimed; publishing the source to that public repository was outside the approved deployment.

The first live-browser attempt waited for the page's full resource `load` event and timed out. The final check waits for DOM readiness and explicitly asserts the sign-in form, authenticated account menu and cache content; it passed without changing application code. A transient CloudWatch read timeout was retried successfully. Migration completion was verified through the successful startup chain and logs; no extra production SQL task or quota-consuming AI request was needed.

## Redundancy count

**132 physical lines of obsolete or redundant code were removed conservatively:** 28 lines across four unused web re-export shims, 38 lines across two unused backend service facades, and 66 lines in the obsolete fake/demo extraction implementation. The strictly unused portion is 66 lines; the other 66 remove the formerly reachable demo fallback.

This excludes two separator blank lines, rewritten logic, dependency-lockfile churn and unrelated feature changes. The complete release grows overall because it adds security checks, regression tests and documentation; gross Git deletion counts are not a redundancy metric.

## Remaining launch work and operational boundaries

- Complete in-app account deletion and its data/image lifecycle, recovery and email verification, and session revocation. Publish accurate privacy/support links and App Store privacy answers.
- Validate Apple/EAS ownership, replace submission placeholders, produce a signed native build, and test Share Sheet intake and other native behavior on devices/TestFlight. This deployment covers the web and backend; it does not submit or publish an App Store binary.
- Confirm company-controlled AI credentials and billing controls, and add a durable per-user token/cost ledger as usage grows. Validate live provider permissions and contracts, including Instacart and the existing Weee integration; this release does not establish direct cart fulfillment or provider approval.
- Add shared login/signup abuse controls, bounded library pagination, measured capacity tests, cross-device planner conflict handling and operational backup/restore checks. AI quotas alone do not establish unlimited application capacity.
- Configure and verify the appropriate RDS CA trust chain. The preflight confirmed encryption on the current database connection, but a certificate-verifying `ssl=True` probe failed with a certificate trust error; that setting was not blindly enabled during this release.
- The currently deployed previous image's visible `/app` filesystem was inspected before replacement: 158 files, zero targeted environment/key/snapshot/credential filename findings. That does not prove that every historical image or deleted lower layer is free of secrets; historical-image review and any necessary credential rotation remain separate work.

Rollback references are backend task definition `cooking-backend:9` and frontend deployment `dpl_AJ8M1E79sqBJ3ypMT4WTXToC6ZpL`. The AI-usage migration is additive; a rollback requires a deliberate compatibility check and must preserve user data rather than automatically reversing the database migration. Rolling back old code would also restore its older security behavior.
