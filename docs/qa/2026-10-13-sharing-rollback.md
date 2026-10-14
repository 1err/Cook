# Chef World sharing rollback — October 13, 2026

The owner requested the original sharing experience and explicitly confirmed: remove photo approval and report/block; keep AI consent. Retain password-confirmed account deletion, Privacy/Terms and hidden Instacart controls. App Store submission is on hold.

The isolated release checkout is `/Users/xiang1err_/.codex/worktrees/ios-release-deploy/Cooking`. It starts from deployed application source `3a3826d0a2f6027bc057b6472dcc35826c4fa23a` plus documentation commit `e438401`; the earlier sharing behavior is source `cf0b2bd3b93afb4b30bfdb9727936599e7fbf08c`. Unrelated original working-tree changes are preserved.

The rollback restores immediately visible shared cover/step images and photo-preserving copies, original sharing cards and friend search/settings screens. The experimental report/block controls, blocked-account boxes, moderation page/queue and server restrictions are retired. Privacy/Terms keep deletion and provider disclosures while removing claims about unavailable approval/report/block features. AI consent remains in the prepared native source.

Existing accounts, recipes and additive migration history remain. The three deployed October 13 migrations are retained; no schema downgrade or bulk deletion is performed. Account deletion, durable owned-media cleanup, account-switch guards, production email verification and import-job compatibility are preserved.

Release state: verification in progress; no rollback deployment is claimed yet. Exact deployment IDs, source, tests and live disposable-account results will be recorded after execution.
