#!/usr/bin/env bash
# End-to-end smoke for the friend-library-sharing endpoints. Hits all four:
#   POST /auth/library-visibility
#   GET  /users/search
#   GET  /users/{id}/recipes
#   POST /users/{id}/recipes/{rid}/copy
#
# Asserts:
#   - jd's library visible to bob when public
#   - search returns 404 when private and on self-search
#   - copy is idempotent (same id returned on second call)
#   - copy + list both 404 after jd toggles library off
#
# Requirements:
#   - Local Docker stack running (backend on http://localhost:8000)
#   - Two test accounts you know the passwords for
#   - jq (brew install jq if missing)
#
# Usage (defaults: jd@gmail.com, bob+test@example.com):
#   bash backend/scripts/smoke_friend_library.sh <jd-pw> <bob-pw>
#
# Override accounts via env:
#   JD_EMAIL=other@x.com BOB_EMAIL=other2@x.com bash backend/scripts/smoke_friend_library.sh ...

set -euo pipefail

BASE="${BASE:-http://localhost:8000}"
JD_EMAIL="${JD_EMAIL:-jd@gmail.com}"
BOB_EMAIL="${BOB_EMAIL:-bob+test@example.com}"
JD_PW="${1:?Usage: smoke_friend_library.sh <jd-pw> <bob-pw>}"
BOB_PW="${2:?Usage: smoke_friend_library.sh <jd-pw> <bob-pw>}"

# URL-encode the `+` in emails (curl doesn't auto-encode query params).
JD_EMAIL_Q=$(python3 -c "import urllib.parse,os; print(urllib.parse.quote(os.environ['JD_EMAIL'], safe=''))" JD_EMAIL="$JD_EMAIL")
BOB_EMAIL_Q=$(python3 -c "import urllib.parse,os; print(urllib.parse.quote(os.environ['BOB_EMAIL'], safe=''))" BOB_EMAIL="$BOB_EMAIL")

require_jq() {
  command -v jq >/dev/null 2>&1 || { echo "jq is required (brew install jq)"; exit 1; }
}
require_jq

echo "==> login jd ($JD_EMAIL)"
JD_TOKEN=$(curl -fsS -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$JD_EMAIL\",\"password\":\"$JD_PW\"}" | jq -r .access_token)
[ -n "$JD_TOKEN" ] && [ "$JD_TOKEN" != "null" ] || { echo "jd login failed"; exit 1; }

echo "==> login or register bob ($BOB_EMAIL)"
BOB_TOKEN=$(curl -fsS -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$BOB_EMAIL\",\"password\":\"$BOB_PW\"}" 2>/dev/null | jq -r .access_token 2>/dev/null || true)
if [ -z "${BOB_TOKEN:-}" ] || [ "$BOB_TOKEN" = "null" ]; then
  BOB_TOKEN=$(curl -fsS -X POST "$BASE/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$BOB_EMAIL\",\"password\":\"$BOB_PW\"}" | jq -r .access_token)
fi
[ -n "$BOB_TOKEN" ] && [ "$BOB_TOKEN" != "null" ] || { echo "bob auth failed"; exit 1; }

echo "==> jd toggles library public"
curl -fsS -X POST "$BASE/auth/library-visibility" \
  -H "Authorization: Bearer $JD_TOKEN" -H "Content-Type: application/json" \
  -d '{"is_public":true}' >/dev/null

echo "==> bob searches jd's email -> expect 200 with jd's id"
JD_ID=$(curl -fsS "$BASE/users/search?email=$JD_EMAIL_Q" \
  -H "Authorization: Bearer $BOB_TOKEN" | jq -r .id)
[ -n "$JD_ID" ] && [ "$JD_ID" != "null" ] || { echo "search failed"; exit 1; }
echo "    JD_ID=$JD_ID"

echo "==> bob searches HIMSELF -> expect 404"
SELF_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/users/search?email=$BOB_EMAIL_Q" \
  -H "Authorization: Bearer $BOB_TOKEN")
[ "$SELF_CODE" = "404" ] || { echo "expected 404 self-search, got $SELF_CODE"; exit 1; }

echo "==> bob lists jd's recipes (expect at least one — register or seed first if empty)"
JD_RECIPE_ID=$(curl -fsS "$BASE/users/$JD_ID/recipes" \
  -H "Authorization: Bearer $BOB_TOKEN" | jq -r '.[0].id // empty')
[ -n "$JD_RECIPE_ID" ] || { echo "jd has no recipes — add one before re-running"; exit 1; }
echo "    JD_RECIPE_ID=$JD_RECIPE_ID"

echo "==> bob copies once"
COPY1=$(curl -fsS -X POST "$BASE/users/$JD_ID/recipes/$JD_RECIPE_ID/copy" \
  -H "Authorization: Bearer $BOB_TOKEN" | jq -r .id)
[ -n "$COPY1" ] && [ "$COPY1" != "null" ] || { echo "copy failed"; exit 1; }

echo "==> bob copies again (idempotent — same id)"
COPY2=$(curl -fsS -X POST "$BASE/users/$JD_ID/recipes/$JD_RECIPE_ID/copy" \
  -H "Authorization: Bearer $BOB_TOKEN" | jq -r .id)
[ "$COPY1" = "$COPY2" ] || { echo "non-idempotent copy: $COPY1 vs $COPY2"; exit 1; }
echo "    idempotent copy id: $COPY1"

echo "==> jd toggles library OFF, bob's search/list/copy should all 404"
curl -fsS -X POST "$BASE/auth/library-visibility" \
  -H "Authorization: Bearer $JD_TOKEN" -H "Content-Type: application/json" \
  -d '{"is_public":false}' >/dev/null

SEARCH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/users/search?email=$JD_EMAIL_Q" \
  -H "Authorization: Bearer $BOB_TOKEN")
[ "$SEARCH_CODE" = "404" ] || { echo "expected 404 search after off, got $SEARCH_CODE"; exit 1; }

LIST_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/users/$JD_ID/recipes" \
  -H "Authorization: Bearer $BOB_TOKEN")
[ "$LIST_CODE" = "404" ] || { echo "expected 404 list after off, got $LIST_CODE"; exit 1; }

COPY_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$BASE/users/$JD_ID/recipes/$JD_RECIPE_ID/copy" \
  -H "Authorization: Bearer $BOB_TOKEN")
[ "$COPY_CODE" = "404" ] || { echo "expected 404 copy after off, got $COPY_CODE"; exit 1; }

echo "==> bob's prior copy still exists in his library"
SURVIVES=$(curl -fsS "$BASE/recipes" -H "Authorization: Bearer $BOB_TOKEN" \
  | jq -r --arg id "$COPY1" '[.[] | select(.id == $id)] | length')
[ "$SURVIVES" = "1" ] || { echo "bob's clone disappeared after jd toggled off"; exit 1; }

echo "==> restoring jd library to public"
curl -fsS -X POST "$BASE/auth/library-visibility" \
  -H "Authorization: Bearer $JD_TOKEN" -H "Content-Type: application/json" \
  -d '{"is_public":true}' >/dev/null

echo "ALL GREEN"
