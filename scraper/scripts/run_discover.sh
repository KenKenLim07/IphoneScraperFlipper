#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

mkdir -p .tmp logs

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${REPO_ROOT}/.env"
  set +a
fi

LOCK_FILE="${REPO_ROOT}/.tmp/discover.lock"
exec 9>"${LOCK_FILE}"
if command -v flock >/dev/null 2>&1; then
  if ! flock -n 9; then
    echo "[INFO] discover: already running (lock=${LOCK_FILE})"
    exit 0
  fi
else
  echo "[WARN] discover: flock not found; runs may overlap"
fi

BROWSER_CHANNEL="${PLAYWRIGHT_BROWSER_CHANNEL:-chromium}"
MAX_CARDS="${DISCOVER_MAX_CARDS:-50}"

HEADLESS_RAW="${PLAYWRIGHT_HEADLESS:-true}"
HEADLESS_ARG="--headless"
case "$(echo "${HEADLESS_RAW}" | tr '[:upper:]' '[:lower:]')" in
  0|false|no|off) HEADLESS_ARG="--no-headless" ;;
esac

ARGS=(
  "--browser-channel" "${BROWSER_CHANNEL}"
  "${HEADLESS_ARG}"
  "--max-cards" "${MAX_CARDS}"
)

if [[ "${1:-}" == "--" ]]; then shift; fi
if [[ "$#" -gt 0 ]]; then
  ARGS+=("$@")
fi

echo "[INFO] discover: starting browser_channel=${BROWSER_CHANNEL} max_cards=${MAX_CARDS}"
npm run -s sniffer:playwright-extra:discover -- "${ARGS[@]}"
