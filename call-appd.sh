#!/usr/bin/env bash
# Ala'a AppD EUM - CLI Mobile Beacon Dispatcher
# Creator: Ala'a Mrayat

COLLECTOR_URL="${COLLECTOR_URL:-https://example-mobile-collector.com}"
APP_KEY="${APP_KEY:-XXX-XXX-XXX}"
APP_NAME="${APP_NAME:-com.alamrayat.eumdebug}"

NOW_MS=$(($(date +%s)*1000))
PAYLOAD="[{\"type\":\"system-event\",\"ec\":1,\"eid\":\"11111111-2222-4333-8444-555555555556\",\"sessionCounter\":-1,\"st\":${NOW_MS},\"sut\":1000,\"event\":\"Agent Init\",\"avi\":10000,\"av\":\"1.0.0\",\"agv\":\"24.12.0\",\"ab\":\"7eb5b59c4b1d293baef883eeaeed20a927213323\",\"dm\":\"Apple\",\"dmo\":\"iPhone\",\"ds\":5939,\"tm\":\"1978\",\"cf\":\"2\",\"cc\":4,\"osv\":\"17.4\",\"ca\":\"WiFi\",\"ct\":\"wifi\",\"bid\":\"eb6a92b9-bc01-4d6f-885a-13a0676ffe1d\",\"hat\":\"Cordova\",\"hav\":\"25.4.1\"}]"

curl -k -i -X POST "${COLLECTOR_URL}/eumcollector/mobileMetrics?version=2" \
  -H "Content-Type: application/json" \
  -H "ky: ${APP_KEY}" \
  -H "an: ${APP_NAME}" \
  -H "osn: Android" \
  -H "bid: eb6a92b9-bc01-4d6f-885a-13a0676ffe1d" \
  -H "cap: s:1,f:1" \
  -H "mat: -1" \
  -H "di: 99999999-2222-4333-8444-555555555555" \
  -H "adrum_request_config: 0" \
  -d "$PAYLOAD"
