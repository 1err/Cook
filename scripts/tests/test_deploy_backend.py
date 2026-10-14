"""Exercise release safety with a real temporary git repo and fake cloud CLIs."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "deploy-backend.sh"
DIGEST = "sha256:" + "a" * 64
TASK = "arn:aws:ecs:us-east-1:123456789012:task-definition/cooking:2"
FAKE_CLI = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
name = pathlib.Path(sys.argv[0]).name
root = pathlib.Path(os.environ["TEST_ROOT"])
with (root / "calls.jsonl").open("a") as f:
    f.write(json.dumps([name, *args]) + "\n")
digest = "sha256:" + "a" * 64
task = "arn:aws:ecs:us-east-1:123456789012:task-definition/cooking:2"
if name == "docker":
    if args[:2] == ["buildx", "build"]:
        context = pathlib.Path(args[-1])
        assert context.is_absolute(), "build must use an isolated committed context"
        assert (context / "app.py").read_text() == "COMMITTED = True\n"
        assert not (context / ".env").exists(), "local secrets reached build context"
        if os.environ.get("ASSERT_ARCHIVE_MODES"):
            for entry in context.rglob("*"):
                required = 0o005 if entry.is_dir() else 0o004
                assert entry.stat().st_mode & required == required, "archived source must be readable/searchable by container non-root user"
        for private_file in context.parent.glob("*.json"):
            assert private_file.stat().st_mode & 0o077 == 0, "release JSON must remain private"
        if os.environ.get("MUTATE_OVERRIDES"):
            pathlib.Path(os.environ["TASK_ENV_OVERRIDES_FILE"]).write_text('{"APP_ENV":"changed-after-validation"}')
        if "--metadata-file" in args:
            pathlib.Path(args[args.index("--metadata-file")+1]).write_text(json.dumps({"containerimage.digest":digest}))
    elif args and args[0] == "login":
        sys.stdin.read()
elif name == "curl":
    print(os.environ.get("PROBE_STATUS", "401") if "/users/" in args[-1] else "200", end="")
elif name == "aws":
    op = args[:2]
    if op == ["sts", "get-caller-identity"]:
        print("123456789012")
    elif op == ["ecr", "get-login-password"]:
        print("FAKE_PASSWORD")
    elif op == ["ecr", "describe-images"]:
        if os.environ.get("ECR_LOOKUP_FAILED"):
            sys.exit(42)
        if os.environ.get("MISSING_IMAGE_TAG"):
            print("None")
            sys.exit(0)
        print("sha256:" + "b" * 64 if os.environ.get("REPLACED_TAG") else digest)
    elif op == ["ecs", "describe-services"]:
        completed = any(json.loads(line)[1:3] == ["ecs", "update-service"] for line in (root / "calls.jsonl").read_text().splitlines())
        deployment = {"id":"deployment-new", "status":"PRIMARY", "taskDefinition":task, "rolloutState":"COMPLETED"}
        if os.environ.get("ROLLBACK"):
            deployment["taskDefinition"] = task.replace(":2", ":1")
        call_count = sum(json.loads(line)[1:3] == ["ecs", "describe-services"] for line in (root / "calls.jsonl").read_text().splitlines())
        current_task = task if completed else task.replace(":2", ":1")
        if ((os.environ.get("CONCURRENT_RELEASE") and call_count > 1) or (os.environ.get("CONCURRENT_MIGRATION") and call_count > 3)) and not completed:
            current_task = task.replace(":2", ":3")
        service = {"taskDefinition":current_task, "desiredCount":1, "runningCount":1, "pendingCount":0, "deployments":[deployment], "launchType":"FARGATE", "platformVersion":"1.4.0", "networkConfiguration":{"awsvpcConfiguration":{"subnets":["subnet-private", "subnet-private-2"], "securityGroups":["sg-private"], "assignPublicIp":"DISABLED"}}}
        if os.environ.get("CAPACITY_PROVIDER"):
            service.pop("launchType")
            service["capacityProviderStrategy"] = [{"capacityProvider":"FARGATE", "weight":1, "base":1}]
        if os.environ.get("MISSING_MIGRATION_NETWORK"):
            service["networkConfiguration"]["awsvpcConfiguration"]["securityGroups"] = []
        print(json.dumps({"services":[service], "failures":[]}))
    elif op == ["ecs", "describe-task-definition"]:
        fixture = root / "task-fixture.json"
        if fixture.exists():
            print(fixture.read_text())
        else:
            print(json.dumps({"taskDefinition":{"family":"cooking", "taskDefinitionArn":task.replace(":2", ":1"), "revision":1, "status":"ACTIVE", "requiresAttributes":[], "compatibilities":["FARGATE"], "registeredAt":"2020-01-01", "registeredBy":"test", "containerDefinitions":[{"name":"cooking-backend", "image":"old:latest", "essential":True}]}, "tags":[{"key":"team", "value":"cooking"}]}))
    elif op == ["ecs", "register-task-definition"]:
        payload = json.loads(pathlib.Path(args[args.index("--cli-input-json")+1].removeprefix("file://")).read_text())
        assert payload["containerDefinitions"][0]["image"].endswith("@" + digest)
        assert "revision" not in payload and "taskDefinitionArn" not in payload
        (root / "registered.json").write_text(json.dumps(payload))
        print(task)
    elif op == ["ecs", "run-task"]:
        payload = json.loads(pathlib.Path(args[args.index("--cli-input-json")+1].removeprefix("file://")).read_text())
        (root / "migration-run.json").write_text(json.dumps(payload))
        print(json.dumps({"tasks":[] if os.environ.get("MIGRATION_RUN_FAILURE") else [{"taskArn":"arn:task:migration"}], "failures":[{"reason":"failed"}] if os.environ.get("MIGRATION_RUN_FAILURE") else []}))
    elif op == ["ecs", "stop-task"]:
        pass
    elif op == ["ecs", "update-service"]:
        assert args[args.index("--task-definition")+1] == task
        print("deployment-new")
    elif op == ["ecs", "list-tasks"]:
        print(json.dumps({"taskArns":["arn:task:one"]}))
    elif op == ["ecs", "describe-tasks"] and "arn:task:migration" in args:
        result = {"tasks":[{"taskArn":"arn:task:migration", "taskDefinitionArn":task, "lastStatus":"RUNNING" if os.environ.get("MIGRATION_NOT_STOPPED") else "STOPPED", "stopCode":"TaskFailedToStart" if os.environ.get("MIGRATION_START_FAILURE") else "EssentialContainerExited", "containers":[{"name":"cooking-backend", "lastStatus":"STOPPED", "exitCode":1 if os.environ.get("MIGRATION_NONZERO") else 0, "imageDigest":"sha256:" + "b" * 64 if os.environ.get("MIGRATION_WRONG_DIGEST") else digest}]}], "failures":[{"reason":"missing"}] if os.environ.get("MIGRATION_DESCRIBE_FAILURE") else []}
        replacement = root / "migration-result.json"
        if replacement.exists():
            result = json.loads(replacement.read_text())
        print(json.dumps(result))
    elif op == ["ecs", "describe-tasks"]:
        print(json.dumps({"tasks":[{"taskDefinitionArn":task, "containers":[{"name":"cooking-backend", "imageDigest": "sha256:" + "b" * 64 if os.environ.get("WRONG_DIGEST") else digest}]}], "failures":[]}))
    elif op == ["ecs", "wait"]:
        if "tasks-stopped" in args and os.environ.get("MIGRATION_TIMEOUT"):
            sys.exit(255)
    else:
        raise RuntimeError("Unhandled fake AWS command: " + repr(args))
'''


class DeploySafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "backend").mkdir()
        (self.root / "scripts").mkdir()
        (self.root / "bin").mkdir()
        shutil.copy(SOURCE, self.root / "scripts/deploy-backend.sh")
        (self.root / "backend/app.py").write_text("COMMITTED = True\n")
        (self.root / ".gitignore").write_text(".env\nbin/\ncalls.jsonl\nregistered.json\n")
        self.git("init", "-q")
        self.git("add", ".")
        self.git("-c", "user.name=Release Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture")
        (self.root / "backend/.env").write_text("TEST_ONLY_SECRET=must-not-be-copied\n")
        for name in ("aws", "docker", "curl"):
            path = self.root / "bin" / name
            path.write_text(FAKE_CLI)
            path.chmod(0o755)

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True, text=True)

    def deploy(self, **env):
        return subprocess.run(["bash", str(self.root / "scripts/deploy-backend.sh")], cwd=self.root / "backend", input="y\n", text=True, capture_output=True, timeout=15, env={**os.environ, "PATH":str(self.root / "bin") + os.pathsep + os.environ["PATH"], "TEST_ROOT":str(self.root), "ACCOUNT":"123456789012", "MIGRATION_SAFE_SIDECARS":"sidecar", **env})

    def calls(self):
        p = self.root / "calls.jsonl"
        return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []

    def write_overrides(self, contents):
        path = self.root / "overrides.json"
        path.write_text(contents)
        path.chmod(0o600)
        return str(path)

    def task_with_environment(self):
        backend = {"name":"cooking-backend", "image":"123456789012.dkr.ecr.us-east-1.amazonaws.com/cooking-backend:old", "essential":True, "command":["sh", "-c", "alembic upgrade head && uvicorn app.main:app"],
                   "environment":[{"name":"KEEP_ENV", "value":"existing-private-value"}, {"name":"APP_ENV", "value":"development"}],
                   "secrets":[{"name":"PROVIDER_SECRET", "valueFrom":"arn:aws:ssm:us-east-1:123456789012:parameter/provider"}]}
        sidecar = {"name":"sidecar", "image":"sidecar:unchanged", "environment":[{"name":"APP_ENV", "value":"sidecar-setting"}]}
        fixture = {"taskDefinition":{"family":"cooking", "taskDefinitionArn":TASK.replace(":2", ":1"), "revision":1,
                   "networkMode":"awsvpc", "requiresCompatibilities":["FARGATE"], "cpu":"512", "memory":"1024",
                   "taskRoleArn":"arn:aws:iam::123456789012:role/reviewed-task-role", "executionRoleArn":"arn:aws:iam::123456789012:role/reviewed-execution-role",
                   "containerDefinitions":[backend, sidecar]},
                   "tags":[{"key":"team", "value":"cooking"}]}
        (self.root / "task-fixture.json").write_text(json.dumps(fixture))
        return backend, sidecar, fixture["tags"]

    def assert_no_build_or_registration(self):
        self.assertFalse(any(call[0] == "docker" or call[1:3] in (["ecr", "get-login-password"], ["ecs", "register-task-definition"], ["ecs", "update-service"]) for call in self.calls()))

    def test_archive_preserves_non_root_readability_under_private_release_umask(self):
        package = self.root / "backend/package"
        package.mkdir()
        (package / "__init__.py").write_text("ARCHIVED = True\n")
        self.git("add", "backend/package/__init__.py")
        self.git("-c", "user.name=Release Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "nested source")
        result = self.deploy(ASSERT_ARCHIVE_MODES="1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_migration_uses_new_revision_private_network_and_precedes_update(self):
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        migration = self.root / "migration-run.json"
        self.assertTrue(migration.exists(), "release must migrate before updating the API")
        payload = json.loads(migration.read_text())
        self.assertEqual(payload["taskDefinition"], TASK)
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["networkConfiguration"]["awsvpcConfiguration"]["assignPublicIp"], "DISABLED")
        self.assertEqual(payload["overrides"]["containerOverrides"], [{"name":"cooking-backend", "command":["python", "-m", "app.migrate"]}])
        calls = self.calls()
        self.assertLess(next(i for i,c in enumerate(calls) if c[1:3] == ["ecs", "run-task"]), next(i for i,c in enumerate(calls) if c[1:3] == ["ecs", "update-service"]))

    def test_migration_reuses_capacity_provider_platform_and_entire_network(self):
        result = self.deploy(CAPACITY_PROVIDER="1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads((self.root / "migration-run.json").read_text())
        self.assertNotIn("launchType", payload)
        self.assertEqual(payload["capacityProviderStrategy"], [{"capacityProvider":"FARGATE", "weight":1, "base":1}])
        self.assertEqual(payload["platformVersion"], "1.4.0")
        self.assertEqual(payload["networkConfiguration"], {"awsvpcConfiguration":{"subnets":["subnet-private", "subnet-private-2"], "securityGroups":["sg-private"], "assignPublicIp":"DISABLED"}})

    def test_migration_revision_keeps_roles_secrets_and_reviewed_sidecar(self):
        backend, sidecar, _ = self.task_with_environment()
        result = self.deploy(PREBUILT_IMAGE_DIGEST=DIGEST)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        registered = json.loads((self.root / "registered.json").read_text())
        self.assertEqual(registered["taskRoleArn"], "arn:aws:iam::123456789012:role/reviewed-task-role")
        self.assertEqual(registered["executionRoleArn"], "arn:aws:iam::123456789012:role/reviewed-execution-role")
        self.assertEqual(registered["networkMode"], "awsvpc")
        self.assertEqual(registered["containerDefinitions"][0]["secrets"], backend["secrets"])
        self.assertEqual(registered["containerDefinitions"][1], sidecar)
        payload = json.loads((self.root / "migration-run.json").read_text())
        self.assertEqual(payload["taskDefinition"], TASK)
        self.assertEqual(payload["overrides"]["containerOverrides"], [{"name":"cooking-backend", "command":["python", "-m", "app.migrate"]}])
        self.assertNotIn("environment", payload["overrides"]["containerOverrides"][0])
        self.assertNotIn("existing-private-value", result.stdout + result.stderr + json.dumps(self.calls()))

    def test_missing_private_migration_network_fails_before_registration(self):
        result = self.deploy(MISSING_MIGRATION_NETWORK="1")
        self.assertNotEqual(result.returncode, 0)
        self.assert_no_build_or_registration()
        self.assertFalse(any(c[1:3] == ["ecs", "run-task"] for c in self.calls()))

    def test_custom_entrypoint_or_nonessential_backend_cannot_run_migration(self):
        for patch in ({"entryPoint":["sh", "-c"]}, {"essential":False}):
            with self.subTest(patch=patch):
                (self.root / "calls.jsonl").unlink(missing_ok=True)
                self.task_with_environment()
                path = self.root / "task-fixture.json"
                fixture = json.loads(path.read_text())
                fixture["taskDefinition"]["containerDefinitions"][0].update(patch)
                path.write_text(json.dumps(fixture))
                result = self.deploy()
                self.assertNotEqual(result.returncode, 0)
                self.assert_no_build_or_registration()
                self.assertFalse(any(c[1:3] == ["ecs", "run-task"] for c in self.calls()))

    def test_unverifiable_stopped_migration_never_rolls_out(self):
        import copy
        stopped = {"taskArn":"arn:task:migration", "taskDefinitionArn":TASK, "lastStatus":"STOPPED",
                   "stopCode":"EssentialContainerExited", "containers":[{"name":"cooking-backend", "lastStatus":"STOPPED", "exitCode":0, "imageDigest":DIGEST}]}
        for failure in ("wrong-task", "wrong-revision", "missing-exit", "missing-container", "duplicate-container", "multiple-tasks"):
            with self.subTest(failure=failure):
                (self.root / "calls.jsonl").unlink(missing_ok=True)
                item = copy.deepcopy(stopped)
                if failure == "wrong-task": item["taskArn"] = "arn:task:another-release"
                elif failure == "wrong-revision": item["taskDefinitionArn"] = TASK.replace(":2", ":3")
                elif failure == "missing-exit": item["containers"][0].pop("exitCode")
                elif failure == "missing-container": item["containers"] = []
                elif failure == "duplicate-container": item["containers"] *= 2
                tasks = [item, copy.deepcopy(item)] if failure == "multiple-tasks" else [item]
                (self.root / "migration-result.json").write_text(json.dumps({"tasks":tasks, "failures":[]}))
                result = self.deploy()
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("Deploy complete", result.stdout)
                self.assertFalse(any(c[1:3] == ["ecs", "update-service"] for c in self.calls()))
                stops = [c for c in self.calls() if c[1:3] == ["ecs", "stop-task"]]
                self.assertEqual(len(stops), 1)
                self.assertEqual(stops[0][stops[0].index("--task") + 1], "arn:task:migration")

    def test_failed_or_unverifiable_migration_never_updates_service(self):
        for failure in ("MIGRATION_RUN_FAILURE", "MIGRATION_TIMEOUT", "MIGRATION_NOT_STOPPED", "MIGRATION_START_FAILURE", "MIGRATION_NONZERO", "MIGRATION_WRONG_DIGEST", "MIGRATION_DESCRIBE_FAILURE", "CONCURRENT_MIGRATION"):
            with self.subTest(failure=failure):
                (self.root / "calls.jsonl").unlink(missing_ok=True)
                result = self.deploy(**{failure:"1"})
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(c[1:3] == ["ecs", "update-service"] for c in self.calls()))
                if failure == "MIGRATION_TIMEOUT":
                    self.assertTrue(any(c[1:3] == ["ecs", "stop-task"] for c in self.calls()))

    def test_sidecars_require_explicit_migration_safety_review(self):
        self.task_with_environment()
        result = self.deploy(MIGRATION_SAFE_SIDECARS="")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("sidecar", result.stderr.lower())
        self.assert_no_build_or_registration()

    def test_dirty_tracked_backend_is_rejected_before_cloud_access(self):
        (self.root / "backend/app.py").write_text("COMMITTED = False\n")
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("uncommitted", result.stdout + result.stderr)
        self.assertFalse(self.calls(), "dirty code must fail before external calls")

    def test_untracked_backend_source_is_rejected(self):
        (self.root / "backend/new.py").write_text("untracked = True\n")
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.calls())

    def test_committed_context_and_digest_are_used_from_subdirectory(self):
        (self.root / "unrelated-work.txt").write_text("unrelated user work\n")
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads((self.root / "registered.json").read_text())
        self.assertTrue(payload["containerDefinitions"][0]["image"].endswith("@" + DIGEST))
        self.assertEqual(payload["tags"], [{"key":"team", "value":"cooking"}])
        builds = [call for call in self.calls() if call[:3] == ["docker", "buildx", "build"]]
        self.assertEqual(len(builds), 1)
        self.assertFalse(any(":latest" in arg for arg in builds[0]))

    def test_unexpected_http_response_fails_release(self):
        result = self.deploy(PROBE_STATUS="500")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Deploy complete", result.stdout)

    def test_api_task_has_explicit_ecs_liveness_and_graceful_stop(self):
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        container = json.loads((self.root / "registered.json").read_text())["containerDefinitions"][0]
        health = container["healthCheck"]
        self.assertEqual(health["command"][:3], ["CMD", "python", "-c"])
        self.assertIn("http://127.0.0.1:8000/health", health["command"][3])
        self.assertEqual(health["startPeriod"], 60)
        self.assertEqual(container["stopTimeout"], 120)

    def test_ecs_rollback_cannot_report_success(self):
        result = self.deploy(ROLLBACK="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Deploy complete", result.stdout)

    def test_wrong_running_image_digest_fails_release(self):
        result = self.deploy(WRONG_DIGEST="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Deploy complete", result.stdout)

    def test_replaced_registry_tag_cannot_change_built_image(self):
        result = self.deploy(REPLACED_TAG="1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads((self.root / "registered.json").read_text())
        self.assertTrue(payload["containerDefinitions"][0]["image"].endswith("@" + DIGEST))

    def test_prebuilt_digest_verifies_exact_commit_in_selected_registry_and_preserves_task(self):
        backend, sidecar, tags = self.task_with_environment()
        marker = "prebuilt-private-admin-value"
        result = self.deploy(PREBUILT_IMAGE_DIGEST=DIGEST, ACCOUNT="987654321098", REGION="eu-west-1",
                             REPO_NAME="cooking-release", CONTAINER_NAME="cooking-backend",
                             TASK_ENV_OVERRIDES_FILE=self.write_overrides(json.dumps({"APP_ENV":"production", "ADMIN_USER_IDS":marker})))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        calls = self.calls()
        self.assertFalse(any(call[0] == "docker" or call[1:3] == ["ecr", "get-login-password"] for call in calls))
        lookups = [call for call in calls if call[1:3] == ["ecr", "describe-images"]]
        self.assertEqual(len(lookups), 1)
        lookup = lookups[0]
        self.assertEqual(lookup[lookup.index("--registry-id") + 1], "987654321098")
        self.assertEqual(lookup[lookup.index("--repository-name") + 1], "cooking-release")
        self.assertEqual(lookup[lookup.index("--region") + 1], "eu-west-1")
        self.assertEqual(lookup[lookup.index("--image-ids") + 1], "imageTag=" + self.git("rev-parse", "HEAD").stdout.strip())
        self.assertLess(calls.index(lookup), next(i for i, call in enumerate(calls) if call[1:3] == ["ecs", "register-task-definition"]))
        payload = json.loads((self.root / "registered.json").read_text())
        updated = payload["containerDefinitions"][0]
        self.assertEqual(updated["image"], "987654321098.dkr.ecr.eu-west-1.amazonaws.com/cooking-release@" + DIGEST)
        self.assertEqual(updated["environment"], [{"name":"KEEP_ENV", "value":"existing-private-value"}, {"name":"APP_ENV", "value":"production"}, {"name":"ADMIN_USER_IDS", "value":marker}])
        self.assertEqual(updated["secrets"], backend["secrets"])
        self.assertEqual(updated["command"], ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"])
        self.assertEqual(payload["containerDefinitions"][1], sidecar)
        self.assertEqual(payload["tags"], tags)
        self.assertNotIn(marker, result.stdout + result.stderr + json.dumps(calls))

    def test_prebuilt_digest_does_not_require_local_docker(self):
        isolated_bin = self.root / "without-docker"
        isolated_bin.mkdir()
        for name in ("bash", "git", "jq", "dirname", "mktemp", "rm", "mkdir", "tar", "cp", "python3"):
            (isolated_bin / name).symlink_to(shutil.which(name))
        for name in ("aws", "curl"):
            (isolated_bin / name).write_text(FAKE_CLI)
            (isolated_bin / name).chmod(0o755)
        result = self.deploy(PREBUILT_IMAGE_DIGEST=DIGEST, PATH=str(isolated_bin))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(any(call[1:3] == ["ecs", "update-service"] for call in self.calls()))

    def test_invalid_prebuilt_digest_fails_before_cloud_access(self):
        for invalid in ("sha256:abc", "sha256:" + "A" * 64, "sha512:" + "a" * 64,
                        DIGEST + "\n", " " + DIGEST, DIGEST + "extra", "synthetic-private-invalid-digest"):
            with self.subTest(digest_shape=invalid[:10]):
                (self.root / "calls.jsonl").unlink(missing_ok=True)
                result = self.deploy(PREBUILT_IMAGE_DIGEST=invalid, ACCOUNT="")
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.calls(), "invalid digest must fail before cloud access, including account discovery")
                self.assertNotIn(invalid, result.stdout + result.stderr)

    def test_unverified_prebuilt_digest_fails_before_build_or_registration(self):
        for failure in ("REPLACED_TAG", "MISSING_IMAGE_TAG", "ECR_LOOKUP_FAILED"):
            with self.subTest(failure=failure):
                (self.root / "calls.jsonl").unlink(missing_ok=True)
                result = self.deploy(PREBUILT_IMAGE_DIGEST=DIGEST, **{failure:"1"})
                self.assertNotEqual(result.returncode, 0)
                self.assert_no_build_or_registration()
                self.assertNotIn("Deploy complete", result.stdout)

    def test_prebuilt_digest_retains_concurrent_release_and_rollout_guards(self):
        for failure in ("CONCURRENT_RELEASE", "ROLLBACK", "WRONG_DIGEST"):
            with self.subTest(failure=failure):
                (self.root / "calls.jsonl").unlink(missing_ok=True)
                result = self.deploy(PREBUILT_IMAGE_DIGEST=DIGEST, **{failure:"1"})
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("Deploy complete", result.stdout)
                self.assertFalse(any(call[0] == "docker" for call in self.calls()))
                if failure == "CONCURRENT_RELEASE":
                    self.assertFalse(any(call[1:3] in (["ecs", "register-task-definition"], ["ecs", "update-service"]) for call in self.calls()))

    def test_concurrent_service_revision_is_not_overwritten(self):
        result = self.deploy(CONCURRENT_RELEASE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[1:3] == ["ecs", "update-service"] for call in self.calls()))

    def test_environment_overrides_merge_with_image_and_preserve_other_settings(self):
        backend, sidecar, tags = self.task_with_environment()
        marker = "private-new-admin-value"
        overrides = self.write_overrides(json.dumps({"APP_ENV":"production", "ADMIN_USER_IDS":marker, "OPTIONAL_VALUE":""}))
        result = self.deploy(TASK_ENV_OVERRIDES_FILE=overrides)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads((self.root / "registered.json").read_text())
        updated = payload["containerDefinitions"][0]
        self.assertEqual(updated["environment"], [{"name":"KEEP_ENV", "value":"existing-private-value"}, {"name":"APP_ENV", "value":"production"}, {"name":"ADMIN_USER_IDS", "value":marker}, {"name":"OPTIONAL_VALUE", "value":""}])
        self.assertTrue(updated["image"].endswith("@" + DIGEST))
        self.assertEqual(updated["secrets"], backend["secrets"])
        self.assertEqual(updated["command"], ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"])
        self.assertEqual(payload["containerDefinitions"][1], sidecar)
        self.assertEqual(payload["tags"], tags)
        self.assertEqual(sum(call[1:3] == ["ecs", "register-task-definition"] for call in self.calls()), 1)
        self.assertNotIn(marker, result.stdout + result.stderr + json.dumps(self.calls()))
        self.assertNotIn("existing-private-value", result.stdout + result.stderr)

    def test_no_overrides_preserve_environment_and_other_containers(self):
        backend, sidecar, tags = self.task_with_environment()
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads((self.root / "registered.json").read_text())
        self.assertEqual(payload["containerDefinitions"][0]["environment"], backend["environment"])
        self.assertEqual(payload["containerDefinitions"][0]["secrets"], backend["secrets"])
        self.assertEqual(payload["containerDefinitions"][1], sidecar)
        self.assertEqual(payload["tags"], tags)

    def test_invalid_override_payloads_fail_before_build_without_disclosure(self):
        marker = "synthetic-private-validation-value"
        for contents in ('{"APP_ENV": "' + marker, json.dumps([marker]), json.dumps({"APP_ENV":42}),
                         json.dumps({"APP_ENV":None}), json.dumps({"APP_ENV":{"nested":marker}}),
                         json.dumps({"BAD-NAME":marker}), json.dumps({"1INVALID":marker}),
                         json.dumps({"":marker}), json.dumps({"BAD\nNAME":marker}), json.dumps({"VALID\n":marker}),
                         '{}\n{"APP_ENV":"production"}'):
            with self.subTest(contents_type=contents[:12]):
                (self.root / "calls.jsonl").unlink(missing_ok=True)
                result = self.deploy(TASK_ENV_OVERRIDES_FILE=self.write_overrides(contents))
                self.assertNotEqual(result.returncode, 0)
                self.assert_no_build_or_registration()
                self.assertNotIn(marker, result.stdout + result.stderr + json.dumps(self.calls()))

    def test_override_conflicting_with_ecs_secret_fails_before_build(self):
        self.task_with_environment()
        marker = "synthetic-conflicting-secret-value"
        result = self.deploy(TASK_ENV_OVERRIDES_FILE=self.write_overrides(json.dumps({"PROVIDER_SECRET":marker})))
        self.assertNotEqual(result.returncode, 0)
        self.assert_no_build_or_registration()
        self.assertNotIn(marker, result.stdout + result.stderr + json.dumps(self.calls()))

    def test_validated_overrides_are_snapshotted_before_build(self):
        result = self.deploy(TASK_ENV_OVERRIDES_FILE=self.write_overrides('{"APP_ENV":"production"}'), MUTATE_OVERRIDES="1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads((self.root / "overrides.json").read_text()), {"APP_ENV":"changed-after-validation"})
        payload = json.loads((self.root / "registered.json").read_text())
        self.assertEqual(payload["containerDefinitions"][0]["environment"], [{"name":"APP_ENV", "value":"production"}])

    def test_missing_override_file_fails_before_build(self):
        result = self.deploy(TASK_ENV_OVERRIDES_FILE=str(self.root / "missing-private-file.json"))
        self.assertNotEqual(result.returncode, 0)
        self.assert_no_build_or_registration()


if __name__ == "__main__":
    unittest.main()
