#!/usr/bin/env bash
# Build committed backend source and deploy an ECS revision pinned to its image digest.
# Run only when a production deployment is intended. No :latest tag is modified.
# Override REGION, ACCOUNT, REPO_NAME, CLUSTER, SERVICE, API_BASE, PROBE_PATH,
# or CONTAINER_NAME as needed. Requires git, aws CLI, jq and curl; local builds
# also require docker buildx. Optional PREBUILT_IMAGE_DIGEST skips the local build
# only after ECR confirms this committed SHA's tag has that exact sha256 digest.
# Optional TASK_ENV_OVERRIDES_FILE is a private JSON object of env names/string
# values merged into the selected container in the same revision as the image.
set -euo pipefail
umask 077

fail() { echo "ERROR: $*" >&2; exit 1; }
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)
cd "$REPO_ROOT"

# A git archive supplies the image context. Refuse edits that would otherwise be
# silently omitted, but allow unrelated frontend work and ignored local secrets.
DIRTY=$(git status --porcelain --untracked-files=all -- backend scripts/deploy-backend.sh .dockerignore .gitignore)
[ -z "$DIRTY" ] || fail "Backend or release inputs have uncommitted changes. Commit the intended release in an isolated checkout before deploying."
PREBUILT_IMAGE_DIGEST="${PREBUILT_IMAGE_DIGEST:-}"
if [ -n "$PREBUILT_IMAGE_DIGEST" ]; then
  [[ "$PREBUILT_IMAGE_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]] || fail "PREBUILT_IMAGE_DIGEST must be a full lowercase sha256 digest"
fi
for tool in aws jq curl; do
  command -v "$tool" >/dev/null || fail "$tool is required"
done
if [ -z "$PREBUILT_IMAGE_DIGEST" ]; then
  command -v docker >/dev/null || fail "docker is required"
fi

REGION="${REGION:-us-east-1}"
ACCOUNT="${ACCOUNT:-$(aws sts get-caller-identity --query Account --output text)}"
[[ "$ACCOUNT" =~ ^[0-9]{12}$ ]] || fail "ACCOUNT must be a 12-digit AWS account ID"
REPO_NAME="${REPO_NAME:-cooking-backend}"
CLUSTER="${CLUSTER:-cooking-cluster}"
SERVICE="${SERVICE:-cooking-backend-service}"
API_BASE="${API_BASE:-https://api.chef-world.com}"
PROBE_PATH="${PROBE_PATH:-/users/search?email=preflight@example.com}"
REPO="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO_NAME"
SHA=$(git rev-parse HEAD)

# Task definitions may contain secrets. Keep all temporary files private and
# never print their payloads; they are removed on success, failure or interrupt.
RELEASE_TMP=$(mktemp -d)
trap 'rm -rf -- "$RELEASE_TMP"' EXIT
if [ -n "${TASK_ENV_OVERRIDES_FILE:-}" ]; then
  # Validate the private snapshot used later, not a path that can change during
  # a long build. Never pass values as CLI arguments or expose parser diagnostics.
  cp -- "$TASK_ENV_OVERRIDES_FILE" "$RELEASE_TMP/task-env-source.json" 2>/dev/null || fail "Unable to read TASK_ENV_OVERRIDES_FILE"
  jq -se '
    if length == 1 and (.[0] | type == "object" and
      all(to_entries[]; (.key | test("\\A[A-Za-z_][A-Za-z0-9_]*\\z")) and (.value | type == "string")))
    then .[0] else error("Invalid task environment overrides") end
  ' "$RELEASE_TMP/task-env-source.json" > "$RELEASE_TMP/task-env-overrides.json" 2>/dev/null || fail "TASK_ENV_OVERRIDES_FILE must contain one JSON object with valid environment names and string values"
else
  printf '{}\n' > "$RELEASE_TMP/task-env-overrides.json"
fi
if [ -z "$PREBUILT_IMAGE_DIGEST" ]; then
  mkdir "$RELEASE_TMP/context"
  git archive "$SHA:backend" | tar -x -C "$RELEASE_TMP/context"
fi

echo "==> preflight: committed source $SHA"
aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION" > "$RELEASE_TMP/service.json"
jq -e '(.failures | length) == 0 and (.services | length) == 1 and .services[0].desiredCount > 0' "$RELEASE_TMP/service.json" >/dev/null || fail "Expected one active ECS service with desiredCount > 0"
OLD_TASK=$(jq -er '.services[0].taskDefinition' "$RELEASE_TMP/service.json")
aws ecs describe-task-definition --task-definition "$OLD_TASK" --include TAGS --region "$REGION" > "$RELEASE_TMP/current-task.json"
if [ -z "${CONTAINER_NAME:-}" ]; then
  CONTAINER_NAME=$(jq -er --arg repo "$REPO" '
    .taskDefinition.containerDefinitions as $containers |
    [$containers[] | select((.image | startswith($repo + ":")) or (.image | startswith($repo + "@"))) | .name] as $matches |
    if ($matches | length) == 1 then $matches[0]
    elif ($containers | length) == 1 then $containers[0].name
    else error("Set CONTAINER_NAME to identify the backend container") end
  ' "$RELEASE_TMP/current-task.json")
fi
jq -e --arg name "$CONTAINER_NAME" '[.taskDefinition.containerDefinitions[] | select(.name == $name)] | length == 1' "$RELEASE_TMP/current-task.json" >/dev/null || fail "CONTAINER_NAME must identify exactly one task container"
jq -e --arg name "$CONTAINER_NAME" --slurpfile overrides "$RELEASE_TMP/task-env-overrides.json" '
  $overrides[0] as $env |
  [.taskDefinition.containerDefinitions[] | select(.name == $name) |
    (.secrets // [])[] | .name as $key | select($env | has($key))] | length == 0
' "$RELEASE_TMP/current-task.json" >/dev/null 2>/dev/null || fail "Task environment overrides conflict with ECS secrets or the task definition is invalid"

if [ -n "$PREBUILT_IMAGE_DIGEST" ]; then
  echo "==> verify prebuilt image for $REPO:$SHA"
  # Scope the lookup to the configured registry/repository and exact commit tag.
  # Deploy by verified digest so later tag changes cannot substitute an image.
  TAG_DIGEST=$(aws ecr describe-images --registry-id "$ACCOUNT" --repository-name "$REPO_NAME" --image-ids "imageTag=$SHA" --region "$REGION" --query 'imageDetails[0].imageDigest' --output text) || fail "Unable to verify prebuilt image for the committed SHA"
  [ "$TAG_DIGEST" = "$PREBUILT_IMAGE_DIGEST" ] || fail "Committed SHA tag does not match PREBUILT_IMAGE_DIGEST in the configured ECR repository"
  DIGEST="$PREBUILT_IMAGE_DIGEST"
else
  echo "==> build and push $REPO:$SHA"
  aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
  # A single-platform manifest keeps the pinned digest identical to ECS's running
  # container digest (a provenance manifest list would have a different parent ID).
  docker buildx build --platform linux/amd64 --provenance=false -t "$REPO:$SHA" --metadata-file "$RELEASE_TMP/build-metadata.json" --push "$RELEASE_TMP/context"
  DIGEST=$(jq -er '.["containerimage.digest"]' "$RELEASE_TMP/build-metadata.json")
  [[ "$DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]] || fail "Build did not return a valid immutable digest"
fi
IMAGE="$REPO@$DIGEST"

# Reject a service changed by another release while this image was building.
# Deployment jobs must additionally be serialized: ECS has no conditional
# compare-and-swap update-service API for the final check-to-update interval.
assert_service_unchanged() {
  aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION" > "$RELEASE_TMP/pre-update-service.json"
  jq -e --arg task "$OLD_TASK" '(.failures | length) == 0 and (.services | length) == 1 and .services[0].taskDefinition == $task' "$RELEASE_TMP/pre-update-service.json" >/dev/null || fail "Service changed during the build; rerun from its current task definition"
}
assert_service_unchanged
jq --arg name "$CONTAINER_NAME" --arg image "$IMAGE" --slurpfile overrides "$RELEASE_TMP/task-env-overrides.json" '
  $overrides[0] as $env |
  .tags as $tags | .taskDefinition |
  del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy, .deregisteredAt) |
  (.containerDefinitions[] | select(.name == $name)) |= (
    .image = $image |
    if ($env | length) > 0 then
      (.environment // []) as $existing |
      .environment = (
        ($existing | map(.name as $key | if ($env | has($key)) then .value = $env[$key] else . end)) +
        [$env | to_entries[] | select(.key as $key | $existing | any(.name == $key) | not) | {name: .key, value: .value}]
      )
    else . end
  ) |
  if ($tags | length) > 0 then .tags = $tags else . end
' "$RELEASE_TMP/current-task.json" > "$RELEASE_TMP/new-task.json"
NEW_TASK=$(aws ecs register-task-definition --cli-input-json "file://$RELEASE_TMP/new-task.json" --region "$REGION" --query 'taskDefinition.taskDefinitionArn' --output text)
[[ "$NEW_TASK" == arn:*:task-definition/* ]] || fail "ECS did not return a task definition ARN"
assert_service_unchanged

echo "==> deploying $NEW_TASK ($DIGEST)"
DEPLOY_ID=$(aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --task-definition "$NEW_TASK" --region "$REGION" --query 'service.deployments[?status==`PRIMARY`].id | [0]' --output text)
[ -n "$DEPLOY_ID" ] && [ "$DEPLOY_ID" != "None" ] || fail "ECS did not return a deployment ID"
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION"

# services-stable can also succeed after an automatic rollback. Verify that this
# exact revision completed and that every running task has the expected digest.
aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION" > "$RELEASE_TMP/deployed-service.json"
jq -e --arg task "$NEW_TASK" --arg deployment "$DEPLOY_ID" '
  (.failures | length) == 0 and (.services | length) == 1 and
  (.services[0] | .taskDefinition == $task and .desiredCount > 0 and .runningCount == .desiredCount and .pendingCount == 0 and
    any(.deployments[]; .id == $deployment and .taskDefinition == $task and .status == "PRIMARY" and .rolloutState == "COMPLETED"))
' "$RELEASE_TMP/deployed-service.json" >/dev/null || fail "Requested ECS revision did not complete; inspect deployment events (possible rollback)"
aws ecs list-tasks --cluster "$CLUSTER" --service-name "$SERVICE" --desired-status RUNNING --region "$REGION" > "$RELEASE_TMP/task-list.json"
TASK_ARNS=()
while IFS= read -r task_arn; do TASK_ARNS+=("$task_arn"); done < <(jq -r '.taskArns[]' "$RELEASE_TMP/task-list.json")
[ "${#TASK_ARNS[@]}" -gt 0 ] || fail "No running ECS tasks found"
# ECS describe-tasks accepts at most 100 ARNs per request.
for ((offset=0; offset<${#TASK_ARNS[@]}; offset+=100)); do
  aws ecs describe-tasks --cluster "$CLUSTER" --tasks "${TASK_ARNS[@]:offset:100}" --region "$REGION" > "$RELEASE_TMP/tasks.json"
  jq -e --arg task "$NEW_TASK" --arg name "$CONTAINER_NAME" --arg digest "$DIGEST" '
    (.failures | length) == 0 and (.tasks | length) > 0 and
    all(.tasks[]; .taskDefinitionArn == $task and any(.containers[]; .name == $name and .imageDigest == $digest))
  ' "$RELEASE_TMP/tasks.json" >/dev/null || fail "Running tasks do not match the requested revision and image digest"
done

HEALTH_CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$API_BASE/health")
[ "$HEALTH_CODE" = "200" ] || fail "Health check returned HTTP $HEALTH_CODE"
PROBE_CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$API_BASE$PROBE_PATH")
case "$PROBE_CODE" in
  200|401|403|422) ;;
  *) fail "Route probe returned unexpected HTTP $PROBE_CODE" ;;
esac

echo "==> Deploy complete: $NEW_TASK"
echo "    Image: $IMAGE"
echo "    Health: $HEALTH_CODE; route: $PROBE_CODE"
echo "    Previous task definition for rollback: $OLD_TASK"
