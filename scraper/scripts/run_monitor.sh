#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

mkdir -p .tmp logs

LOCK_FILE="${REPO_ROOT}/.tmp/monitor.lock"
exec 9>"${LOCK_FILE}"
if command -v flock >/dev/null 2>&1; then
  if ! flock -n 9; then
    echo "[INFO] monitor: already running (lock=${LOCK_FILE})"
    exit 0
  fi
else
  echo "[WARN] monitor: flock not found; runs may overlap"
fi

BROWSER_CHANNEL="${PLAYWRIGHT_BROWSER_CHANNEL:-chromium}"
LIMIT="${MONITOR_LIMIT:-${PLAYWRIGHT_WATCHLIST_RECHECK_LIMIT:-50}}"

HEADLESS_RAW="${PLAYWRIGHT_HEADLESS:-true}"
HEADLESS_ARG="--headless"
case "$(echo "${HEADLESS_RAW}" | tr '[:upper:]' '[:lower:]')" in
  0|false|no|off) HEADLESS_ARG="--no-headless" ;;
esac

ARGS=(
  "--browser-channel" "${BROWSER_CHANNEL}"
  "${HEADLESS_ARG}"
  "--limit" "${LIMIT}"
)

if [[ "${1:-}" == "--" ]]; then shift; fi
if [[ "$#" -gt 0 ]]; then
  ARGS+=("$@")
fi

echo "[INFO] monitor: starting browser_channel=${BROWSER_CHANNEL} limit=${LIMIT}"
npm run -s sniffer:playwright-extra:monitor -- "${ARGS[@]}"
