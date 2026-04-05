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
  const candidates = uniq([overrideEnv, scraperEnv])
    .map(existingFile)
    .filter(Boolean);

  for (const envPath of candidates) {
    dotenv.config({ path: envPath });
  }
}
