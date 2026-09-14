#!/usr/bin/env python3
"""Verify Docker ignore rules using harmless fixture files and BuildKit itself."""
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CASES = {
    "backend": {
        "ignore": ROOT / "backend/.dockerignore",
        "blocked": [".env", ".env.production", "nested/.env.local", ".venv/lib/file.py", ".venv_fresh/lib/file.py", "uploads/private.png", "data/cache.db", "tests/test_example.py"],
        "allowed": ["app/main.py", ".env.example", ".env.local.example"],
    },
    "root": {
        "ignore": ROOT / ".dockerignore",
        "blocked": ["backend/.env", "apps/web/.env.local", "backend/.venv_fresh/lib/file.py", "backups/local.py", "backend/uploads/private.png", ".worktrees/local.py", "apps/web/node_modules/local.js"],
        "allowed": ["apps/web/app/page.tsx", "apps/web/.env.local.example", "backend/.env.example"],
    },
}


def main():
    for name, case in CASES.items():
        with tempfile.TemporaryDirectory(prefix="cooking-context-") as temporary:
            base = Path(temporary)
            context = base / "context"
            context.mkdir()
            shutil.copy(case["ignore"], context / ".dockerignore")
            (context / "Dockerfile").write_text("FROM scratch\nCOPY . /\n")
            for relative in case["blocked"] + case["allowed"]:
                path = context / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("harmless fixture\n")
            result = subprocess.run(["docker", "build", "--output", f"type=local,dest={base / 'output'}", str(context)], text=True, capture_output=True, timeout=120)
            if result.returncode:
                raise RuntimeError(f"{name} context build failed:\n{result.stderr}")
            for relative in case["blocked"]:
                assert not (base / "output" / relative).exists(), f"{name}: sensitive fixture was included: {relative}"
            for relative in case["allowed"]:
                assert (base / "output" / relative).exists(), f"{name}: required source/example was excluded: {relative}"
            print(f"{name}: {len(case['blocked'])} private paths excluded; {len(case['allowed'])} source/example paths preserved")


if __name__ == "__main__":
    main()
