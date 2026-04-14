#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

PHASE="${1:-}"
if [[ -z "${PHASE}" || "${PHASE}" == "-h" || "${PHASE}" == "--help" ]]; then
  echo "Usage: bash scripts/notify_telegram.sh <discover|monitor>"
  exit 2
fi

PHASE_MARKER="${PHASE}"
if [[ "${PHASE}" == "discover" ]]; then
  PHASE_MARKER="discovery"
fi

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${REPO_ROOT}/.env"
  set +a
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "[WARN] telegram: curl not found; skipping"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[WARN] telegram: node not found; skipping"
  exit 0
fi

TOKEN="${TELEGRAM_BOT_TOKEN:-}"
CHAT_ID="${TELEGRAM_CHAT_ID:-}"
if [[ -z "${TOKEN}" || -z "${CHAT_ID}" ]]; then
  echo "[WARN] telegram: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set; skipping"
  exit 0
fi

MARKER_PHASE="${REPO_ROOT}/.tmp/login_required-${PHASE_MARKER}.json"
MARKER_LATEST="${REPO_ROOT}/.tmp/login_required.json"

MARKER=""
if [[ -f "${MARKER_PHASE}" ]]; then
  MARKER="${MARKER_PHASE}"
elif [[ -f "${MARKER_LATEST}" ]]; then
  MARKER="${MARKER_LATEST}"
else
  exit 0
fi

mkdir -p "${REPO_ROOT}/.tmp"
LAST_SENT="${REPO_ROOT}/.tmp/telegram_login_required_last_sent_${PHASE}.txt"

TS="$(node -e "const fs=require('fs');const p='${MARKER}';try{const j=JSON.parse(fs.readFileSync(p,'utf8'));process.stdout.write(String(j.ts||''));}catch{process.stdout.write('');}")"
REASON="$(node -e "const fs=require('fs');const p='${MARKER}';try{const j=JSON.parse(fs.readFileSync(p,'utf8'));process.stdout.write(String(j.reason||''));}catch{process.stdout.write('');}")"
PHASE_IN_FILE="$(node -e "const fs=require('fs');const p='${MARKER}';try{const j=JSON.parse(fs.readFileSync(p,'utf8'));process.stdout.write(String(j.phase||''));}catch{process.stdout.write('');}")"

if [[ -z "${TS}" ]]; then
  TS="$(date -Is 2>/dev/null || date)"
fi

PREV=""
if [[ -f "${LAST_SENT}" ]]; then
  PREV="$(cat "${LAST_SENT}" 2>/dev/null || true)"
fi
if [[ -n "${PREV}" && "${PREV}" == "${TS}" ]]; then
  exit 0
fi

PROFILE_DIR="${PLAYWRIGHT_PROFILE_DIR:-<unset>}"
CHANNEL="${PLAYWRIGHT_BROWSER_CHANNEL:-chromium}"

TEXT=$(
  cat <<EOF
[IAASE] Facebook session needs login
phase=${PHASE_IN_FILE:-$PHASE} reason=${REASON:-unknown} ts=${TS}
browser_channel=${CHANNEL}
profile_dir=${PROFILE_DIR}
action: bash scripts/bootstrap_login.sh ${PHASE}
EOF
)

curl -sS -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -d "chat_id=${CHAT_ID}" \
  --data-urlencode "text=${TEXT}" \
  >/dev/null || true

echo "${TS}" > "${LAST_SENT}"
