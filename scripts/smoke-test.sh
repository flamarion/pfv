#!/usr/bin/env bash
# Post-deploy smoke tests (L0.5).
#
# Verifies the live app can serve traffic after a deploy. Runs from
# .github/workflows/deploy.yml after the DigitalOcean App Platform
# deploy step succeeds — DO marking a deploy ACTIVE is necessary but
# not sufficient. This script asserts the actual surface a real user
# would touch first.
#
# Surface (intentionally minimal — full E2E is project_functional_tests.md):
#   1. GET  /health                     — liveness
#   2. GET  /ready                      — readiness (DB + Redis reachable)
#   3. POST /api/v1/auth/login          — authenticated round-trip
#   4. GET  /api/v1/categories          — one authenticated read
#
# Inputs (env vars):
#   SMOKE_BASE_URL     — public URL, e.g. https://app.thebetterdecision.com
#   SMOKE_USERNAME     — login for the dedicated smoke user (NOT a real user)
#   SMOKE_PASSWORD     — password for the smoke user
#
# The smoke user must:
#   - exist in the prod org
#   - have email_verified = True
#   - have MFA disabled (otherwise login returns a challenge, not a token)
#   - have role MEMBER (least-privilege; reading /categories needs no more)
#
# Exit codes:
#   0  every check passed
#   1  any check failed
#   2  required env var missing
#
# Token / cookie redaction: this script never prints the access_token,
# the refresh_token cookie, or the password. Failure logs include status
# code and a small body excerpt only — never the request payload.

set -uo pipefail

# ── Inputs ──────────────────────────────────────────────────────────────────

BASE_URL="${SMOKE_BASE_URL:-}"
USERNAME="${SMOKE_USERNAME:-}"
PASSWORD="${SMOKE_PASSWORD:-}"

if [[ -z "$BASE_URL" ]]; then
  echo "✗ SMOKE_BASE_URL is not set"
  exit 2
fi
if [[ -z "$USERNAME" || -z "$PASSWORD" ]]; then
  echo "✗ SMOKE_USERNAME and SMOKE_PASSWORD must both be set"
  exit 2
fi

# Strip any trailing slash so we can safely concat path suffixes.
BASE_URL="${BASE_URL%/}"

CURL_OPTS=(--silent --show-error --max-time 15 --connect-timeout 5)

failed=0

# ── Helpers ─────────────────────────────────────────────────────────────────

# check_status <name> <expected> <method> <path> [data] [extra_header]
# Prints a one-line PASS/FAIL summary; sets `failed=1` on mismatch.
# Captures HTTP status + small body excerpt for the failure log.
check_status() {
  local name="$1" expected="$2" method="$3" path="$4" data="${5:-}" header="${6:-}"
  local url="${BASE_URL}${path}"
  local body_file status

  body_file="$(mktemp)"
  if [[ "$method" == "GET" ]]; then
    if [[ -n "$header" ]]; then
      status="$(curl "${CURL_OPTS[@]}" -o "$body_file" -w '%{http_code}' \
        -H "$header" "$url" || echo "000")"
    else
      status="$(curl "${CURL_OPTS[@]}" -o "$body_file" -w '%{http_code}' "$url" || echo "000")"
    fi
  else
    status="$(curl "${CURL_OPTS[@]}" -o "$body_file" -w '%{http_code}' \
      -X "$method" -H "Content-Type: application/json" --data "$data" "$url" || echo "000")"
  fi

  if [[ "$status" == "$expected" ]]; then
    echo "✓ ${name} (${status})"
    rm -f "$body_file"
    return 0
  fi

  echo "✗ ${name}: expected ${expected}, got ${status}"
  echo "  body: $(head -c 200 "$body_file" | tr -d '\n')"
  rm -f "$body_file"
  failed=1
  return 1
}

# Mask a string: keep first 4 + last 4 chars, replace middle with stars.
# Used to print a token-presence proof without exposing the token itself.
mask() {
  local s="$1"
  local len=${#s}
  if (( len < 12 )); then
    echo "[redacted ${len}b]"
  else
    echo "${s:0:4}…${s: -4} (${len}b)"
  fi
}

# ── Checks ──────────────────────────────────────────────────────────────────

echo "Smoke testing ${BASE_URL}"
echo

check_status "GET /health"  200 GET "/health"  || true
check_status "GET /ready"   200 GET "/ready"   || true

# Login. Capture access_token from the 200 response. We do not echo the
# token; we only print a length+prefix proof so a missing/empty token
# fails clearly.
login_body="$(printf '{"login":"%s","password":"%s"}' "$USERNAME" "$PASSWORD")"
login_response="$(mktemp)"
login_status="$(curl "${CURL_OPTS[@]}" -o "$login_response" -w '%{http_code}' \
  -X POST -H "Content-Type: application/json" --data "$login_body" \
  "${BASE_URL}/api/v1/auth/login" || echo "000")"

if [[ "$login_status" != "200" ]]; then
  echo "✗ POST /api/v1/auth/login: expected 200, got ${login_status}"
  echo "  body: $(head -c 200 "$login_response" | tr -d '\n')"
  rm -f "$login_response"
  failed=1
else
  # Extract the access_token without leaking it. python3 is preinstalled
  # on ubuntu-latest, so a small json.load is the safest extractor.
  access_token="$(python3 -c '
import json, sys
data = json.load(open(sys.argv[1]))
if "mfa_required" in data:
    print("MFA_CHALLENGE", file=sys.stderr); sys.exit(1)
print(data.get("access_token", ""))
' "$login_response" 2>&1 || true)"

  if [[ "$access_token" == *"MFA_CHALLENGE"* ]]; then
    echo "✗ POST /api/v1/auth/login: smoke user has MFA enabled — disable it"
    failed=1
    access_token=""
  elif [[ -z "$access_token" ]]; then
    echo "✗ POST /api/v1/auth/login: 200 but no access_token in body"
    failed=1
  else
    echo "✓ POST /api/v1/auth/login (200, token=$(mask "$access_token"))"
  fi
  rm -f "$login_response"
fi

# Authenticated read. Skip if login failed — no token to use.
if [[ -n "${access_token:-}" ]]; then
  check_status "GET /api/v1/categories (authenticated)" 200 GET \
    "/api/v1/categories" "" "Authorization: Bearer ${access_token}" || true
else
  echo "✗ GET /api/v1/categories: skipped (no access token from login)"
  failed=1
fi

echo

if (( failed == 0 )); then
  echo "All smoke checks passed."
  exit 0
fi

echo "Smoke checks FAILED."
exit 1
