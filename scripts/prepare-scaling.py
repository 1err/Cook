#!/usr/bin/env python3
"""Produce reviewable ECS/CloudWatch request bodies; never call AWS or apply.

Input is a sanitized JSON object (see tests/test_prepare_scaling.py fixture).
All cost estimates must be explicit USD/month, including zero where verified.
AWS fixed excludes the separately priced API/worker/variable/release costs;
include RDS, ALB, NAT/endpoints, storage and unrelated account charges as relevant.
Estimates use max two API tasks all month, one worker, and release overlap.
Historical partial-month AWS spend is not an acceptable monthly estimate.
"""
import argparse
import json
import math
from pathlib import Path
import re
import sys

COST_KEYS = {"aws_fixed", "api_per_task", "worker", "aws_variable", "vercel",
             "ai", "release_overlap", "contingency"}
RESOURCE_KEYS = {"region", "account_id", "cluster", "api_service", "worker_service",
                 "worker_task_definition", "subnets", "security_groups",
                 "database_identifier", "alarm_topic_arn", "costs_usd_monthly"}


def _match(value, pattern, field):
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise ValueError(f"Invalid sanitized {field}")
    return value


def prepare(data, profile):
    if not isinstance(data, dict) or set(data) != RESOURCE_KEYS:
        raise ValueError("Supply exactly the documented sanitized resource fields")
    if profile not in ("cheap", "api-ha"):
        raise ValueError("Profile must be cheap or api-ha")
    region = _match(data["region"], r"[a-z]{2}-[a-z]+-\d", "region")
    account = _match(data["account_id"], r"\d{12}", "account_id")
    for key in ("cluster", "api_service", "worker_service", "database_identifier"):
        _match(data[key], r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", key)
    _match(data["worker_task_definition"], rf"arn:aws:ecs:{region}:{account}:task-definition/[A-Za-z0-9_-]+:[1-9]\d*", "worker_task_definition")
    _match(data["alarm_topic_arn"], rf"arn:aws:sns:{region}:{account}:[A-Za-z0-9_-]+", "alarm_topic_arn")
    subnets = data["subnets"]
    groups = data["security_groups"]
    if not isinstance(subnets, list) or not 1 <= len(subnets) <= 16:
        raise ValueError("Supply one to sixteen subnet/zone pairs")
    for subnet in subnets:
        if not isinstance(subnet, dict) or set(subnet) != {"id", "az"}:
            raise ValueError("Subnet entries require only id and az")
        _match(subnet["id"], r"subnet-[a-f0-9]+", "subnet")
        _match(subnet["az"], re.escape(region) + r"[a-z]", "availability zone")
    if len({s["id"] for s in subnets}) != len(subnets):
        raise ValueError("Subnet IDs must be distinct")
    if not isinstance(groups, list) or not 1 <= len(groups) <= 5:
        raise ValueError("Supply one to five security groups")
    for group in groups:
        _match(group, r"sg-[a-f0-9]+", "security group")
    if profile == "api-ha" and len({s["az"] for s in subnets}) < 2:
        raise ValueError("API HA preparation requires at least two availability zones")
    costs = data["costs_usd_monthly"]
    if not isinstance(costs, dict) or set(costs) != COST_KEYS:
        raise ValueError("All AWS, Vercel, AI, release and contingency estimates are required")
    for amount in costs.values():
        if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not math.isfinite(amount) or amount < 0:
            raise ValueError("Monthly estimates must be known finite nonnegative USD numbers")
    total = sum(costs.values()) + costs["api_per_task"]  # two API replicas
    if total > 150:
        raise ValueError("Estimated total exceeds the USD 150 monthly ceiling")
    minimum = 1 if profile == "cheap" else 2
    resource = f"service/{data['cluster']}/{data['api_service']}"
    service_dims = [{"Name":"ClusterName", "Value":data["cluster"]},
                    {"Name":"ServiceName", "Value":data["api_service"]}]
    db_dims = [{"Name":"DBInstanceIdentifier", "Value":data["database_identifier"]}]

    def alarm(suffix, namespace, metric, dimensions, threshold, comparison="GreaterThanThreshold"):
        return {"AlarmName": f"{data['cluster']}-{suffix}", "Namespace":namespace,
                "MetricName":metric, "Dimensions":dimensions, "Statistic":"Average",
                "Period":60, "EvaluationPeriods":3, "Threshold":threshold,
                "ComparisonOperator":comparison, "TreatMissingData":"breaching",
                "AlarmActions":[data["alarm_topic_arn"]]}

    return {
        "dry_run": True,
        "apply_supported": False,
        "profile": profile,
        "region": region,
        "budget": {"ceiling_usd":150, "estimated_monthly_usd":round(total, 2),
                   "estimates_usd_monthly":costs, "estimated_at_max_api_tasks":2,
                   "verified_billing":False},
        "availability": {"api_minimum_replicas":minimum, "database_ha":False,
                         "qualified":False, "note":"The existing single-AZ RDS remains a failure domain. Multiple API zones do not provide database HA."},
        "scalable_target": {"ServiceNamespace":"ecs", "ResourceId":resource,
                            "ScalableDimension":"ecs:service:DesiredCount", "MinCapacity":minimum, "MaxCapacity":2},
        "scaling_policy": {"PolicyName":"bounded-api-cpu", "ServiceNamespace":"ecs", "ResourceId":resource,
                           "ScalableDimension":"ecs:service:DesiredCount", "PolicyType":"TargetTrackingScaling",
                           "TargetTrackingScalingPolicyConfiguration":{"TargetValue":60,
                               "PredefinedMetricSpecification":{"PredefinedMetricType":"ECSServiceAverageCPUUtilization"},
                               "ScaleOutCooldown":60, "ScaleInCooldown":300}},
        "api_service_update": {"cluster":data["cluster"], "service":data["api_service"], "desiredCount":minimum,
                              "availabilityZoneRebalancing":"ENABLED",
                              "networkConfiguration":{"awsvpcConfiguration":{"subnets":[s["id"] for s in subnets],
                                  "securityGroups":groups, "assignPublicIp":"DISABLED"}},
                              "deploymentConfiguration":{"minimumHealthyPercent":100, "maximumPercent":200,
                                  "deploymentCircuitBreaker":{"enable":True, "rollback":True}}},
        "worker_service": {"cluster":data["cluster"], "serviceName":data["worker_service"],
                           "taskDefinition":data["worker_task_definition"], "desiredCount":1,
                           "launchType":"FARGATE", "schedulingStrategy":"REPLICA",
                           "deploymentConfiguration":{"minimumHealthyPercent":0, "maximumPercent":100},
                           "networkConfiguration":{"awsvpcConfiguration":{"subnets":[s["id"] for s in subnets],
                               "securityGroups":groups, "assignPublicIp":"DISABLED"}}},
        "worker_task_requirements": {"command":["python", "-m", "app.jobs.worker"],
                                     "api_http_healthcheck":"disabled; use worker heartbeat healthcheck",
                                     "image":"same immutable digest as the qualified API release",
                                     "database_pool_size":2, "database_max_overflow":0},
        "alarms": [alarm("api-cpu", "AWS/ECS", "CPUUtilization", service_dims, 80),
                   alarm("api-memory", "AWS/ECS", "MemoryUtilization", service_dims, 80),
                   alarm("db-connections", "AWS/RDS", "DatabaseConnections", db_dims, 40),
                   alarm("db-free-storage", "AWS/RDS", "FreeStorageSpace", db_dims, 3 * 1024**3, "LessThanThreshold"),
                   alarm("worker-missing", "ECS/ContainerInsights", "RunningTaskCount",
                         [{"Name":"ClusterName", "Value":data["cluster"]}, {"Name":"ServiceName", "Value":data["worker_service"]}], 1, "LessThanThreshold")],
        "required_before_apply": [
            "Independent operator review: this file cannot apply changes.",
            "Verify every monthly estimate from current AWS/Vercel/provider inputs; include Container Insights, alarms, logs, transfer and private egress.",
            "Verify subnet/AZ ownership and private DB/provider access; supplied identifiers are syntax-checked, not queried.",
            "Verify the API uses these availability zones and the load balancer health path /ready with graceful draining.",
            "Verify DB connection budget permits four overlapping API tasks at max rollout, one worker, migration and administration.",
            "Verify worker task definition command, healthcheck, secrets and immutable image; this preparation does not register a worker definition.",
            "Enable and budget Container Insights for RunningTaskCount, or replace with a verified worker heartbeat metric.",
            "Add measured route latency/error, DB pool wait, queue depth/age, AI reservation and spend alarms before qualification.",
            "Validate alarm delivery and actual cross-zone task placement in staging; run migration/failure/load tests before capacity claims.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--profile", choices=("cheap", "api-ha"), default="cheap")
    args = parser.parse_args()
    try:
        result = prepare(json.loads(args.input.read_text()), args.profile)
    except (OSError, ValueError, TypeError):
        # Inputs must not contain secrets; still avoid echoing invalid content.
        print("Preparation refused: sanitized resources and complete monthly estimates at or below USD 150 are required.", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
