#!/usr/bin/env bash
# Starts the planning server and Metro in the background, then launches the app in the simulator.
#   scripts/dev.sh            # simulator
#   scripts/dev.sh --device   # physical iPhone
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
(cd "${ROOT}/server" && npm run dev) &
(cd "${ROOT}/app" && npx react-native start --reset-cache) &
sleep 3
cd "${ROOT}/app"
if [ "${1:-}" = "--device" ]; then
  npx react-native run-ios --device
else
  npx react-native run-ios --simulator "iPhone 17 Pro"
fi
wait
