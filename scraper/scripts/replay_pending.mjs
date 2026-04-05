import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { persistDiscoveryInsertOnlyBatched, persistToDatabaseBatched } from "../scraper/playwright_extra/db.mjs";
import { loadDotenv } from "../scraper/env.mjs";

loadDotenv();

function cleanText(value) {
  const raw = String(value || "").trim();
  return raw || null;
}

function usage() {
  console.log("Usage:");
  console.log("  node scripts/replay_pending.mjs <pending-json> [<pending-json> ...]");
  console.log("");
  console.log("Example:");
  console.log("  node scripts/replay_pending.mjs logs/pending-monitor-<run_id>.json");
}

function findLatestPending() {
  const logsDir = path.resolve("logs");
  if (!fs.existsSync(logsDir)) return null;
  const files = fs
    .readdirSync(logsDir)
    .filter((f) => /^pending-(discovery|monitor)-.+\.json$/.test(f))
    .map((f) => path.join(logsDir, f));
  if (!files.length) return null;
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
}

async function replayOne(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const payload = JSON.parse(raw);

  const phase = cleanText(payload.phase);
  const runId = cleanText(payload.run_id) || "replay";
  const rows = Array.isArray(payload.rows) ? payload.rows : [];

  if (!phase || !rows.length) {
    throw new Error(`Invalid pending payload: phase=${phase || "n/a"} rows=${rows.length}`);
  }

  console.log(`[INFO] replay_start file=${filePath} phase=${phase} rows=${rows.length}`);

  if (phase === "discovery") {
    const res = await persistDiscoveryInsertOnlyBatched(rows, { phase: "discovery_replay", runId, log: console.log });
    console.log(`[INFO] replay_done file=${filePath} inserted=${res.inserted} versions_inserted=${res.versionsInserted}`);
    return;
  }

  if (phase === "monitor") {
    const res = await persistToDatabaseBatched(rows, { phase: "monitor_replay", runId, log: console.log });
    console.log(
      `[INFO] replay_done file=${filePath} inserted=${res.inserted} updated=${res.updated} versions_inserted=${res.versionsInserted}`
    );
    return;
  }

  throw new Error(`Unknown pending phase: ${phase}`);
}

async function main() {
  const args = process.argv.slice(2).filter(Boolean);
  const files = args.length ? args : [findLatestPending()].filter(Boolean);

  if (!files.length) {
    usage();
    process.exit(2);
  }

  for (const f of files) {
    // eslint-disable-next-line no-await-in-loop
    await replayOne(f);
  }
}

main().catch((err) => {
  console.error(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
