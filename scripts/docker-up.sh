#!/usr/bin/env bash
# Run from repo root (or anywhere): ./scripts/docker-up.sh
#
# Docker Hub sometimes returns 502 on https://auth.docker.io/token — that is outside
# this repo. This script retries "compose up --build" so transient failures usually succeed.
#
# Env:
#   DOCKER_UP_RETRIES   — default 6
#   DOCKER_UP_DELAY_SEC — seconds between attempts, default 10
#
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

MAX="${DOCKER_UP_RETRIES:-6}"
DELAY="${DOCKER_UP_DELAY_SEC:-10}"

for attempt in $(seq 1 "$MAX"); do
  echo ""
  echo ">>> docker compose up --build -d  (attempt ${attempt}/${MAX})"
  if docker compose up --build -d; then
    echo ">>> Stack is up."
    exit 0
  fi
  if [[ "$attempt" -lt "$MAX" ]]; then
    echo ">>> Failed. Often a Docker Hub 502 — waiting ${DELAY}s before retry..."
    sleep "$DELAY"
  fi
done

echo ">>> Giving up after ${MAX} attempts. Try again later or: docker pull node:20-alpine"
exit 1
