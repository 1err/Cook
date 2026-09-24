# Beta activation — September 23, 2026

Status: final combined source verified locally; fresh image and deployment gates
are in progress. Production currently serves editorial commit `4722da5` and
`cooking-backend:11`. Do not interpret this preparation record as a completed
beta deployment.

## Source integration

The owner reported that the UI had deployed and then authorized proceeding with
"Good to go now." This resumes the previously specified beta release and the
approximately $22/month worker and private email-feedback setup.

Merged the deployed `4722da57ef13731d4ca4c10c368f50103c8cac90` into the isolated
beta release based on `8a93220`. Fixed editorial snapshots supplied the three-way
merge bases, retaining beta account isolation, recovery/deletion, manual creation,
recipe pagination, retry states, deterministic groceries, monetary reservations
and durable jobs. The latest public UI, original locally served login photograph,
friend navigation, planner interactions and exact shopping-quantity fixes remain.
The two backend quantity implementation files exactly match `4722da5`.

A public-library deep-link regression checks that `?view=public` activates the
paginated catalog immediately. Updated test fixtures reflect localized editor
labels and individual/paginated recipe requests. No test assertions or screenshot
tolerances were loosened. Ten macOS screenshot references were visually reviewed.

## Verification before fresh image builds

- Web: 400 tests passed; TypeScript and production build passed.
- Backend: 768 passed. The full run passed 749; 19 account tests initially refused
  the wrong disposable database name and subsequently passed on their specifically
  allowlisted `chef_beta_accounts_20260922` database. Six Linux-only containment
  cases remain for the image runtime gate.
- Native: 323 tests passed; no native distribution or device sign-off is implied.
- Shared/API client: 49 passed; delivery safety: 43 passed.
- macOS Chromium: final normal run 112 passed, 17 intentional viewport skips,
  zero failures. Linux browser verification and both fresh application images
  remain pending at this source checkpoint.
- Repository hygiene and diff whitespace checks passed.

Logs use `/private/tmp/chef-beta-forward-` with suffixes `web-tests-final.log`,
`web-types.log`, `web-build.log`, `backend-tests.log`, `accounts-tests.log`,
`native-tests.log`, `shared-tests.log`, `delivery-tests.log` and
`browser-final.log`. Initial browser fixtures/snapshots were corrected before the
normal verification run; the snapshot refresh itself is not the final proof.

## Current production and rollback baseline

- Public website and API health returned HTTP 200.
- API revision `cooking-backend:11`, one desired/running task, image
  `sha256:02ce64834a31d2d4ae1d5e0f3b26c33e61d82e57733ec87ff3df4280393bedde`.
- `/ready` and `/auth/capabilities` returned 404; the beta environment allocations
  are absent. No `cooking-store-worker-service` existed at preflight.
- RDS `cooking-db`: available, encrypted, one-day automated backup retention;
  latest restorable point was `2026-09-24T04:35:22Z` at the preflight check.
- GPT-4o mini pricing rechecked against the official model page: USD 0.15 input
  and USD 0.60 output per million tokens. The intended app allowance remains
  USD 29 per UTC month with a USD 3 per-account ceiling. It is not live yet.

## Applied email setup

The prior resource-approval blocker is resolved by the owner's approval above.
Created and read back:

- SNS topic `chef-world-account-mail-events`, publish permission restricted to
  the `chef-world.com` SES identity in AWS account `930067562682`.
- SQS queue `chef-world-account-mail-feedback`, SQS-managed encryption,
  14-day retention, delivery allowed only from that topic/account.
- Confirmed SNS-to-SQS subscription with raw message delivery; SES Bounce and
  Complaint notifications point to the topic. No original email headers are
  included. Forwarding to the non-existent no-reply inbox is disabled.
- Account automatic suppression for BOUNCE and COMPLAINT remains enabled.

Submitted the transactional production-access request using the AWS account's
existing contact details, without adding another email recipient. AWS returned
`ReviewDetails.Status=PENDING` and `ProductionAccessEnabled=false`.
`EMAIL_PROVIDER` must remain disabled until approval and a controlled delivery
check. No email was sent and no private production account was accessed.

The queue retains reports for operational review; this setup does not add a
queue consumer or alert subscription. Automatic SES suppression handles further
sending to hard-bounce/complaint recipients. A production email review is still
an external approval gate.

Sources: https://developers.openai.com/api/docs/models/gpt-4o-mini and the
read-only AWS service/account/queue responses recorded during this release.
