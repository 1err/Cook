# Shopping refinement recovery — September 29, 2026

## Failure and correction

The user's nine-recipe shopping list showed a global “Smart refinement is temporarily unavailable” notice and fragmented quantities. Production logs at 17:00:11 UTC showed a successful Luna response (16.84 seconds, 2,952 output tokens) followed by HTTP 200, with no recorded parser rejection reason.

The user provided the 62 displayed ingredient rows. After explicit approval, two bounded live tests used these rows and an equivalent 70-row version that split only existing additive amounts. The second response reproduced the visible failure: Luna estimated garlic at `约 55–70 g` from `约 46 g`, `几颗` and `蒜: 适量`. The arithmetic guard correctly rejected invented numeric weight from a vague contribution, but the deployed parser then discarded every valid group. Replaying that same response returned all screenshot fragments and duplicate garlic/tomato names. These tests reconstruct the supplied displayed list; they do not recover the original production request or provider response.

The correction keeps source coverage strict while limiting quantity recovery to the affected group. It can restore exact quantities/ranges from compatible original measurements, remove recognized vague additions from a measured total, and retain validated model estimates elsewhere. Unresolvable quantities preserve their own original group. Distinct ingredients are checked before vague contributions are removed. Missing/duplicate/unknown source IDs and identity conflicts still use the conservative structural fallback. Diagnostic logs now contain fixed reason codes and counts, without recipe names, amounts or model content.

The first live test also exposed plain onion and red onion being merged. A narrow onion-variety guard preserves their original identities and amounts. Recovery-only garlic, ginger and tomato aliases avoid reintroducing obvious duplicates; no fuzzy matching or additional model calls were added.

## Verification

- 105 focused refinement tests passed. New regressions were observed failing before implementation, including valid groups surviving an unrelated failure, exact range correction and preserving a distinct vague ingredient.
- Final full backend suite: **1,433 passed, 130 skipped**, two existing dependency deprecation warnings. Independent review found no blocking issues and separately checked fractions, mixed scales, ranges and source conservation.
- Both recorded provider responses passed through the final parser and the exact production image, offline with no provider keys. Every source ID appeared exactly once; both produced **60 refined items**. Garlic was `约 46 g`, salt `18–23 g`, sugar `约 25–35 g`, carrot `约 220–240 g`; plain onion remained `350 g`, red onion `100 g`. There were no additive/semicolon fragments in the corrected outputs.
- Browser checks used those exact API-shaped backend results, with file hashes tying them to image replay. The full 62-item flow passed at 1440px and 390px; the second result also passed at 1440px. Intended aliases merged, distinct ingredients remained, categories rendered, checkmarks survived reload, and there was no fallback notice, browser error, overflow or unexpected network request. Browser API traffic was intercepted; separate live calls exercised Luna.
- Exactly two approved paid calls were made. Conservative accounted total: **$0.003405625**, below the approved $0.03 cap. All subsequent replays were offline.
- Fresh committed-source backend image passed non-root/amd64 runtime, all 114 application source hashes, repeatable locked migrations, bundled Chromium, health/readiness, authorization and production CORS checks. Its nine unchanged base/dependency layers match the earlier fresh image from this release session, whose dependency-build evidence is retained.
- The frontend is unchanged. Its prior fresh-image verification was retained after checking all frontend build inputs for equality, and the new full-list public-site browser tests above covered the changed response behavior. No Vercel upload or promotion was required.

## Evidence and limitations

Application source: `b5472e0e04cd4eb95f13003c33b23b969b943f8f`. Image: `sha256:e232361c000ec7567009c91c017412e2c3441d84f9209cedc663b789341489c0`.

Local evidence is under `/private/tmp/chef-shopping-failure-20260929` and `/private/tmp/chef-shopping-fix-release-20260929`. The original small synthetic examples did not expose this whole-list recovery failure; this release adds full-list captured-response replay. Finite provider trials do not guarantee every future model interpretation. Genuinely missing units are preserved rather than invented.

Rollback is API revision `cooking-backend:32`, immutable image `sha256:561f6477a3d876d10caf2f36357c1f83cc1ae26bd7a8ab59e1d012cb0063767e`. Luna and all other model/budget/service settings remain unchanged by this correction. Website remains `dpl_CbYEXheXbCWHEpGPqeZEMqkXXC67`.

## Production release verification

Deployed application source `b5472e0e04cd4eb95f13003c33b23b969b943f8f` as `cooking-backend:33` with the immutable image above. The locked migration task exited 0. Independent checks at 17:44:00 and 17:44:26 UTC confirmed the intended revision as the sole completed PRIMARY deployment, desired/running count 1, pending count 0, and the new task/container/target healthy. The preceding target was draining normally. Environment, secrets references, model/budget settings and saved service configuration were preserved; worker revision 2 remained healthy.

The deployment script returned nonzero because its rollout guard ran immediately before ECS marked completion. That original result is retained in `backend-deploy.log`. No repeat deployment or rollback was performed. Both independent read-only checks then verified the exact intended revision/digest, completed rollout, live health/readiness 200, protected shopping-list 401 and production refinement CORS 200. Complete bounded new-task log scans found no warnings/errors/tracebacks/provider failures/5xx. Receipts: `production-after.json`, `independent-production-audit.json` and `production-migration-proof.json`.

Read-only Vercel inspection confirmed the existing website deployment `dpl_CbYEXheXbCWHEpGPqeZEMqkXXC67` remains READY. No frontend upload or promotion was performed. Existing fallback lists require the user to select Retry refinement; no authenticated production list was overwritten as part of verification. Temporary test containers, their disposable database volume and local runtime credential files were removed.
