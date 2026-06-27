#!/usr/bin/env bash
# scripts/smoke-login.sh
# Smoke test for POST /login + GET /status/:requestId.
# Usage: BASE=https://api.surfshark-activate.app ./scripts/smoke-login.sh ABCDEF
set -euo pipefail

BASE="${BASE:-http://localhost:3001}"
CODE="${1:-ABCDEF}"

command -v jq >/dev/null 2>&1 || { echo "ERROR: 'jq' is required. Install with: apt-get install jq / brew install jq" >&2; exit 2; }

echo "==> POST $BASE/login  deviceCode=$CODE"
RESP="$(curl -sS -X POST "$BASE/login" \
  -H 'Content-Type: application/json' \
  -d "{\"deviceCode\":\"$CODE\"}")"
echo "$RESP" | jq .

RID="$(echo "$RESP" | jq -r '.data.requestId')"
if [[ -z "$RID" || "$RID" == "null" ]]; then
  echo "ERROR: no requestId in response" >&2
  exit 1
fi

echo "==> Polling GET $BASE/status/$RID (timeout 60s)"
for i in $(seq 1 60); do
  STATUS="$(curl -sS "$BASE/status/$RID")"
  STATE="$(echo "$STATUS" | jq -r '.data.state')"
  printf "  t=%2ds  state=%s\n" "$i" "$STATE"
  if [[ "$STATE" == "success" || "$STATE" == "failed" ]]; then
    echo "$STATUS" | jq .
    if [[ "$STATE" == "failed" ]]; then
      echo "==> Login FAILED (expected for unknown codes; check error code)" >&2
      exit 1
    fi
    echo "==> Login OK"
    exit 0
  fi
  sleep 1
done

echo "ERROR: timeout after 60s (state still processing)" >&2
exit 1
