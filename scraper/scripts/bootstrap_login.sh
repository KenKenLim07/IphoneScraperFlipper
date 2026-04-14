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

MODE="${1:-}"
if [[ -z "${MODE}" || "${MODE}" == "-h" || "${MODE}" == "--help" ]]; then
  echo "Usage: bash scripts/bootstrap_login.sh <discover|monitor> [-- extra playwright args]"
  echo "Example: bash scripts/bootstrap_login.sh discover -- --browser-channel chromium"
  exit 2
fi
shift || true

case "${MODE}" in
  discover)
    if [[ -n "${PLAYWRIGHT_PROFILE_DIR_DISCOVER:-}" ]]; then
      export PLAYWRIGHT_PROFILE_DIR="${PLAYWRIGHT_PROFILE_DIR_DISCOVER}"
    fi
    NPM_SCRIPT="sniffer:playwright-extra:discover"
    ;;
  monitor)
    if [[ -n "${PLAYWRIGHT_PROFILE_DIR_MONITOR:-}" ]]; then
      export PLAYWRIGHT_PROFILE_DIR="${PLAYWRIGHT_PROFILE_DIR_MONITOR}"
    fi
    NPM_SCRIPT="sniffer:playwright-extra:monitor"
    ;;
  *)
    echo "[ERROR] invalid mode: ${MODE} (expected: discover|monitor)"
    exit 2
    ;;
esac

BROWSER_CHANNEL="${PLAYWRIGHT_BROWSER_CHANNEL:-chromium}"

ARGS=(
  "--bootstrap-login"
  "--browser-channel" "${BROWSER_CHANNEL}"
  "--no-headless"
)

if [[ "${1:-}" == "--" ]]; then shift; fi
if [[ "$#" -gt 0 ]]; then
  ARGS+=("$@")
fi

echo "[INFO] bootstrap: mode=${MODE} browser_channel=${BROWSER_CHANNEL} profile_dir=${PLAYWRIGHT_PROFILE_DIR:-<unset>}"
npm run -s "${NPM_SCRIPT}" -- "${ARGS[@]}"

# Clear marker file if present. The session should now be refreshed.
rm -f "${REPO_ROOT}/.tmp/login_required.json" 2>/dev/null || true
rm -f "${REPO_ROOT}/.tmp/login_required-${MODE}.json" 2>/dev/null || true
if [[ "${MODE}" == "discover" ]]; then
  rm -f "${REPO_ROOT}/.tmp/login_required-discovery.json" 2>/dev/null || true
fi
