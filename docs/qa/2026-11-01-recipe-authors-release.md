# Recipe authors production release — November 1, 2026

The optional creator registry, recipe credits/editing, creator-aware search and Library filters, plus the Planner All creators dropdown beside All tags are live at https://chef-world.com. The existing waterfall, tags, recipe content and meal assignments are preserved.

Application commit: `0a15ef11c9d9ba67c2a2ef5d19e116b1a4ffa98d` on `codex/recipe-authors-20261101`. Remote main and the unrelated dirty primary checkout were not changed. This subsequent documentation commit does not change deployed application source. Native source was prepared and tested, but no native binary was released.

## Release identity

| Component | Verified release |
| --- | --- |
| Database | `20261101_recipe_authors` |
| API | `cooking-backend:53` |
| Worker | `cooking-store-worker:4` |
| Shared backend image | `sha256:51fa85c52f46e6e2667c5bd0cade8dd75f5556522db9fa80f1eeede508785916` |
| Vercel production | `dpl_DdxiBVtByACDRAah6N6aLaaj5k91` |
| Website source | Exact Git SHA above; READY; both custom aliases verified |

The existing seven-day database backup retention and deletion protection were read back before migration. The migration ran in a one-off Fargate task from the exact new image under the application advisory lock, and logged `MIGRATION_HEAD_VERIFIED revisions=20261101_recipe_authors` before API replacement. The schema is additive and compatible with the previous release.

API and worker reached COMPLETED with their intended task revisions, running counts and immutable digest. Non-image task configuration, worker command and environment were independently compared with the preceding revisions. The API load-balancer target was healthy. Bounded new-task error scans were clear. The worker helper exited 1 while rolloutState was still IN_PROGRESS despite a healthy task; the independent subsequent audit verified COMPLETED without another deployment.

Vercel automatically assigned the production build on readiness. An explicit promote request returned 409 because that exact deployment was already current; independent reads confirmed both chef-world.com and www.chef-world.com map to the intended deployment, preserving the www 308 redirect. A protected-deployment fetch was rejected by automatic approval review because it would create a share link. No link or access-control change was made; verification used the tested production images and the public website. Vercel's bounded deployment error/fatal log query returned no matching logs.

## Validation

| Check | Result |
| --- | --- |
| Full backend | 1,645 passed; 157 opt-in skips; two existing dependency deprecation warnings |
| Real PostgreSQL author, concurrency and migration-lock checks | 23 passed |
| Web / shared suites | 1,013 / 423 passed |
| Web TypeScript | Passed |
| Fresh Linux backend / web images | Built successfully; non-root runtime users retained |
| Fresh backend image authenticated HTTP | 11 checks passed |
| Fresh web image against real API image | 7 desktop/phone checks passed |
| Planner desktop/phone browser checks | 9 passed, including accessibility |
| Public API | Six health, readiness, authentication and credentialed CORS checks passed |
| Public website | Five page/redirect checks and 28 referenced assets passed |
| Served code | New creator controls and production API base present; loopback preview configuration absent |

Image checks used two disposable local identities and recipes, a separate PostgreSQL container, the actual migration entrypoint and normal application authentication. Web-image requests were redirected only inside an isolated QA browser to the actual local API image. No provider credentials, external AI calls, production account creation or customer recipe writes were used. Disposable containers, database and generated credentials were removed afterward.

The signed-in live account retained its 16 recipes in four natural-image waterfall columns, with no horizontal overflow. An existing recipe opened the new Add author editor. Planner exposed the separate creator dropdown, its Choose recipe dialog retained both controls, and a dish search returned the expected existing recipe. The picker was closed without adding meals. Browser error logs were empty.

Production recipes have not been automatically attributed from the local preview. Existing recipes can be credited using Add author; names and aliases can then be reused across the application. Saving/clearing credit was verified against the real local release images rather than modifying customer recipes during release checks. The loopback preview runner and snapshot are outside application source and were not deployed.

## Rollback

Previous API: `cooking-backend:52`; worker: `cooking-store-worker:3`; Vercel: `dpl_GuJ6nX8WMcfscXKZx5X9pp3Kw6V3`. Recheck current state before an intentional rollback. The additive author schema can remain when restoring the old images; image rollback does not reverse saved author data.

Machine-readable, sanitized service and HTTP evidence: [release evidence](2026-11-01-recipe-authors-release.json).
