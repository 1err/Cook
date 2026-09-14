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
        if os.environ.get("CONCURRENT_RELEASE") and call_count > 1 and not completed:
            current_task = task.replace(":2", ":3")
        print(json.dumps({"services":[{"taskDefinition":current_task, "desiredCount":1, "runningCount":1, "pendingCount":0, "deployments":[deployment]}], "failures":[]}))
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
    elif op == ["ecs", "update-service"]:
        assert args[args.index("--task-definition")+1] == task
        print("deployment-new")
    elif op == ["ecs", "list-tasks"]:
        print(json.dumps({"taskArns":["arn:task:one"]}))
    elif op == ["ecs", "describe-tasks"]:
        print(json.dumps({"tasks":[{"taskDefinitionArn":task, "containers":[{"name":"cooking-backend", "imageDigest": "sha256:" + "b" * 64 if os.environ.get("WRONG_DIGEST") else digest}]}], "failures":[]}))
    elif op == ["ecs", "wait"]:
        pass
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
        return subprocess.run(["bash", str(self.root / "scripts/deploy-backend.sh")], cwd=self.root / "backend", input="y\n", text=True, capture_output=True, timeout=15, env={**os.environ, "PATH":str(self.root / "bin") + os.pathsep + os.environ["PATH"], "TEST_ROOT":str(self.root), "ACCOUNT":"123456789012", **env})

    def calls(self):
        p = self.root / "calls.jsonl"
        return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []

    def write_overrides(self, contents):
        path = self.root / "overrides.json"
        path.write_text(contents)
        path.chmod(0o600)
        return str(path)

    def task_with_environment(self):
        backend = {"name":"cooking-backend", "image":"123456789012.dkr.ecr.us-east-1.amazonaws.com/cooking-backend:old", "essential":True,
                   "environment":[{"name":"KEEP_ENV", "value":"existing-private-value"}, {"name":"APP_ENV", "value":"development"}],
                   "secrets":[{"name":"PROVIDER_SECRET", "valueFrom":"arn:aws:ssm:us-east-1:123456789012:parameter/provider"}]}
        sidecar = {"name":"sidecar", "image":"sidecar:unchanged", "environment":[{"name":"APP_ENV", "value":"sidecar-setting"}]}
        fixture = {"taskDefinition":{"family":"cooking", "taskDefinitionArn":TASK.replace(":2", ":1"), "revision":1, "containerDefinitions":[backend, sidecar]},
                   "tags":[{"key":"team", "value":"cooking"}]}
        (self.root / "task-fixture.json").write_text(json.dumps(fixture))
        return backend, sidecar, fixture["tags"]

    def assert_no_build_or_registration(self):
        self.assertFalse(any(call[0] == "docker" or call[1:3] in (["ecr", "get-login-password"], ["ecs", "register-task-definition"], ["ecs", "update-service"]) for call in self.calls()))

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
