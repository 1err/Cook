#!/usr/bin/env bash
# End-to-end smoke for the recipe tutorial schema. Hits:
#   POST /auth/login
#   POST /recipes        (with tutorial body)
#   GET  /recipes/{id}   (assert round-trip)
#   PATCH /recipes/{id}  (mutate steps + tips)
#   GET  /recipes/{id}   (assert PATCH applied)
#   DELETE /recipes/{id} (204)
#
# Asserts:
#   - POST /recipes persists steps with duration_seconds, tips, equipment
#   - GET round-trips all fields (deduplication of tips)
#   - PATCH updates steps and tips independently
#   - DELETE returns 204
#
# Requirements:
#   - Local Docker stack running (backend on http://localhost:8000)
#   - One test account you know the password for
#   - jq (brew install jq if missing)
#
# Usage:
#   bash backend/scripts/smoke_tutorial_schema.sh <password>
#
# Override:
#   EMAIL=other@x.com BASE=http://localhost:9999 bash backend/scripts/smoke_tutorial_schema.sh <pw>

set -euo pipefail

BASE="${BASE:-http://localhost:8000}"
EMAIL="${EMAIL:-jerryxiang24@gmail.com}"
PW="${1:?Usage: smoke_tutorial_schema.sh <password>}"

require_jq() {
  command -v jq >/dev/null 2>&1 || { echo "jq is required (brew install jq)"; exit 1; }
}
require_jq

echo "==> login as $EMAIL"
TOKEN=$(curl -fsS -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | jq -r .access_token)
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || { echo "login failed"; exit 1; }

RECIPE_ID="smoke-tutorial-$(date +%s)"

echo "==> POST /recipes with full tutorial body"
curl -fsS -X POST "$BASE/recipes" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{
    \"id\": \"$RECIPE_ID\",
    \"title\": \"Smoke Tutorial\",
    \"ingredients\": [{\"name\":\"tofu\",\"quantity\":\"1 block\"}],
    \"description\": \"smoke description\",
    \"total_time_minutes\": 30,
    \"steps\": [
      {\"text\":\"first step\",\"duration_seconds\":60},
      {\"text\":\"second step\"}
    ],
    \"tips\": [\"a tip\",\"a tip\"],
    \"equipment\": [\"wok\"]
  }" | jq -e '.steps | length == 2' >/dev/null

echo "==> GET /recipes/$RECIPE_ID and validate round-trip"
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/recipes/$RECIPE_ID" \
  | jq -e '
      .description == "smoke description"
      and .total_time_minutes == 30
      and (.steps | length) == 2
      and (.steps[0].duration_seconds // 0) == 60
      and (.tips | length) == 1
      and .equipment == ["wok"]
    ' >/dev/null

echo "==> PATCH /recipes/$RECIPE_ID to add a step and a tip"
curl -fsS -X PATCH "$BASE/recipes/$RECIPE_ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "steps":[
      {"text":"first step","duration_seconds":60},
      {"text":"second step"},
      {"text":"third step","duration_seconds":30}
    ],
    "tips":["a tip","another tip"]
  }' | jq -e '(.steps | length) == 3 and (.tips | length) == 2' >/dev/null

echo "==> GET again, confirm PATCH applied"
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/recipes/$RECIPE_ID" \
  | jq -e '(.steps | length) == 3 and (.tips | length) == 2' >/dev/null

echo "==> DELETE /recipes/$RECIPE_ID"
DEL_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
  -H "Authorization: Bearer $TOKEN" "$BASE/recipes/$RECIPE_ID")
[ "$DEL_CODE" = "204" ] || { echo "expected 204 delete, got $DEL_CODE"; exit 1; }

echo "✓ tutorial schema smoke passed"
