# Recovery and operations alerts

## Verified production state

Checked **2026-09-29 02:05 UTC** in AWS account `930067562682`, `us-east-1`. These infrastructure changes are independent of application deployment. Rechecked after the website-beta deployment at **03:10 UTC**: database available/protected with seven-day retention and no pending changes; all six alarms OK, actions disabled, zero operator subscriptions. The available point-in-time restore window was September 26 04:54:31 UTC through September 29 03:05:18 UTC (about 2.924 days); seven-day history is still accruing.

- RDS `cooking-db`: available, automated backup retention **7 days**, deletion protection **enabled**, no pending modifications. Class `db.t4g.micro`, 20 GiB storage, existing maximum storage, backup window, encryption, security groups, public-address setting and single-AZ placement were preserved.
- Retention was raised from one day after checking that backups were already enabled and there were no pending modifications. The immediate request contained only retention, deletion protection and the instance identifier. AWS documents a potential outage for transitions between zero and nonzero retention; that transition was not performed. [RDS retention behavior](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.BackupRetention.html)
- The automated-backup record independently reports retention 7. Its observed restore window was **September 26 04:54 to September 29 01:55 UTC**. A seven-day setting does not establish seven days of available history immediately.
- Dedicated SNS topic: `arn:aws:sns:us-east-1:930067562682:chef-world-ops-alerts`. The existing account-mail-events topic and its confirmed SQS feedback subscription were preserved. They are not operator alert delivery.
- Six metric alarms were created. **Notification actions remain disabled; an operator destination, confirmed subscription and delivery drill are still required.** Alarm evaluation continues while actions are disabled; all six had settled to **OK** at 02:05 UTC. The operations topic had zero subscriptions. Live `/health` and `/ready` both returned HTTP 200. These checks are not delivery evidence.
- S3 image bucket `cooking-images-930067562682`: versioning was never enabled, no lifecycle configuration, no replication configuration. No object contents were read or changed. Database recovery alone cannot restore an overwritten/deleted image; independent image recovery remains a gap. Enabling versioning needs separate cost and account-deletion/privacy review because old versions survive ordinary deletion.

## Alarm behavior

Names use prefix `chef-world-ops-`. Every alarm sends ALARM and OK transitions to the dedicated topic after actions are enabled; no insufficient-data notifications or repeated normal reports. The SNS resource policy preserves owner access and grants CloudWatch publish only from these six exact alarm ARNs in this account. [CloudWatch SNS permissions](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Notify_Users_Alarm_Changes.html)

| Suffix | Condition | Evaluation | Missing metrics |
| --- | --- | --- | --- |
| `api-ready` | Minimum ALB healthy targets below 1; target group probes `/ready` | 2 of 3 one-minute periods | Breaching |
| `http-5xx` | Target plus ALB errors at least 5 total | One five-minute period | Filled with zero; no traffic is not an error |
| `api-memory` | ECS service average memory above 90% | 3 of 4 five-minute periods | Not breaching; readiness covers API loss |
| `worker-resource` | ECS worker average memory above 90% or metric absent | 3 of 4 five-minute periods | Filled with 100% |
| `db-free-storage` | RDS minimum free storage below 2 GiB | 2 of 3 five-minute periods | Not breaching; DB CPU metric absence covers prolonged loss |
| `db-cpu` | RDS average CPU above 85% or metric absent | 3 of 4 five-minute periods | Filled with 100% |

AWS validated all six metric queries against the preceding hour: healthy targets 60/60 points at 1; errors 12/12 points at zero; API memory 14.65%; worker memory 10.25–10.35%; DB free storage about 17.12 GiB; DB CPU 4.26–5.22%. Worker and database metrics remained present while idle. Separate read-only queries with nonexistent service/database dimensions returned 12/12 values of 100, confirming that each `FILL` expression also produces breaching values when the input series is completely absent. Three-of-four evaluation tolerates one delayed metric period, but sustained monitoring failure can also alert; investigate before restarting resources.

The worker alarm detects missing service metrics and resource pressure. It does **not** prove job progress or replace queue age/lease monitoring. These alarms also do not test DNS/TLS/client reachability, every route, third-party providers, AI spend or image recovery. No paid Container Insights, custom metric, scaling, log-retention change or deletion was added. [Standard ECS utilization metrics](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_utilization.html)

Six alarms use seven underlying standard metrics (the combined HTTP error alarm uses two): approximately **USD 0.70/month** before free-tier benefits/credits at current US East list price. SNS delivery and retained backup storage are usage-dependent. Longer retention can increase backup storage charges; do not assume it fits the regional free backup allocation. [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/), [RDS PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/)

## Reproduce and review request bodies

`scripts/prepare-recovery-alerts.py` is offline: it cannot call AWS or apply changes. It rejects extra input fields, cross-account resource ARNs, the account-email topic, disabled backups, an unavailable DB, pending DB changes and existing alarm-name collisions. Retention is never lowered, and an already-protected database with at least seven days of backups produces no RDS request. A new output directory is required to prevent stale requests surviving a later no-op.

Supply only this sanitized inventory, replacing example identities from fresh read-only queries. Never include credentials, database URLs, user records, subscription endpoints or full task definitions.

```json
{
  "region": "us-east-1",
  "account_id": "123456789012",
  "database": {
    "identifier": "cooking-db", "status": "available",
    "backup_retention_days": 1, "deletion_protection": false,
    "pending_modifications": {}
  },
  "ecs": {
    "cluster": "cooking-cluster",
    "api_service": "cooking-backend-service",
    "worker_service": "cooking-store-worker-service"
  },
  "load_balancer_arn": "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/cooking-load-balancer/0123456789abcdef",
  "target_group_arn": "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/cooking-target-group/0123456789abcdef",
  "notification": {
    "topic_arn": "arn:aws:sns:us-east-1:123456789012:chef-world-ops-alerts",
    "operator_subscription_confirmed": false,
    "existing_topic_policy": null
  },
  "existing_alarm_names": []
}
```

```bash
python3 scripts/prepare-recovery-alerts.py --input /private/tmp/resources.json --output-dir /private/tmp/recovery-plan
python3 -m unittest discover -s scripts/tests -p test_prepare_recovery_alerts.py -v
```

The focused preparation tests pass (9), and all 52 operations-script tests pass using the established backend virtual environment with its dependencies. AWS CLI request-schema validation and live read-only metric queries also passed.

The output contains `plan.json`, six `alarms/*.json`, SNS creation/policy request bodies and `rds-modify.json` only if recovery needs strengthening. `notification_ready` records the supplied confirmed-subscription evidence; it does not assert inbox delivery. All actions stay disabled when it is false. After creating a topic, fetch its current policy and regenerate using that policy before adding scoped CloudWatch access, preserving existing statements. Do not replace an existing topic policy using an old artifact.

For a reviewed initial setup, the individual mutation commands are `aws rds modify-db-instance --cli-input-json file://...`, `aws sns create-topic --cli-input-json file://...`, `aws sns set-topic-attributes --cli-input-json file://...`, and `aws cloudwatch put-metric-alarm --cli-input-json file://...`, with explicit `--region`. The generator deliberately provides no apply command or loop. Before each operation, recheck account, resource identity, existing policy/alarm names and DB pending changes. A concurrent unrelated pending RDS modification must be resolved before `ApplyImmediately`. Re-read current and pending state afterward. The production setup above has already been applied; do not rerun creation or erase collision evidence. Compare existing alarms against reviewed request bodies before any intentional update.

## Confirm operator delivery and enable actions

1. Obtain the operator's explicitly designated endpoint. Subscribe it only to `chef-world-ops-alerts`; email requires the recipient's confirmation link. Keep addresses and confirmation tokens out of repository/receipts. Read only subscription protocol and confirmed/pending status when reporting evidence. Account-auth email delivery does not prove SNS delivery.
2. Create one temporary alarm named `chef-world-ops-delivery-drill-<UTC timestamp>`. Reuse the existing healthy-target metric and dimensions, set threshold below zero, `LessThanThreshold`, period 60, one evaluation period, no missing-data breach, and the operations topic for both ALARM/OK. Add a separate temporary SNS policy statement scoped to **only that exact drill alarm ARN**, preserving all current statements. Do not broaden the six production ARN permissions.
3. Wait for the drill's initial OK state, then use `set-alarm-state` on the **drill only** to ALARM with a clear “operator delivery drill; no production outage” reason. Record the action-history result and actual receipt time reported by the designated inbox. Set the drill back to OK and verify the recovery message too. The next metric evaluation can restore OK automatically. A successful AWS action proves SNS acceptance, not inbox delivery. Do not force or mute a real health alarm to test messages.
4. Enable actions on the six exact production alarm names after the subscription is confirmed and the delivery check passes. Check all live states first: if an alarm is already ALARM, investigate and notify the operator explicitly rather than assuming an old transition will be replayed. Re-read `ActionsEnabled`, action destinations, thresholds and states.
5. Delete only the temporary drill alarm. Read the current topic policy, remove only the uniquely named drill statement and write it back while preserving concurrent unrelated statements. Record zero remaining drill resources. Never delete the operations topic, other subscriptions or production alarms as drill cleanup.

The drill uses an existing metric and one short-lived standard alarm; no custom metric, production interruption, auth email or paid provider request is needed. Keep the run bounded to ten minutes and at most one explicit ALARM/OK pair. If confirmation or receipt is absent, stop the drill, clean up its temporary resources, leave production actions disabled and report delivery as unverified.

## Private restore rehearsal (prepared, not executed)

A backup setting is not a restore test. The proposed 15-minute RPO and one-hour RTO remain unmeasured. Point-in-time restore creates a new database without changing the source; after it becomes available, reading lazy-loaded storage can still be slow. [RDS point-in-time recovery](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html)

Before scheduling a drill:

1. Quote current `db.t4g.micro` instance, 20 GiB storage and any isolated validation-runner/network costs in `us-east-1`. Proposed bound: **USD 2 total and four hours maximum**, with a named operator watching cleanup; stop before creation if the complete quote is unknown or exceeds the bound. This is a proposed ceiling, not an incurred charge or validated price quote. No NAT, instance scaling or broad network changes are part of this drill.
2. Verify a distinct target identifier, such as `cooking-restore-drill-<UTC timestamp>`, an appropriate subnet group and a dedicated security group allowing PostgreSQL only from the isolated validator. Explicitly set `PubliclyAccessible=false`, the validated subnet/security/parameter groups, source `cooking-db`, and a timestamp inside the current restore window. Do not inherit source network defaults. Keep encryption/KMS permissions compatible. Record the request with no passwords or source endpoint changes. [Restore request parameters](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_RestoreDBInstanceToPointInTime.html)
3. Restore the disposable instance with deletion protection disabled only on that clone so cleanup is possible. Track request/start/available/validation timestamps. Do not run the production application, job workers, email delivery, migrations or external AI/retailer calls against the clone. Use an isolated read-only validator with secrets supplied privately.
4. Check schema revision, aggregate table counts and cross-table consistency for accounts, recipes, planner and cooking state; report counts/status only. Verify image-reference metadata against a separately authorized recovery inventory without printing user data or fetching private images. Account deletion after the selected restore point needs reconciliation before any real cutover; a database snapshot must not silently resurrect deleted accounts/content.
5. Remove only the uniquely identified disposable DB (`SkipFinalSnapshot=true` only for this verified clone), then its isolated runner/security group if they were created solely for the drill. Verify clone deletion and zero leftover billable drill resources before ending the four-hour window. Never remove source snapshots, backups or historical logs. Record actual restore time, validation coverage and cost estimate; a passing DB drill still does not close the unversioned-image recovery gap.

A real incident needs a reviewed cutover, account/deletion reconciliation, image consistency and application compatibility checks. This procedure does not authorize repointing production to the clone or reducing source backup protection.
