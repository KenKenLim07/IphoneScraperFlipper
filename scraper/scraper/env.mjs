import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

function uniq(values) {
  const out = [];
  const seen = new Set();
  for (const v of values) {
    if (!v) continue;
    const key = String(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function existingFile(p) {
  try {
    if (!p) return null;
    const stat = fs.statSync(p);
    return stat.isFile() ? p : null;
  } catch {
    return null;
  }
}

export function loadDotenv() {
  // Prefer `scraper/.env` even when invoked from repo root, to avoid accidentally loading the root `.env`.
  // You can override with `DOTENV_PATH=/path/to/.env`.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const scraperEnv = path.resolve(here, "..", ".env");
  const overrideEnv = (process.env.DOTENV_PATH || "").trim();

  // Intentionally DO NOT load `process.cwd()/.env` because running from repo root would pick up the wrong file.
  // Load base first, then override (last write wins).
  const candidates = uniq([scraperEnv, overrideEnv])
    .map(existingFile)
    .filter(Boolean);

  for (const envPath of candidates) {
    // Default behavior: do not override already-set env vars.
    // This lets wrapper scripts (and systemd units) intentionally override specific vars like
    // `PLAYWRIGHT_PROFILE_DIR` per job while still allowing `.env` to supply defaults.
    const override =
      ["1", "true", "yes", "on"].includes(String(process.env.DOTENV_OVERRIDE || "").trim().toLowerCase());
    dotenv.config({ path: envPath, override });
    if ((process.env.DOTENV_DEBUG || "").trim()) {
      // Avoid printing any env values; just show which file was loaded.
      // eslint-disable-next-line no-console
      console.log(`[INFO] dotenv_loaded path=${envPath}`);
    }
  }
}
