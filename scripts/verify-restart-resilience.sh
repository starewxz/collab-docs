#!/usr/bin/env sh
# Regression check for "login fails after restart": `docker compose restart`
# does not honor depends_on health-gating, so the backend's migration step
# can race a still-restarting postgres. Asserts the backend recovers and a
# real login succeeds within a bounded window after a full stack restart,
# without the backend container needing an extra Docker-level restart.
#
# Requires: the stack already running via `docker compose up -d`, and a
# TEST_EMAIL/TEST_PASSWORD account that already exists (this script does not
# create or hardcode credentials).
#
# Usage: TEST_EMAIL=you@example.com TEST_PASSWORD=... ./scripts/verify-restart-resilience.sh

set -eu

: "${TEST_EMAIL:?set TEST_EMAIL to an existing account's email}"
: "${TEST_PASSWORD:?set TEST_PASSWORD to that account's password}"
BACKEND_URL="${BACKEND_URL:-http://localhost:4000}"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-30}"

backend_container="$(docker compose ps -q backend)"
[ -n "$backend_container" ] || { echo "backend container not found - is the stack up?"; exit 1; }
before_restart_count="$(docker inspect "$backend_container" --format '{{.RestartCount}}')"

echo "Restarting full stack..."
docker compose restart >/dev/null

elapsed=0
until curl -s -o /dev/null -w '' --max-time 1 -X POST "$BACKEND_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}"; do
  elapsed=$((elapsed + 1))
  if [ "$elapsed" -ge "$MAX_WAIT_SECONDS" ]; then
    echo "FAIL: backend did not become reachable within ${MAX_WAIT_SECONDS}s"
    exit 1
  fi
  sleep 1
done

code="$(curl -s -o /tmp/verify-restart-login.json -w '%{http_code}' --max-time 5 \
  -X POST "$BACKEND_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")"

if [ "$code" != "200" ]; then
  echo "FAIL: login returned $code after restart"
  cat /tmp/verify-restart-login.json
  exit 1
fi

after_restart_count="$(docker inspect "$backend_container" --format '{{.RestartCount}}')"
if [ "$after_restart_count" != "$before_restart_count" ]; then
  echo "FAIL: backend container was auto-restarted by Docker ($before_restart_count -> $after_restart_count), meaning the migration step crashed instead of retrying"
  exit 1
fi

echo "PASS: login succeeded within ${elapsed}s of restart, no extra container restart occurred"
