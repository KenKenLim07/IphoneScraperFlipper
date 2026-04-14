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

# Optional: allow a separate persistent profile for discovery (e.g. account rotation).
# If unset, falls back to PLAYWRIGHT_PROFILE_DIR from `.env`.
if [[ -n "${PLAYWRIGHT_PROFILE_DIR_DISCOVER:-}" ]]; then
  export PLAYWRIGHT_PROFILE_DIR="${PLAYWRIGHT_PROFILE_DIR_DISCOVER}"
fi

JITTER_MAX="${SCRAPE_RUN_JITTER_MAX_S:-0}"
if [[ "${JITTER_MAX}" =~ ^[0-9]+$ ]] && [[ "${JITTER_MAX}" -gt 0 ]]; then
  JITTER_SLEEP=$((RANDOM % (JITTER_MAX + 1)))
  echo "[INFO] discover: jitter_sleep_seconds=${JITTER_SLEEP}"
  sleep "${JITTER_SLEEP}"
fi

# If the last run detected a blocked session, avoid hammering while the user rebootsraps login.
MARKER="${REPO_ROOT}/.tmp/login_required-discovery.json"
COOLDOWN_MINUTES="${LOGIN_REQUIRED_COOLDOWN_MINUTES:-180}"
if [[ -f "${MARKER}" ]] && command -v node >/dev/null 2>&1; then
  if node -e '
const fs = require("fs");
const marker = process.argv[1];
const cooldownMin = Number(process.argv[2] || "180");
try {
  const j = JSON.parse(fs.readFileSync(marker, "utf8"));
  const ts = Date.parse(j.ts || "");
  if (!Number.isFinite(ts)) process.exit(1);
  const ageMin = (Date.now() - ts) / 60000;
  process.exit(ageMin < cooldownMin ? 0 : 1);
} catch {
  process.exit(1);
}
' "${MARKER}" "${COOLDOWN_MINUTES}"; then
    echo "[WARN] discover: login_required cooldown_active_minutes=${COOLDOWN_MINUTES} marker=${MARKER} (skipping run)"
    bash "${REPO_ROOT}/scripts/notify_telegram.sh" discover || true
    exit 0
  fi
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

echo "[INFO] discover: starting browser_channel=${BROWSER_CHANNEL} max_cards=${MAX_CARDS} profile_dir=${PLAYWRIGHT_PROFILE_DIR:-<unset>}"
npm run -s sniffer:playwright-extra:discover -- "${ARGS[@]}"

# Notify if the run detected a logged-out/blocked session.
bash "${REPO_ROOT}/scripts/notify_telegram.sh" discover || true
