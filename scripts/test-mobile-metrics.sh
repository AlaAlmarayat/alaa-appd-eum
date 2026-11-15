#!/usr/bin/env bash
set -euo pipefail

# Test AppDynamics Mobile RUM /eumcollector/mobileMetrics?version=2 from Linux/macOS
# Creator: Ala'a Mrayat
# Usage:
#   ./test-mobile-metrics.sh
#   ./test-mobile-metrics.sh --url https://example-mobile-collector.com --key XXX-XXX-XXX --insecure
#   APP_KEY="XXX-XXX-XXX" COLLECTOR_URL="https://example-mobile-collector.com" ./test-mobile-metrics.sh

COLLECTOR_URL="${COLLECTOR_URL:-https://example-mobile-collector.com}"
APP_KEY="${APP_KEY:-XXX-XXX-XXX}"
BUNDLE_ID="${BUNDLE_ID:-com.alamrayat.eumdebug}"
OS_NAME="${OS_NAME:-Android}"
INSECURE="${INSECURE:-0}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --url) COLLECTOR_URL="$2"; shift 2 ;;
    --key) APP_KEY="$2"; shift 2 ;;
    --bundle) BUNDLE_ID="$2"; shift 2 ;;
    --os) OS_NAME="$2"; shift 2 ;;
    -k|--insecure) INSECURE=1; shift ;;
    -h|--help)
      echo "Usage: $0 [--url URL] [--key APP_KEY] [--bundle BUNDLE_ID] [--os Android|iOS] [-k|--insecure]"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

gen_uuid() {
  if [ -r /proc/sys/kernel/random/uuid ]; then
    cat /proc/sys/kernel/random/uuid
  elif command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    echo "11111111-2222-4333-8444-555555555555"
  fi
}

ENDPOINT="${COLLECTOR_URL%/}/eumcollector/mobileMetrics?version=2"
NOW_MS="$(($(date +%s) * 1000))"
BID="$(gen_uuid)"
DI="$(gen_uuid)"
EID1="$(gen_uuid)"
EID2="$(gen_uuid)"

CURL_FLAGS=(-i -sS -X POST)
if [ "$INSECURE" = "1" ]; then
  CURL_FLAGS+=(-k)
fi

build_payload() {
  local eid="$1"
  cat <<EOF
[{"type":"system-event","ec":1,"eid":"${eid}","sessionCounter":-1,"st":${NOW_MS},"sut":1000,"event":"Agent Init","avi":10000,"av":"1.0.0","agv":"24.12.0","ab":"7eb5b59c4b1d293baef883eeaeed20a927213323","dm":"Apple","dmo":"iPhone","ds":5939,"tm":"1978","cf":"2","cc":4,"osv":"17.4","ca":"WiFi","ct":"wifi","bid":"${BID}","hat":"Cordova","hav":"25.4.1"}]
EOF
}

echo "=== [1/2] Testing GZIP POST (matches Mobile SDK) ==="
echo "Endpoint: $ENDPOINT | Key: $APP_KEY | Bundle: $BUNDLE_ID"
build_payload "$EID1" | tr -d '\n' | gzip -c | curl "${CURL_FLAGS[@]}" "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Content-Encoding: gzip" \
  -H "gzip: false" \
  -H "ky: $APP_KEY" \
  -H "an: $BUNDLE_ID" \
  -H "osn: $OS_NAME" \
  -H "bid: $BID" \
  -H "cap: s:1,f:1" \
  -H "mat: -1" \
  -H "di: $DI" \
  -H "adrum_request_config: 0" \
  --data-binary @-
echo ""

echo "=== [2/2] Testing Uncompressed JSON POST (checks proxy/F5 gzip handling) ==="
PLAIN_BODY="$(build_payload "$EID2" | tr -d '\n')"
curl "${CURL_FLAGS[@]}" "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "ky: $APP_KEY" \
  -H "an: $BUNDLE_ID" \
  -H "osn: $OS_NAME" \
  -H "bid: $BID" \
  -H "cap: s:1,f:1" \
  -H "mat: -1" \
  -H "di: $DI" \
  -H "adrum_request_config: 0" \
  -d "$PLAIN_BODY"
echo ""
