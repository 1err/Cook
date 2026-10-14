# Chef World production deployment plan — 2026-10-13

This is a reviewable execution plan and an audit record, not evidence that a release was deployed. The user authorized production deployment; the root release agent owns cloud mutations. The original working tree contains unrelated edits. Build and deploy only the isolated release checkout at `/Users/xiang1err_/.codex/worktrees/ios-release-deploy/Cooking`, based on the verified production source with explicitly selected readiness changes. Commit the intended release before executing the backend script; its image context is the committed backend archive.

## Verified production baseline

| Surface | Verified current baseline |
| --- | --- |
| Vercel team | Jerry's projects; `jerrys-projects-08f739a2`; `team_nK2qTSFfXpRtcsy44Yp6e2O6` |
| Vercel project | `cook`; `prj_x4dQTj1LKA5VUlOpZrgNG15fDcr0` |
| Frontend deployment | `dpl_48yWbi7MYoBk1Ei3Je4YGdGt8waT`; READY production; source CLI |
| Frontend deployment URL | `https://cook-90pd2cues-jerrys-projects-08f739a2.vercel.app` |
| Frontend source commit | `cf0b2bd3b93afb4b30bfdb9727936599e7fbf08c`, explicitly present in both deployment `meta.applicationSource` and `meta.gitCommitSha`; local Git object exists |
| Frontend aliases | `chef-world.com` and `www.chef-world.com` both assigned to this deployment; `www` redirects 308 to apex |
| Backend source | `a7b444b6ab62ebb51580fbc40858da9afcc7dfb1`, verified by the backend deployment audit against ECR |
| Backend service/task | `us-east-1`, account `930067562682`, cluster `cooking-cluster`, service `cooking-backend-service`; `arn:aws:ecs:us-east-1:930067562682:task-definition/cooking-backend:46` |
| Backend immutable image | `930067562682.dkr.ecr.us-east-1.amazonaws.com/cooking-backend@sha256:d58958cc2770fcd68bbcf40499cc28e9a7e6ac0e8f6a61573299acb81dc7c2b9` |
| Backend pre-release migration head | `20261001_library_visibility`; readiness migrations must extend this lineage |

Vercel's effective deployed settings are Next.js, Node 24.x, root directory unset, install command `npx --yes npm@11.19.1 ci --no-audit --no-fund --workspace=@cooking/web --include-workspace-root`, build command `npm --workspace @cooking/web run build`, output `apps/web/.next`. The release retains this configuration. Deployment protection is enabled for `all_except_custom_domains`; the immutable deployment URL is protected while custom production domains are public.

The original repository was unlinked. The read-only CLI `project inspect --non-interactive` correctly returned `link_required`; named project inspection and authenticated Vercel API reads established the exact existing project. The root agent subsequently linked the isolated checkout to that project. No new Vercel project is needed. Raw deployment audit data was reduced to safe selected fields; task environment values and tokens were not printed.

## Backend execution and acceptance

Retain the production baseline `scripts/deploy-backend.sh`. It already implements the safe release flow; do not replace it with an older local script. Serialize deployment jobs because ECS has no conditional update-service operation for the final check-to-update interval.

1. Verify the committed isolated release, migration lineage, focused tests, full backend checks, and frontend build. Review private task-environment overrides before use. The existing live task supplies roles, secret references, log settings and service network configuration. New required configuration, including the API origin used to validate immutable shared media, must be set to verified production values in a private override file; do not paste values into command arguments or documentation.
2. Build the committed source for `linux/amd64`, push its commit tag, and pin the returned immutable digest. The optional `PREBUILT_IMAGE_DIGEST` path first verifies that the exact committed SHA tag in the configured ECR repository resolves to the supplied digest. It does not accept an arbitrary existing image.
3. Register one task revision preserving reviewed roles, environment, secret references and any explicitly reviewed auxiliary containers. The API command must remain `uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-proxy-headers`; migration must not run inside API startup. API liveness is `/health`; load-balancer readiness remains separate.
4. Run exactly one separate migration task with that new immutable revision and a command override `python -m app.migrate`. Reuse the service's full awsvpc configuration, capacity-provider strategy or launch type, and platform version. The migration runner holds a PostgreSQL session advisory lock with bounded lock and DDL timeouts. It must compare committed database heads with this image's Alembic heads before exiting successfully. The prepared release's expected head is `20261013_media_review`; actual local PostgreSQL validation emitted `MIGRATION_HEAD_VERIFIED revisions=20261013_media_review`. Require that exact revision-only marker for the live migration task as well.
5. Wait for this migration task to stop and verify its exact task ARN, task-definition ARN, backend container name, STOPPED status, `EssentialContainerExited`, exit code 0 and expected image digest. The script fails before `update-service` if any proof is absent or differs; a timeout stops only this release's migration task. Confirm the revision-only verified-head success record in its exact CloudWatch stream, never dumping unrestricted application or environment logs.
6. Re-read the service task definition to reject another release's changes, then update the API service. A successful `services-stable` waiter is insufficient: the script additionally requires the exact requested deployment ID and revision to be PRIMARY/COMPLETED, desired/running counts to agree with no pending tasks, and every running task to carry the expected revision and image digest. This catches circuit-breaker automatic rollback.
7. Verify `/health` and `/ready` return 200, the safe authenticated route probe behaves as expected, and actual readiness workflows work through the deployed web/native API paths. Exercise report/block/photo-review/deletion with dedicated test accounts and synthetic content. Account deletion and live media cleanup must be verified using authorized test-owned media, including retained copies and retry behavior.

Backend command after the root agent commits and verifies the isolated release:

```sh
cd /Users/xiang1err_/.codex/worktrees/ios-release-deploy/Cooking
REGION=us-east-1 ACCOUNT=930067562682 REPO_NAME=cooking-backend \
CLUSTER=cooking-cluster SERVICE=cooking-backend-service CONTAINER_NAME=backend \
API_BASE=https://api.chef-world.com \
TASK_ENV_OVERRIDES_FILE=/private/tmp/chefworld-backend-release-private/task-env-overrides.json \
bash scripts/deploy-backend.sh
```

The override-file path is an operator-created private input, not a checked-in file. Omit that variable if no override is needed. The actual live task has one essential backend container and no custom entrypoint, so no `MIGRATION_SAFE_SIDECARS` list is required. Do not invent a safe sidecar list if the service changes.

CloudWatch migration logging uses group `/ecs/cooking-backend`, region `us-east-1`, stream `ecs/backend/<migration-task-id>`. Limit any read to the actual release task and safe migration revision records. Record the final committed release SHA, registered task revision, migration task ARN and verified head, rollout deployment ID, image digest, probes and smoke checks in the release result. These values remain unrecorded until the cloud execution succeeds.

## Vercel staged production and promotion

The cached installed CLI is version 59.26.0 at `/Users/xiang1err_/.npm/_npx/69f9afb961c37556/node_modules/vercel/dist/vc.js`; invoke it with Node. The commands below were checked against that CLI's help. `NO_UPDATE_NOTIFIER` and `VERCEL_TELEMETRY_DISABLED` prevent updater/cache noise. They carry no credential material.

```sh
RELEASE_CHECKOUT=/Users/xiang1err_/.codex/worktrees/ios-release-deploy/Cooking
VERCEL_CLI=/Users/xiang1err_/.npm/_npx/69f9afb961c37556/node_modules/vercel/dist/vc.js
export NO_UPDATE_NOTIFIER=1 VERCEL_TELEMETRY_DISABLED=1

node "$VERCEL_CLI" project inspect --non-interactive --format json --cwd "$RELEASE_CHECKOUT"
node "$VERCEL_CLI" deploy --dry --json --project prj_x4dQTj1LKA5VUlOpZrgNG15fDcr0 \
  --scope jerrys-projects-08f739a2 --non-interactive --cwd "$RELEASE_CHECKOUT"
```

Review the dry-run input file list before upload, especially local environment files and generated audit outputs. Verify that the linked project ID and org ID match the table above. The existing-project link command, if the isolated link is absent, is `node "$VERCEL_CLI" link --yes --team team_nK2qTSFfXpRtcsy44Yp6e2O6 --project prj_x4dQTj1LKA5VUlOpZrgNG15fDcr0 --non-interactive --cwd "$RELEASE_CHECKOUT"`; do not create or auto-select a project. Any CLI-created `.env.local` needs private inspection/removal before upload, not output to the terminal.

Create a production build without assigning production domains, using the committed release SHA as provenance:

```sh
RELEASE_SHA=$(git -C "$RELEASE_CHECKOUT" rev-parse HEAD)
node "$VERCEL_CLI" deploy --prod --skip-domain --yes \
  --project prj_x4dQTj1LKA5VUlOpZrgNG15fDcr0 --scope jerrys-projects-08f739a2 \
  --meta applicationSource="$RELEASE_SHA" --meta gitCommitSha="$RELEASE_SHA" \
  --non-interactive --cwd "$RELEASE_CHECKOUT"
```

Set `STAGED_DEPLOYMENT` to the actual resulting deployment ID or URL after creation. Inspect READY production target and source provenance, then test the protected staged build without disabling protection:

```sh
node "$VERCEL_CLI" inspect "$STAGED_DEPLOYMENT" --wait --format json \
  --scope jerrys-projects-08f739a2 --non-interactive --cwd "$RELEASE_CHECKOUT"
node "$VERCEL_CLI" curl /privacy --deployment "$STAGED_DEPLOYMENT" \
  --scope jerrys-projects-08f739a2 --non-interactive --cwd "$RELEASE_CHECKOUT" \
  -- --fail --silent --show-error
```

The standard inspection summary may omit source metadata; inspect the exact deployment with authenticated `vercel api` or the Vercel connector when proof is missing. `vercel curl` uses authenticated deployment access; do not expose a bypass secret, create a public share URL, or weaken project protection. Browser checks may require a supported authenticated protected-deployment session; localhost OIDC credentials alone do not prove access to protected production. Test public documents, login/settings, friend/catalog report/block actions and admin queues against the staged frontend and released backend before assigning custom domains.

After successful staging checks, the root operator promotes that **production** deployment, preserving the tested build:

```sh
node "$VERCEL_CLI" promote "$STAGED_DEPLOYMENT" --scope jerrys-projects-08f739a2 \
  --non-interactive --cwd "$RELEASE_CHECKOUT"
```

Do not substitute a Preview-target deployment: its promotion can rebuild with production environment settings, invalidating the tested artifact. Re-read both custom-domain aliases after promotion and verify apex responses plus `www` redirect behavior. Record the actual new deployment ID/URL and commit only after verification.

## Rollback and unresolved acceptance

If migration fails, the API service has not been updated. Do not run a second release concurrently or rerun a timed-out task until its stopped status and database state have been inspected. A completed additive migration is not automatically undone when an API rollout fails. Restore application traffic to the previous compatible revision without blindly downgrading the database.

The audited backend rollback revision is `arn:aws:ecs:us-east-1:930067562682:task-definition/cooking-backend:46`. Re-verify that baseline immediately before release and retain the script's captured `OLD_TASK` value, since another operator could release in between. If needed, the authorized operator uses `aws ecs update-service --cluster cooking-cluster --service cooking-backend-service --task-definition <captured-OLD_TASK> --region us-east-1`, then independently verifies exact revision, completed rollout, running digest and health/readiness. A waiter alone remains insufficient.

The audited frontend rollback deployment is `dpl_48yWbi7MYoBk1Ei3Je4YGdGt8waT`. Abandoning a failed `--skip-domain` stage leaves existing aliases untouched. If a promoted release fails, the authorized operator can use Vercel rollback to the retained production deployment and re-verify both aliases; Vercel rollback can disable automatic production-domain assignment, so retain explicit promotion control afterward. Do not assume backend and frontend rollbacks are atomic.

Release verification must still establish live moderation ownership and actual timely report/photo review, test account deletion/owned-media cleanup, production API-origin/media eligibility, and rights to imported or uploaded content. The backend audit found S3 cleanup permission and disabled bucket versioning; that does not establish ownership of legacy unowned random keys. Those keys require audited backfill and remain outside automatic account-owned cleanup. Native Apple enrollment, signing and TestFlight/App Store submission remain deferred. Billing, live Stripe and retailer integrations are not enabled by this release.

## Disposable production verification without signup email

`scripts/production-smoke.py` prepares private one-off ECS task inputs and requires an explicit `smoke --execute` command for API mutations. It never invokes AWS itself. Its seed command calls the existing `repo_auth.create_user` and `repo_auth.create_identity` helpers directly, creates two unique `chefworld-qa-<UUID>-{owner,viewer}@example.com` local identities, and marks them email-verified inside one transaction. It neither issues account-action tokens nor imports/calls account-email dispatch. Passwords are random, bounded and stored only in mode-0600 private files or the private ECS override payload. Identities have no admin grant or billing entitlement.

The seed and cleanup-verification payloads must use a freshly read, active **released** task definition pinned to the verified new digest. Preparation rejects a mismatched service revision, mutable/wrong image, cross-account roles, missing network, custom entrypoint, nonessential backend or any sidecar. It reuses the exact task revision (and therefore roles/environment/secret references), network, capacity-provider strategy and platform version. Override values are not passed directly as shell arguments or printed. ECS access to one-off container overrides is an operational credential exposure boundary: use only these disposable passwords, private task input files, and delete the QA identities afterward.

Root-only example after successful backend rollout; `RELEASE_DIGEST` must be the actual verified digest returned by that release:

```sh
umask 077
QA_PARENT=$(mktemp -d /private/tmp/chefworld-production-qa.XXXXXX)
QA_ROOT="$QA_PARENT/seed"
aws ecs describe-services --cluster cooking-cluster --services cooking-backend-service \
  --region us-east-1 > "$QA_PARENT/service.json"
QA_TASK_DEFINITION=$(jq -er '.services[0].taskDefinition' "$QA_PARENT/service.json")
aws ecs describe-task-definition --task-definition "$QA_TASK_DEFINITION" \
  --region us-east-1 > "$QA_PARENT/task.json"
python3 scripts/production-smoke.py prepare \
  --service-file "$QA_PARENT/service.json" --task-file "$QA_PARENT/task.json" \
  --expected-image-digest "$RELEASE_DIGEST" --output-dir "$QA_ROOT"
aws ecs run-task --cli-input-json "file://$QA_ROOT/run-task.json" \
  --region us-east-1 > "$QA_PARENT/seed-run.json"
QA_SEED_TASK=$(jq -er 'if (.failures | length) == 0 and (.tasks | length) == 1 then .tasks[0].taskArn else error("QA seed task launch failed") end' "$QA_PARENT/seed-run.json")
aws ecs wait tasks-stopped --cluster cooking-cluster --tasks "$QA_SEED_TASK" --region us-east-1
aws ecs describe-tasks --cluster cooking-cluster --tasks "$QA_SEED_TASK" \
  --region us-east-1 > "$QA_PARENT/seed-stopped.json"
jq -e --arg arn "$QA_SEED_TASK" --arg task "$QA_TASK_DEFINITION" --arg digest "$RELEASE_DIGEST" \
  '(.failures | length) == 0 and (.tasks | length) == 1 and
   (.tasks[0] | .taskArn == $arn and .taskDefinitionArn == $task and
    .lastStatus == "STOPPED" and .stopCode == "EssentialContainerExited" and
    ([.containers[] | select(.name == "backend")] | length) == 1 and
    any(.containers[]; .name == "backend" and .exitCode == 0 and .imageDigest == $digest))' \
  "$QA_PARENT/seed-stopped.json" > /dev/null
```

Fail closed if launch/stopped-task verification fails. A waiter timeout is not success; stop only the captured QA task, then inspect that task's safe summary. Do not retry seed creation blindly: the seed refuses existing addresses, preventing accidental reuse. On timeout after an uncertain seed commit, inspect only the generated namespace before proceeding or clean it through authenticated deletion.

Run the authenticated API smoke with those private credentials:

```sh
python3 scripts/production-smoke.py smoke --execute \
  --credentials "$QA_ROOT/credentials.json" --result-file "$QA_PARENT/smoke-result.json"
```

It checks verified password login, an account-header mismatch returning 409, owned tiny PNG upload, hidden pending photos in a shared recipe, text-only copied content, a pending recipe report, nonadmin moderation denial, both directions of blocking, and wrong-password deletion rejection. Both generated accounts are password-deleted in a final cleanup step, and their prior sessions must return 401. If the initial login loop fails, cleanup makes one bounded login attempt for every seeded identity; every undeleted label appears in `cleanup_failed`. API redirects are refused so bearer tokens and passwords cannot be forwarded. The private result includes only QA IDs/URLs/check status, never access tokens or passwords. A failed smoke blocks promotion even if its final account cleanup succeeds.

The API smoke cannot prove that the asynchronous worker actually erased S3 data. Prepare a second **read-only** task using the same current release and the authenticated QA IDs recorded in its private result:

```sh
python3 scripts/production-smoke.py prepare-verification \
  --credentials "$QA_ROOT/credentials.json" --smoke-result "$QA_PARENT/smoke-result.json" \
  --service-file "$QA_PARENT/service.json" --task-file "$QA_PARENT/task.json" \
  --expected-image-digest "$RELEASE_DIGEST" --output-dir "$QA_PARENT/verify"
aws ecs run-task --cli-input-json "file://$QA_PARENT/verify/run-task.json" \
  --region us-east-1 > "$QA_PARENT/verify-run.json"
```

Apply the same exact-task, stopped/exit-0/revision/digest checks to this captured verification task. It checks that both QA user rows are absent, their durable account-cleanup intents have drained, and both version listings and current object listings are empty beneath exactly `recipes/<QA-account-UUID>/`. It performs no deletion itself, so success is evidence from the real running cleanup worker. If cleanup is still pending or any storage read is denied, the verification task exits nonzero; inspect only its safe summary and retry verification after the worker has had time, preserving the release/namespace bindings. Never substitute real-user IDs, sweep legacy unowned keys, or execute a direct cleanup helper to manufacture a passing worker test. The review does not claim live cleanup until this task succeeds.

The smoke deliberately does not grant a temporary moderator role or resolve real reports. Actual approve/reject and moderation-resolution operations require the existing authorized operator/admin, using only QA-owned content while the QA accounts still exist or a separately retained disposable QA namespace. Real report handling ownership, response practice and content rights remain owner decisions. The automatically cleaned API smoke covers pending-media visibility and permissions, not full live admin operations.

Local validation of this preparation: five additional migration-safety test methods preserved the unchanged production deployment script; the full pre-smoke scripts suite passed 58 tests. The no-email seed was executed against the task-owned disposable PostgreSQL using the actual repositories: both identities were verified, their bcrypt hashes matched, no account-action tokens existed, and only that random namespace was removed. Expanded smoke tests cover rejected identities/targets/digests/sidecars, private no-clobber output, HTTP error handling, redirect refusal, initial-login and midflow cleanup, and account-ID/namespace binding. These local checks do not represent production seed or smoke execution.

Final local script verification: `TEST_DATABASE_URL=<task-owned disposable PostgreSQL> /private/tmp/chefworld-account-deletion-venv/bin/python -m unittest discover -s scripts/tests -p test_*.py -v` passed **71/71**, including the real seed integration; log `/private/tmp/chefworld-release-script-final-tests.log`. Deployment-shell syntax and all changed Python sources parsed successfully. Independent read-only smoke review found no remaining blocking issue after the bounded cleanup fix. No production seed, API smoke, S3 verification task, deployment or promotion was executed by this audit subagent.
