"""Security checks report only file paths and finding types, never secret values."""
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("check_repository", Path(__file__).resolve().parents[1] / "check-repository.py")


class RepositoryHygieneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(cls.module)

    def test_env_examples_remain_allowed_but_real_env_files_do_not(self):
        self.assertEqual(self.module.scan_file("backend/.env.production", b"PLACEHOLDER=true"), ["tracked environment file"])
        self.assertEqual(self.module.scan_file("apps/web/.env.local.example", b"EXAMPLE=true"), [])

    def test_token_finding_contains_no_token_material(self):
        token = "ghp_" + "A" * 36
        findings = self.module.scan_file("backend/app/example.py", token.encode())
        self.assertEqual(findings, ["potential GitHub token"])
        self.assertNotIn(token, str(findings))

    def test_virtualenv_and_private_key_are_reported(self):
        self.assertIn("tracked virtual environment", self.module.scan_file("backend/.venv_fresh/lib/test.py", b""))
        marker = b"-----BEGIN " + b"PRIVATE KEY-----"
        self.assertIn("potential private key", self.module.scan_file("config.pem", marker))


if __name__ == "__main__":
    unittest.main()
