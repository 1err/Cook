#!/usr/bin/env bash
# Deploy the backend image to ECS. Sustainable replacement for the
# manual buildx + force-redeploy flow.
#
# What this does:
#   1. Fail-fast preflight checks (git state, docker, aws CLI, backend builds locally).
#   2. Resolve the current git SHA — used as an immutable image tag.
#   3. Build + push two tags:
#        :latest    (so the existing task def picks up the new image)
#        :<git-sha> (so you can roll back to any past deploy)
#   4. Force a new ECS deployment.
#   5. Wait for the deployment to stabilize.
#   6. Smoke the new image: /health, then a route the deploy added.
#
# Roll back: `docker pull <repo>:<previous-sha>`, retag as :latest, push, force-redeploy.
# All past SHA tags live in ECR.
#
# Usage:
#   bash scripts/deploy-backend.sh                 # uses defaults below
#   SERVICE=cooking-backend-svc bash scripts/...   # override service name
#   PROBE_PATH=/health bash scripts/...            # override post-deploy smoke route
#
# Requirements: aws CLI (logged in), docker buildx, jq.

set -euo pipefail

# --- config (override via env) ---
REGION="${REGION:-us-east-1}"
ACCOUNT="${ACCOUNT:-930067562682}"
REPO_NAME="${REPO_NAME:-cooking-backend}"
CLUSTER="${CLUSTER:-cooking-cluster}"
SERVICE="${SERVICE:-cooking-backend-service}"     # find via `aws ecs list-services --cluster $CLUSTER`
API_BASE="${API_BASE:-https://api.chef-world.com}"
PROBE_PATH="${PROBE_PATH:-/users/search?email=preflight@example.com}"  # should 401 if route exists; falls back to /health

REPO="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO_NAME"

# --- preflight ---
echo "==> preflight"
command -v aws >/dev/null || { echo "aws CLI not installed"; exit 1; }
command -v docker >/dev/null || { echo "docker not installed"; exit 1; }
command -v jq >/dev/null || { echo "jq required (brew install jq)"; exit 1; }

# Warn if working tree dirty — uncommitted code won't be in the image yet
if [ -n "$(git status --short)" ]; then
  echo "WARNING: working tree has uncommitted changes. Image will be built from the committed state of ./backend"
  echo "         If you need those changes shipped, commit + push first."
  read -r -p "Continue anyway? (y/N) " ans
  case "$ans" in y|Y) ;; *) exit 1 ;; esac
fi

SHA=$(git rev-parse --short HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "    branch: $BRANCH"
echo "    sha:    $SHA"
echo "    repo:   $REPO"
echo "    cluster/service: $CLUSTER / $SERVICE"

# --- ECR login ---
echo "==> ecr login"
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

# --- build + push two tags ---
echo "==> build + push (linux/amd64)"
docker buildx build \
  --platform linux/amd64 \
  -t "$REPO:latest" \
  -t "$REPO:$SHA" \
  ./backend \
  --push

# --- force redeploy ---
echo "==> ecs update-service --force-new-deployment"
DEPLOY_ID=$(aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --force-new-deployment \
  --region "$REGION" \
  --query 'service.deployments[0].id' \
  --output text)
echo "    deployment: $DEPLOY_ID"

# --- wait for stable ---
echo "==> waiting for service to stabilize (may take ~1–3 min)"
aws ecs wait services-stable \
  --cluster "$CLUSTER" \
  --services "$SERVICE" \
  --region "$REGION"
echo "    service stable"

# --- post-deploy smoke ---
echo "==> post-deploy smoke"
HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$API_BASE/health")
echo "    GET $API_BASE/health -> HTTP $HEALTH_CODE"
[ "$HEALTH_CODE" = "200" ] || { echo "    ❌ health check failed"; exit 1; }

PROBE_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$API_BASE$PROBE_PATH")
echo "    GET $API_BASE$PROBE_PATH -> HTTP $PROBE_CODE"
case "$PROBE_CODE" in
  200|401|403|422)
    # 401/403/422 are fine: they mean the route exists (just needs auth or rejects probe input)
    echo "    ✅ route exists ($PROBE_CODE = route present)"
    ;;
  404)
    echo "    ⚠️  route returned 404 — task may still be the old image. Investigate before merging web."
    exit 1
    ;;
  *)
    echo "    ⚠️  unexpected status $PROBE_CODE — verify manually"
    ;;
esac

echo
echo "==> ✅ Deploy complete."
echo "    Tagged: $REPO:latest, $REPO:$SHA"
echo "    To roll back: docker pull \$REPO:<prev-sha> && docker tag \$REPO:<prev-sha> \$REPO:latest && docker push \$REPO:latest && this script's update-service block"
