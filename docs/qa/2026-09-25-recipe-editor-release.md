# Recipe editor production release

The user authorized deployment after reviewing the redesigned tutorial editor, ingredient
rows without preparation subtitles, and compact camera control. Frozen application source:
`63ddb1848d9970e9ab2bafe2d7dd084144b0775d`, based on the preceding import release `e630e61`.

## Delivered behavior

- Consistent tutorial cards with aligned duration, attention, and illustration controls;
  responsive editor layout with a cooking-plan summary. Existing illustrations are unchanged.
- Quiet validated "Source" links without instruction-authorship badges on detail.
- Ingredient rows show names and one source amount. Notes remain editable, and optional
  original measurements remain available in a disclosure. Extraction preserves source units
  and labels necessary estimates as approximate; grams/mL equivalents remain optional.
- Visible import tag selection and cover editing during import/manual creation/full editing.
  Saved detail uses a compact accessible camera icon for cover changes.
- Applying contextual extraction preserves the latest cover and tags. Image uploads retain
  current edits, handle failure/retry, and ignore removed or unmounted targets.

## Verification

- 589 web, 73 shared, 36 API-client, and 965 backend tests passed; 106 host-dependent backend
  tests were skipped. The initial sandbox Chromium bootstrap failures passed on an authorized
  retry and the initial log is retained. Focused extraction/import coverage: 163 passed.
- TypeScript and fresh Linux/amd64 backend/web image builds passed. Backend runtime gates
  verified 127 frozen source hashes, non-root execution, dependencies, offline Chromium,
  six Linux containment regressions, disposable PostgreSQL fresh/repeated migrations,
  queue/account isolation, ingredient save/readback, media boundaries, and graceful shutdown.
- All 209 staged frontend source files match committed bytes and manifest hashes. Only
  existing Vercel linkage metadata is additional; no secrets, local builds, backend files,
  or temporary fixture code were uploaded.
- Staged import/share routes, web manifest, and sharing worker returned HTTP 200. All 23
  checked live CSS/JavaScript assets across import/detail/tutorial routes exactly match the
  staged build, include the production API and new UI, and exclude preview markers.
- The live signed-out browser followed the expected login redirect with zero console warnings
  or errors. No fresh authenticated production video extraction or image-storage upload was
  performed; automated/local checks do not establish new live provider quality.

## Production result

- API: `cooking-backend:20`, image
  `sha256:a689027cba1418fe40899e9d1705e74f86961001d4079dd8cd0ecd0e3eb05f91`.
- Website: `dpl_E4wVbZRN2a1LtG2ird75WNbY3FyH`, READY and promoted to both
  `chef-world.com` and `www.chef-world.com`.
- Worker: `cooking-store-worker:2`, unchanged.
- Website runtime image:
  `sha256:af71c51084d6478339bb49537662918c7c57f4d374e40b59edce5995e940e19e`.
- Locked migration and exact ECS rollout completed successfully. Final read-only check at
  18:52:48 UTC verified the intended running image, one healthy target, no draining targets,
  API health/readiness 200, protected import routes 401, and production CORS.
- Configuration fingerprints matched: credentials, all eight Gemini settings, budgets,
  worker image/configuration, and service configuration are preserved.
- Final API log window through 18:52:45 UTC contained 405 events, with zero warnings, errors,
  tracebacks, unavailable import workers, or HTTP 5xx responses. The exact website deployment's
  15-minute scan through 18:52:17 UTC returned zero error/fatal/HTTP 5xx records.

Some local permission-review requests timed out and a protected-preview fetch returned an
authentication redirect. No verification gate was waived: an authorized direct request and
subsequent complete route/asset checks passed before promotion. These are bounded release
observations, not continuous monitoring or production-capacity evidence.

## Rollback and evidence

Previous API: `cooking-backend:19`, image
`sha256:f2258a015a6c5a384ee843b4cacb39879fac466740a5ed63ab289b01e78efd9e`.
Previous website: `dpl_JBWUVJGDgRFfyBLf8o8p3D7f2Vdk`. No schema downgrade is needed.

Evidence is under `/private/tmp/chef-editor-release-20260925/`, including source audit,
test/build/runtime results, configuration fingerprints, deployment/promotion records, and
staged/live asset verification. Only the audited `vercel-source` subset was uploaded.
Documentation commits may follow the frozen application commit without changing runtime code.
