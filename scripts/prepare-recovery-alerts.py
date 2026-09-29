#!/usr/bin/env python3
"""Generate reviewable RDS/SNS/CloudWatch requests from sanitized inventory.

This program is offline and cannot apply cloud changes. See docs/recovery-alerts.md.
"""
import argparse
import copy
import json
from pathlib import Path
import re
import sys

TOPIC_NAME = "chef-world-ops-alerts"
ALARM_PREFIX = "chef-world-ops-"
POLICY_SID = "ChefWorldCloudWatchOpsAlarms"
FIELDS = {"region", "account_id", "database", "ecs", "load_balancer_arn",
          "target_group_arn", "notification", "existing_alarm_names"}


def exact_fields(value, fields):
    if not isinstance(value, dict) or set(value) != set(fields):
        raise ValueError("Supply exactly the documented sanitized fields")


def match(value, pattern):
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise ValueError("Invalid sanitized identifier")
    return value


def boolean(value):
    if type(value) is not bool:
        raise ValueError("Confirmation and protection must be JSON booleans")
    return value


def prepare(data):
    exact_fields(data, FIELDS)
    region = match(data["region"], r"[a-z]{2}-[a-z]+-\d")
    account = match(data["account_id"], r"\d{12}")
    db, ecs, notification = data["database"], data["ecs"], data["notification"]
    exact_fields(db, {"identifier", "status", "backup_retention_days", "deletion_protection", "pending_modifications"})
    exact_fields(ecs, {"cluster", "api_service", "worker_service"})
    exact_fields(notification, {"topic_arn", "operator_subscription_confirmed", "existing_topic_policy"})
    for value in [db["identifier"], *ecs.values()]:
        match(value, r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}")
    if db["status"] != "available" or db["pending_modifications"] != {}:
        raise ValueError("Database must be available with no pending modifications")
    retention = db["backup_retention_days"]
    if type(retention) is not int or not 1 <= retention <= 35:
        raise ValueError("Existing automated backups must already be enabled")
    protection = boolean(db["deletion_protection"])
    confirmed = boolean(notification["operator_subscription_confirmed"])
    topic = match(notification["topic_arn"], rf"arn:aws:sns:{re.escape(region)}:{account}:{TOPIC_NAME}")
    arn_prefix = rf"arn:aws:elasticloadbalancing:{re.escape(region)}:{account}:"
    lb = match(data["load_balancer_arn"], arn_prefix + r"loadbalancer/app/[A-Za-z0-9-]+/[a-f0-9]{16}")
    tg = match(data["target_group_arn"], arn_prefix + r"targetgroup/[A-Za-z0-9-]+/[a-f0-9]{16}")
    existing_names = data["existing_alarm_names"]
    if not isinstance(existing_names, list) or not all(isinstance(n, str) for n in existing_names):
        raise ValueError("Existing alarm names must be a sanitized list")
    lb_dimension = {"Name": "LoadBalancer", "Value": lb.split(":", 5)[5].removeprefix("loadbalancer/")}
    target_dimensions = [lb_dimension, {"Name": "TargetGroup", "Value": tg.split(":", 5)[5]}]
    db_dimensions = [{"Name": "DBInstanceIdentifier", "Value": db["identifier"]}]

    def service_dimensions(service):
        return [{"Name": "ClusterName", "Value": ecs["cluster"]}, {"Name": "ServiceName", "Value": ecs[service]}]

    def alarm(suffix, description, threshold, *, comparison="GreaterThanThreshold", periods=4, points=3, missing="notBreaching"):
        return {"AlarmName": ALARM_PREFIX + suffix, "AlarmDescription": description,
                "ActionsEnabled": confirmed, "AlarmActions": [topic], "OKActions": [topic],
                "InsufficientDataActions": [], "Threshold": threshold,
                "ComparisonOperator": comparison, "EvaluationPeriods": periods,
                "DatapointsToAlarm": points, "TreatMissingData": missing}

    def metric(namespace, name, dimensions, statistic="Average", period=300):
        return {"Namespace": namespace, "MetricName": name, "Dimensions": dimensions,
                "Statistic": statistic, "Period": period}

    def query(identifier, namespace, name, dimensions, statistic="Average"):
        return {"Id": identifier, "MetricStat": {"Metric": {"Namespace": namespace,
                "MetricName": name, "Dimensions": dimensions}, "Period": 300, "Stat": statistic}, "ReturnData": False}

    ready = alarm("api-ready", "No healthy /ready target for 2 of 3 minutes. Check ECS, ALB target health and DB readiness.", 1,
                  comparison="LessThanThreshold", periods=3, points=2, missing="breaching")
    ready.update(metric("AWS/ApplicationELB", "HealthyHostCount", target_dimensions, "Minimum", 60))
    errors = alarm("http-5xx", "At least 5 combined target and ALB 5xx in 5 minutes. Inspect bounded sanitized logs; low-traffic percentage spikes alone do not alert.", 5,
                   comparison="GreaterThanOrEqualToThreshold", periods=1, points=1)
    errors["Metrics"] = [query("target_errors", "AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", target_dimensions, "Sum"),
                         query("alb_errors", "AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count", [lb_dimension], "Sum"),
                         {"Id": "errors", "Expression": "FILL(target_errors,0)+FILL(alb_errors,0)", "Label": "Combined HTTP 5xx", "ReturnData": True}]
    api = alarm("api-memory", "API memory above 90 percent in 3 of 4 five-minute periods. API absence is covered by readiness.", 90)
    api.update(metric("AWS/ECS", "MemoryUtilization", service_dimensions("api_service")))
    worker = alarm("worker-resource", "Worker memory above 90 percent or metric absent in 3 of 4 five-minute periods. This detects service loss, not stalled queue progress.", 90, missing="breaching")
    worker["Metrics"] = [query("memory", "AWS/ECS", "MemoryUtilization", service_dimensions("worker_service")),
                         {"Id": "worker", "Expression": "FILL(memory,100)", "Label": "Worker memory or missing service metric", "ReturnData": True}]
    storage = alarm("db-free-storage", "RDS free storage below 2 GiB in 2 of 3 five-minute periods. Investigate growth; do not remove historical data as a shortcut.", 2 * 1024**3,
                    comparison="LessThanThreshold", periods=3, points=2)
    storage.update(metric("AWS/RDS", "FreeStorageSpace", db_dimensions, "Minimum"))
    cpu = alarm("db-cpu", "RDS CPU above 85 percent or metric absent in 3 of 4 five-minute periods. Check database availability and pressure; idle RDS emits CPU metrics.", 85, missing="breaching")
    cpu["Metrics"] = [query("cpu", "AWS/RDS", "CPUUtilization", db_dimensions),
                      {"Id": "database", "Expression": "FILL(cpu,100)", "Label": "RDS CPU or missing database metric", "ReturnData": True}]
    alarms = [ready, errors, api, worker, storage, cpu]
    if set(existing_names) & {a["AlarmName"] for a in alarms}:
        raise ValueError("Existing alarm name collision requires operator comparison before replacement")
    publish = {"Sid": POLICY_SID, "Effect": "Allow", "Principal": {"Service": "cloudwatch.amazonaws.com"},
               "Action": "SNS:Publish", "Resource": topic,
               "Condition": {"StringEquals": {"aws:SourceAccount": account},
                             "ArnEquals": {"aws:SourceArn": [f"arn:aws:cloudwatch:{region}:{account}:alarm:{a['AlarmName']}" for a in alarms]}}}
    policy = copy.deepcopy(notification["existing_topic_policy"])
    if policy is None:
        policy = {"Version": "2012-10-17", "Statement": [{"Sid": "OwnerAccess", "Effect": "Allow",
                  "Principal": {"AWS": f"arn:aws:iam::{account}:root"}, "Action": "SNS:*", "Resource": topic}]}
    if not isinstance(policy, dict) or not isinstance(policy.get("Statement"), list) or not all(isinstance(s, dict) for s in policy["Statement"]):
        raise ValueError("Topic policy must contain an existing statement list")
    present = [s for s in policy["Statement"] if s.get("Sid") == POLICY_SID]
    if present and (len(present) != 1 or present[0] != publish):
        raise ValueError("Conflicting CloudWatch policy statement requires operator review")
    if not present:
        policy["Statement"].append(publish)
    request = None if retention >= 7 and protection else {
        "DBInstanceIdentifier": db["identifier"], "BackupRetentionPeriod": max(7, retention),
        "DeletionProtection": True, "ApplyImmediately": True}
    return {"apply_supported": False, "region": region, "notification_ready": confirmed,
            "rds_modify_request": request, "sns_create_topic_request": {"Name": TOPIC_NAME},
            "sns_topic_policy": policy,
            "sns_set_topic_attributes_request": {"TopicArn": topic, "AttributeName": "Policy", "AttributeValue": json.dumps(policy, separators=(",", ":"))},
            "alarm_metric_count": 7, "alarm_requests": alarms,
            "limitations": ["Inventory is syntax-checked offline; recheck live identity and guards before applying.",
                            "Confirmed subscription alone does not establish delivery; run an operator-authorized alarm and recovery drill.",
                            "Seven-day retention accrues prospectively; verify earliest and latest restorable times.",
                            "Worker resource presence does not prove queue progress; custom queue heartbeat remains separate.",
                            "No scaling, network, log retention or historical data changes are included."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        plan = prepare(json.loads(args.input.read_text()))
        # Use a new directory so a no-op cannot leave a stale RDS modification file.
        args.output_dir.mkdir(parents=True, exist_ok=False)
        (args.output_dir / "alarms").mkdir()
        files = {"plan.json": plan, "sns-create-topic.json": plan["sns_create_topic_request"],
                 "sns-topic-policy.json": plan["sns_topic_policy"], "sns-set-topic-attributes.json": plan["sns_set_topic_attributes_request"]}
        if plan["rds_modify_request"] is not None:
            files["rds-modify.json"] = plan["rds_modify_request"]
        for alarm in plan["alarm_requests"]:
            files[f"alarms/{alarm['AlarmName']}.json"] = alarm
        for name, value in files.items():
            (args.output_dir / name).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    except (OSError, ValueError, TypeError):
        print("Preparation refused: check sanitized inventory, empty pending changes, distinct alarm names, and a new output directory.", file=sys.stderr)
        return 2
    print(f"Prepared offline requests in {args.output_dir}; no cloud changes applied.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
