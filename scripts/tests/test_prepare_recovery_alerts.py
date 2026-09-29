import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "prepare-recovery-alerts.py"


def fixture():
    return {
        "region": "us-east-1", "account_id": "123456789012",
        "database": {"identifier": "cooking-db", "status": "available",
                     "backup_retention_days": 1, "deletion_protection": False,
                     "pending_modifications": {}},
        "ecs": {"cluster": "cooking-cluster", "api_service": "cooking-backend-service",
                "worker_service": "cooking-store-worker-service"},
        "load_balancer_arn": "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/cooking-load-balancer/0123456789abcdef",
        "target_group_arn": "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/cooking-target-group/0123456789abcdef",
        "notification": {"topic_arn": "arn:aws:sns:us-east-1:123456789012:chef-world-ops-alerts",
                         "operator_subscription_confirmed": False, "existing_topic_policy": None},
        "existing_alarm_names": [],
    }


class RecoveryAlertPreparationTests(unittest.TestCase):
    def module(self):
        self.assertTrue(SOURCE.exists(), "Recovery/alert plan generator must exist")
        spec = importlib.util.spec_from_file_location("prepare_recovery_alerts", SOURCE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_plan_cannot_apply_and_only_strengthens_database_recovery(self):
        result = self.module().prepare(fixture())
        self.assertFalse(result["apply_supported"])
        self.assertEqual(result["rds_modify_request"], {
            "DBInstanceIdentifier": "cooking-db", "BackupRetentionPeriod": 7,
            "DeletionProtection": True, "ApplyImmediately": True,
        })
        self.assertFalse(result["notification_ready"])
        self.assertTrue(all(a["ActionsEnabled"] is False for a in result["alarm_requests"]))
        self.assertEqual(result["alarm_metric_count"], 7)

    def test_existing_stronger_recovery_is_never_weakened(self):
        data = fixture()
        data["database"].update(backup_retention_days=14, deletion_protection=True)
        self.assertIsNone(self.module().prepare(data)["rds_modify_request"])
        data["database"]["deletion_protection"] = False
        request = self.module().prepare(data)["rds_modify_request"]
        self.assertEqual(request["BackupRetentionPeriod"], 14)
        self.assertTrue(request["DeletionProtection"])

    def test_pending_changes_disabled_backups_or_alarm_collision_fail_closed(self):
        for edit in (
            lambda d: d["database"].update(pending_modifications={"DBInstanceClass": "db.t4g.small"}),
            lambda d: d["database"].update(backup_retention_days=0),
            lambda d: d["database"].update(status="modifying"),
            lambda d: d["existing_alarm_names"].append("chef-world-ops-api-ready"),
        ):
            data = fixture(); edit(data)
            with self.assertRaises(ValueError): self.module().prepare(data)

    def test_notification_policy_preserves_owner_rules_and_limits_cloudwatch_to_exact_alarms(self):
        data = fixture()
        existing = {"Version": "2012-10-17", "Statement": [{"Sid": "KeepOwnerRule", "Effect": "Allow", "Principal": {"AWS": "123456789012"}, "Action": "SNS:GetTopicAttributes", "Resource": data["notification"]["topic_arn"]}]}
        data["notification"].update(existing_topic_policy=copy.deepcopy(existing), operator_subscription_confirmed=True)
        result = self.module().prepare(data)
        statements = result["sns_topic_policy"]["Statement"]
        self.assertEqual(statements[0], existing["Statement"][0])
        publish = statements[-1]
        self.assertEqual(publish["Principal"], {"Service": "cloudwatch.amazonaws.com"})
        self.assertEqual(publish["Condition"]["StringEquals"]["aws:SourceAccount"], "123456789012")
        self.assertEqual(len(publish["Condition"]["ArnEquals"]["aws:SourceArn"]), 6)
        self.assertNotIn("*", json.dumps(publish))
        self.assertEqual(data["notification"]["existing_topic_policy"], existing)
        for alarm in result["alarm_requests"]:
            self.assertTrue(alarm["ActionsEnabled"])
            self.assertEqual(alarm["AlarmActions"], [data["notification"]["topic_arn"]])
            self.assertEqual(alarm["OKActions"], alarm["AlarmActions"])
            self.assertEqual(alarm["InsufficientDataActions"], [])

    def test_alarm_queries_cover_service_absence_low_traffic_and_readiness_with_exact_dimensions(self):
        result = self.module().prepare(fixture())
        alarms = {a["AlarmName"]: a for a in result["alarm_requests"]}
        ready = alarms["chef-world-ops-api-ready"]
        self.assertEqual((ready["MetricName"], ready["Statistic"], ready["Threshold"]), ("HealthyHostCount", "Minimum", 1))
        self.assertEqual((ready["Period"], ready["DatapointsToAlarm"], ready["EvaluationPeriods"]), (60, 2, 3))
        self.assertEqual(ready["TreatMissingData"], "breaching")
        self.assertEqual(dict((d["Name"], d["Value"]) for d in ready["Dimensions"]), {
            "LoadBalancer": "app/cooking-load-balancer/0123456789abcdef",
            "TargetGroup": "targetgroup/cooking-target-group/0123456789abcdef",
        })
        errors = alarms["chef-world-ops-http-5xx"]
        self.assertEqual(errors["Threshold"], 5)
        self.assertEqual(errors["Metrics"][-1]["Expression"], "FILL(target_errors,0)+FILL(alb_errors,0)")
        worker = alarms["chef-world-ops-worker-resource"]
        self.assertEqual(worker["Metrics"][-1]["Expression"], "FILL(memory,100)")
        self.assertEqual((worker["DatapointsToAlarm"], worker["EvaluationPeriods"]), (3, 4))
        database = alarms["chef-world-ops-db-cpu"]
        self.assertEqual(database["Metrics"][-1]["Expression"], "FILL(cpu,100)")
        self.assertEqual((database["DatapointsToAlarm"], database["EvaluationPeriods"]), (3, 4))
        self.assertNotIn("ECS/ContainerInsights", json.dumps(result))

    def test_cross_account_inputs_and_account_email_topic_are_rejected(self):
        for key in ("target_group_arn", "load_balancer_arn"):
            data = fixture(); data[key] = data[key].replace("123456789012", "999999999999")
            with self.assertRaises(ValueError): self.module().prepare(data)
        data = fixture(); data["notification"]["topic_arn"] = "arn:aws:sns:us-east-1:123456789012:chef-world-account-mail-events"
        with self.assertRaises(ValueError): self.module().prepare(data)
        data = fixture(); data["database_url"] = "sensitive-input"
        with self.assertRaises(ValueError): self.module().prepare(data)

    def test_cli_emits_reviewable_files_without_network_or_mutation(self):
        self.module()
        with tempfile.TemporaryDirectory() as root:
            root = Path(root); source = root / "resources.json"; output = root / "plan"
            source.write_text(json.dumps(fixture()))
            result = subprocess.run([sys.executable, str(SOURCE), "--input", str(source), "--output-dir", str(output)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(len(list((output / "alarms").glob("*.json"))), 6)
            self.assertEqual(json.loads((output / "rds-modify.json").read_text())["BackupRetentionPeriod"], 7)
            self.assertFalse(json.loads((output / "plan.json").read_text())["apply_supported"])
            self.assertFalse(json.loads((output / "plan.json").read_text())["notification_ready"])

    def test_conflicting_publish_policy_and_ambiguous_confirmation_fail_closed(self):
        data = fixture()
        data["notification"]["existing_topic_policy"] = {
            "Version": "2012-10-17", "Statement": [{"Sid": "ChefWorldCloudWatchOpsAlarms", "Effect": "Allow"}]}
        with self.assertRaises(ValueError): self.module().prepare(data)
        for value in ("true", 1, None):
            data = fixture(); data["notification"]["operator_subscription_confirmed"] = value
            with self.assertRaises(ValueError): self.module().prepare(data)

    def test_existing_output_directory_is_never_reused(self):
        self.module()
        with tempfile.TemporaryDirectory() as root:
            root = Path(root); source = root / "resources.json"; output = root / "plan"
            output.mkdir(); sentinel = output / "rds-modify.json"; sentinel.write_text("keep")
            source.write_text(json.dumps(fixture()))
            result = subprocess.run([sys.executable, str(SOURCE), "--input", str(source), "--output-dir", str(output)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(sentinel.read_text(), "keep")
