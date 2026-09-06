#!/usr/bin/env bash
# Simulator helper for hands-off verification (uses Facebook idb for taps).
#
#   scripts/sim.sh shot [path]            screenshot (default: /tmp/sim.png)
#   scripts/sim.sh tap X Y                tap at point coordinates (portrait, points not pixels)
#   scripts/sim.sh say "play purple haze" inject a spoken command (dev build only)
#   scripts/sim.sh url "drivingassistant://dev/onboarding-reset"
#   scripts/sim.sh log [seconds]          native log lines from DAWhisper/DAKokoro
#   scripts/sim.sh relaunch
#
# idb setup (one time; brew's idb-companion needs newer CLT than Xcode 26.2 ships):
#   mkdir -p ~/.local/idb && cd ~/.local/idb
#   gh release download v1.5.2 -R facebook/idb -p "idb-companion.macos-arm64.tar.gz" && tar -xzf idb-companion.macos-arm64.tar.gz
#   python3 -m venv venv && ./venv/bin/pip install fb-idb==1.5.2
set -euo pipefail
export PATH="$HOME/.local/idb:$HOME/.local/idb/venv/bin:$PATH"
BUNDLE=com.coloshword.drivingassistant
UDID="${SIM_UDID:-$(xcrun simctl list devices booted -j | python3 -c 'import json,sys; d=json.load(sys.stdin)["devices"]; print([x for v in d.values() for x in v][0]["udid"])')}"

case "${1:-}" in
  shot) xcrun simctl io "$UDID" screenshot "${2:-/tmp/sim.png}" >/dev/null 2>&1 && echo "${2:-/tmp/sim.png}" ;;
  tap) idb ui tap --udid "$UDID" "$2" "$3" ;;
  say) xcrun simctl openurl "$UDID" "drivingassistant://dev/say?text=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$2")" ;;
  url) xcrun simctl openurl "$UDID" "$2" ;;
  log) xcrun simctl spawn "$UDID" log show --last "${2:-30}s" --predicate 'process == "DrivingAssistant"' --style compact 2>/dev/null | grep -E "DAWhisper|DAKokoro|\[devLinks\]|\[assistant\]|\[executeTool\]" | cut -c1-240 ;;
  relaunch) xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true; xcrun simctl launch "$UDID" "$BUNDLE" ;;
  *) sed -n 2,14p "$0"; exit 1 ;;
esac
