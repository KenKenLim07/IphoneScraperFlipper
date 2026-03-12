import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";

import { launchPersistentContext } from "./playwright_extra/browser.mjs";
import { parseCommonArgs, readRuntimeConfig } from "./playwright_extra/config.mjs";
import { persistToDatabaseBatched } from "./playwright_extra/db.mjs";
import { makeLogger } from "./playwright_extra/logger.mjs";
import { fetchWatchlistCandidates, recheckCandidatesChunk } from "./playwright_extra/monitor.mjs";

dotenv.config();

async function main() {
  const args = parseCommonArgs(process.argv);
  const runId = randomUUID();
  const started = Date.now();

  const cfg = readRuntimeConfig(args);
  const { log, error } = makeLogger(runId);

  fs.mkdirSync(cfg.userDataDir, { recursive: true });

  log(`[INFO] run_id=${runId}`);
  log(`[INFO] mode=monitor browser_channel=${cfg.browserChannel} headless=${cfg.headless} use_stealth=${cfg.useStealth}`);
  log(`[INFO] user_data_dir=${cfg.userDataDir}`);

  const context = await launchPersistentContext({
    userDataDir: cfg.userDataDir,
    browserChannel: cfg.browserChannel,
    headless: cfg.headless,
    useStealth: cfg.useStealth && !cfg.bootstrapLogin
  });

  try {
    if (cfg.bootstrapLogin) {
      const page = await context.newPage();
      await page.goto("https://www.facebook.com/login", { waitUntil: "domcontentloaded", timeout: 90000 });
      log("[INFO] Bootstrap mode active.");
      log("[INFO] Log in in the browser window, open Marketplace, then press Enter here.");
      process.stdin.resume();
      await new Promise((resolve) => process.stdin.once("data", resolve));
      log("[INFO] Profile session saved.");
      return 0;
    }

    const candidates = await fetchWatchlistCandidates({
      limit: cfg.watchlistRecheckLimit,
      mode: cfg.watchlistMode,
      tzOffsetMinutes: cfg.watchlistTzOffsetMinutes
    });
    const candidatesCount = candidates.length;
    log(
      `[INFO] monitor_start limit=${cfg.watchlistRecheckLimit} mode=${cfg.watchlistMode} concurrency=${cfg.watchlistConcurrency} ` +
        `chunk_size=${cfg.watchlistChunkSize} candidates=${candidatesCount}`
    );

    const rows = [];
    const size = Math.max(1, cfg.watchlistChunkSize || 20);
    let totalUpdated = 0;
    let totalVersions = 0;

    for (let i = 0; i < candidates.length; i += size) {
      const chunk = candidates.slice(i, i + size);
      // eslint-disable-next-line no-await-in-loop
      const out = await recheckCandidatesChunk({
        context,
        runId,
        queryUrl: cfg.queryUrl,
        gotoRetries: cfg.gotoRetries,
        delayMin: cfg.delayMin,
        delayMax: cfg.delayMax,
        concurrency: cfg.watchlistConcurrency,
        candidates: chunk,
        logEnabled: cfg.logEnabled,
        log
      });
      rows.push(...out);

      if (!cfg.dryRun && out.length) {
        // eslint-disable-next-line no-await-in-loop
        const res = await persistToDatabaseBatched(out, { phase: "monitor", runId, log });
        totalUpdated += res.updated;
        totalVersions += res.versionsInserted;
        log(
          `[INFO] results phase=monitor_chunk processed=${out.length} listings_updated=${res.updated} versions_inserted=${res.versionsInserted}`
        );
      }
    }

    const logsDir = path.resolve("logs");
    fs.mkdirSync(logsDir, { recursive: true });
    const monitorPath = path.join(logsDir, `monitor-${runId}.json`);
    fs.writeFileSync(monitorPath, JSON.stringify(rows, null, 2));
    log(`[INFO] monitor_json=${monitorPath}`);

    if (cfg.dryRun) {
      for (const row of rows) log(JSON.stringify(row));
    } else {
      log(
        `[INFO] results phase=monitor rechecked=${candidatesCount} listings_updated=${totalUpdated} versions_inserted=${totalVersions}`
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    error(`[ERROR] ${msg}`);
    return 1;
  } finally {
    await context.close();
  }

  const elapsedSeconds = ((Date.now() - started) / 1000).toFixed(2);
  log(`[SUMMARY] run_id=${runId} status=success elapsed_seconds=${elapsedSeconds}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.stack : String(e));
    process.exit(1);
  });
