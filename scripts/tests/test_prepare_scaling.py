import importlib.util
from pathlib import Path
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "prepare-scaling.py"


def fixture():
    return {
        "region": "us-east-1", "account_id": "123456789012", "cluster": "cooking-staging",
        "api_service": "cooking-api", "worker_service": "cooking-worker",
        "worker_task_definition": "arn:aws:ecs:us-east-1:123456789012:task-definition/cooking-worker:2",
        "subnets": [{"id":"subnet-abc123", "az":"us-east-1a"}, {"id":"subnet-def456", "az":"us-east-1b"}],
        "security_groups": ["sg-abc123"], "database_identifier":"cooking-staging",
        "alarm_topic_arn":"arn:aws:sns:us-east-1:123456789012:cooking-alerts",
        "costs_usd_monthly": {"aws_fixed":30, "api_per_task":12, "worker":8,
                              "aws_variable":5, "vercel":0, "ai":20,
                              "release_overlap":3, "contingency":15},
    }


class PreparationTests(unittest.TestCase):
    def load(self):
        self.assertTrue(SOURCE.exists(), "dry-run infrastructure preparation is required")
        spec = importlib.util.spec_from_file_location("prepare_scaling", SOURCE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_preparation_binds_max_replicas_and_cost_ceiling_without_applying(self):
        result = self.load().prepare(fixture(), "cheap")
        self.assertTrue(result["dry_run"])
        self.assertEqual(result["budget"]["estimated_monthly_usd"], 105)
        self.assertEqual(result["budget"]["ceiling_usd"], 150)
        target = result["scalable_target"]
        self.assertEqual((target["MinCapacity"], target["MaxCapacity"]), (1, 2))
        self.assertEqual(result["worker_service"]["desiredCount"], 1)
        self.assertFalse(result["availability"]["database_ha"])
        self.assertEqual(result["worker_service"]["networkConfiguration"]["awsvpcConfiguration"]["assignPublicIp"], "DISABLED")

    def test_api_ha_requires_two_zones_but_never_claims_database_ha(self):
        module = self.load()
        value = fixture()
        result = module.prepare(value, "api-ha")
        self.assertEqual(result["scalable_target"]["MinCapacity"], 2)
        self.assertFalse(result["availability"]["database_ha"])
        value["subnets"][1]["az"] = value["subnets"][0]["az"]
        with self.assertRaisesRegex(ValueError, "zones"):
            module.prepare(value, "api-ha")

    def test_unknown_negative_nonfinite_or_over_budget_cost_fails_closed(self):
        module = self.load()
        for cost in (None, -1, float("nan"), float("inf"), "20", True, 151):
            with self.subTest(cost=cost):
                value = fixture()
                value["costs_usd_monthly"]["ai"] = cost
                with self.assertRaises(ValueError):
                    module.prepare(value, "cheap")
        value = fixture()
        del value["costs_usd_monthly"]["vercel"]
        with self.assertRaises(ValueError):
            module.prepare(value, "cheap")

    def test_unsanitized_or_mismatched_resources_are_rejected(self):
        module = self.load()
        for key, value in (("database_url", "secret"), ("account_id", "oops"),
                           ("cluster", "https://example.com"), ("worker_task_definition", "arn:aws:ecs:us-west-2:999999999999:task-definition/w:1")):
            data = fixture()
            data[key] = value
            with self.assertRaises(ValueError):
                module.prepare(data, "cheap")

    def test_required_alarms_cover_cpu_memory_database_and_worker_count(self):
        names = {alarm["MetricName"] for alarm in self.load().prepare(fixture(), "cheap")["alarms"]}
        self.assertTrue({"CPUUtilization", "MemoryUtilization", "DatabaseConnections", "FreeStorageSpace", "RunningTaskCount"} <= names)
