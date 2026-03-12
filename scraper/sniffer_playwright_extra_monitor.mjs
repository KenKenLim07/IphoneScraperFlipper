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
import { cleanText, envBool } from "./playwright_extra/utils.mjs";

dotenv.config();

function parseMonitorArgs(argv) {
  const out = { limit: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--limit") {
      out.limit = Number.parseInt(argv[i + 1], 10);
      i += 1;
    } else if (arg.startsWith("--limit=")) {
      out.limit = Number.parseInt(arg.split("=", 2)[1], 10);
    }
  }
  if (out.limit != null) out.limit = Math.max(1, out.limit);
  return out;
}

function formatCounts(map) {
  if (!map) return "";
  const entries = Object.entries(map).filter(([, v]) => (v || 0) > 0);
  if (!entries.length) return "";
  entries.sort((a, b) => b[1] - a[1]);
  return entries.map(([k, v]) => `${k}=${v}`).join(" ");
}

function logChangeSamples(log, res) {
  if (!res || !Array.isArray(res.changeSamples) || !res.changeSamples.length) return;
  for (const c of res.changeSamples.slice(0, 25)) {
    const prevPrice = c?.prev?.price_php ?? null;
    const nextPrice = c?.next?.price_php ?? null;
    log(
      `[INFO] db_change listing_id=${c.listing_id} changed=${JSON.stringify(c.changed_fields)} ` +
        `price_php=${prevPrice ?? "n/a"}->${nextPrice ?? "n/a"} desc_len=${c.prev.description_len}->${c.next.description_len}`
    );
  }
}

function collectSamples(dst, res, limit) {
  if (!res || !Array.isArray(res.changeSamples) || !res.changeSamples.length) return;
  for (const c of res.changeSamples) {
    if (dst.length >= limit) return;
    dst.push(c);
  }
}

async function main() {
  const args = parseCommonArgs(process.argv);
  const extra = parseMonitorArgs(process.argv);
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
      limit: extra.limit ?? cfg.watchlistRecheckLimit,
    });
    const candidatesCount = candidates.length;
    log(
      `[INFO] monitor_start limit=${extra.limit ?? cfg.watchlistRecheckLimit} mode=oldest concurrency=${cfg.watchlistConcurrency} ` +
        `chunk_size=${cfg.watchlistChunkSize} candidates=${candidatesCount}`
    );

    const rows = [];
    const size = Math.max(1, cfg.watchlistChunkSize || 20);
    let totalUpdated = 0;
    let totalVersions = 0;
    const totalFieldCounts = Object.create(null);
    const logChanges = envBool("DB_LOG_CHANGES", false);
    const changeSamples = [];
    const changeLimit = Math.max(0, Number.parseInt(process.env.DB_LOG_CHANGE_LIMIT || "25", 10) || 25);

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
        log,
        label: "monitor",
        blockImages: cfg.monitorBlockImages,
        waitForNetworkIdle: cfg.monitorWaitForNetworkIdle,
        progressBase: i,
        progressTotal: candidates.length
      });
      rows.push(...out);

      if (!cfg.dryRun && out.length) {
        // eslint-disable-next-line no-await-in-loop
        const res = await persistToDatabaseBatched(out, { phase: "monitor", runId, log });
        totalUpdated += res.updated;
        totalVersions += res.versionsInserted;
        if (res.changedFieldCounts) {
          for (const [k, v] of Object.entries(res.changedFieldCounts)) {
            totalFieldCounts[k] = (totalFieldCounts[k] || 0) + (v || 0);
          }
        }
        if (logChanges) collectSamples(changeSamples, res, changeLimit);
        if (logChanges) logChangeSamples(log, res);
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
      const counts = formatCounts(totalFieldCounts);
      if (counts) log(`[INFO] db_change_counts ${counts}`);
      if (logChanges && changeSamples.length) {
        log(`[INFO] db_change_samples count=${changeSamples.length} (showing=${Math.min(changeSamples.length, 10)})`);
        for (const c of changeSamples.slice(0, 10)) {
          const prevPrice = c?.prev?.price_php ?? null;
          const nextPrice = c?.next?.price_php ?? null;
          log(
            `[INFO] db_change_sample listing_id=${c.listing_id} changed=${JSON.stringify(c.changed_fields)} ` +
              `price_php=${prevPrice ?? "n/a"}->${nextPrice ?? "n/a"} desc_len=${c.prev.description_len}->${c.next.description_len}`
          );
        }
      }
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
