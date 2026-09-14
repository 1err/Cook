#!/usr/bin/env python3
"""Bounded tracked-file hygiene scan; output includes paths and types, never values.

This complements provider secret scanning and dependency audits. It does not
prove the absence of every secret format or scan historical git objects.
"""
from pathlib import Path, PurePosixPath
import re
import subprocess

PATTERNS = {
    "potential private key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "potential AWS access key ID": re.compile(rb"(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])"),
    "potential GitHub token": re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,})\b"),
    "potential OpenAI token": re.compile(rb"\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b"),
}


def scan_file(path: str, content: bytes) -> list[str]:
    parts = PurePosixPath(path).parts
    name = parts[-1]
    findings = []
    if (name == ".env" or name.startswith(".env.")) and not name.endswith((".example", ".sample")):
        findings.append("tracked environment file")
    if any(part.startswith(".venv") or part == "venv" or part.startswith("venv-") for part in parts):
        findings.append("tracked virtual environment")
    findings.extend(kind for kind, pattern in PATTERNS.items() if pattern.search(content))
    return findings


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
    count = 0
    failures = 0
    for relative in filter(None, tracked):
        path = root / relative
        if not path.is_file() or path.is_symlink():
            continue
        # Inspect the complete tracked file; do not print any matching content.
        findings = scan_file(relative, path.read_bytes())
        count += 1
        for finding in findings:
            print(f"{relative}: {finding}")
            failures += 1
    print(f"Checked {count} tracked files; {failures} hygiene findings.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
