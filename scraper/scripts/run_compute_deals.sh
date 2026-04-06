#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

mkdir -p .tmp logs

LOCK_FILE="${REPO_ROOT}/.tmp/deals.lock"
exec 9>"${LOCK_FILE}"
if command -v flock >/dev/null 2>&1; then
  if ! flock -n 9; then
    echo "[INFO] deals: already running (lock=${LOCK_FILE})"
    exit 0
  fi
else
  echo "[WARN] deals: flock not found; runs may overlap"
fi

echo "[INFO] deals: computing"
npm run -s deals:compute

