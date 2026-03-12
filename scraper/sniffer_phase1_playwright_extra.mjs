import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";

import { launchPersistentContext } from "./playwright_extra/browser.mjs";
import { parseCommonArgs, readRuntimeConfig } from "./playwright_extra/config.mjs";
import { persistToDatabaseBatched } from "./playwright_extra/db.mjs";
import { extractDiscoveryRows } from "./playwright_extra/extract_feed.mjs";
import { looksLikeLoginOrBlock } from "./playwright_extra/fb_checks.mjs";
import { makeLogger } from "./playwright_extra/logger.mjs";
import { fetchWatchlistCandidates, recheckCandidatesChunk } from "./playwright_extra/monitor.mjs";
import { gotoWithRetry, randomBetween, sleep } from "./playwright_extra/utils.mjs";

dotenv.config();

function parseMode(argv) {
  for (const arg of argv.slice(2)) {
    if (arg === "--discover-only") return "discover";
    if (arg === "--monitor-only") return "monitor";
    if (arg.startsWith("--mode=")) return arg.split("=", 2)[1];
  }
  return "both";
}

async function bootstrapLogin(context, log) {
  const page = await context.newPage();
  await page.goto("https://www.facebook.com/login", { waitUntil: "domcontentloaded", timeout: 90000 });
  log("[INFO] Bootstrap mode active.");
  log("[INFO] Log in in the browser window, open Marketplace, then press Enter here.");
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once("data", resolve));
  log("[INFO] Profile session saved.");
  await page.close();
}

async function main() {
  const args = parseCommonArgs(process.argv);
  const mode = (parseMode(process.argv) || "both").toLowerCase();
  const runId = randomUUID();
  const started = Date.now();

  const cfg = readRuntimeConfig(args);
  const { log, error } = makeLogger(runId);

  fs.mkdirSync(cfg.userDataDir, { recursive: true });

  log(`[INFO] run_id=${runId}`);
  log(`[INFO] mode=${mode} browser_channel=${cfg.browserChannel} headless=${cfg.headless} use_stealth=${cfg.useStealth}`);
  log(`[INFO] user_data_dir=${cfg.userDataDir}`);

  const context = await launchPersistentContext({
    userDataDir: cfg.userDataDir,
    browserChannel: cfg.browserChannel,
    headless: cfg.headless,
    useStealth: cfg.useStealth && !cfg.bootstrapLogin
  });

  let status = "success";
  let cardsSeen = 0;
  let rowsExtracted = 0;
  let discoveryInserted = 0;
  let discoveryExisting = 0;
  let discoveryUpdated = 0;
  let discoveryVersions = 0;
  let monitorRechecked = 0;
  let monitorUpdated = 0;
  let monitorVersions = 0;

  try {
    if (cfg.bootstrapLogin) {
      await bootstrapLogin(context, log);
      return 0;
    }

    if (mode === "discover" || mode === "both") {
      const page = await context.newPage();
      await gotoWithRetry(page, cfg.queryUrl, cfg.gotoRetries, 4000);
      await sleep(randomBetween(cfg.delayMin, cfg.delayMax));
      try {
        await page.waitForLoadState("networkidle", { timeout: 15000 });
      } catch {}

      const bodyText = await page.evaluate(() => document.body?.innerText || "");
      if (looksLikeLoginOrBlock(page.url(), bodyText)) {
        throw new Error(
          "Facebook session looks logged out or blocked for this profile/channel. " +
            "Run with --bootstrap-login using the same --browser-channel."
        );
      }

      const extracted = await extractDiscoveryRows(page, {
        maxCards: cfg.maxCards,
        scrollPages: cfg.scrollPages,
        scrollDelayMs: cfg.scrollDelayMs,
        useNetwork: cfg.useNetwork,
        saveNetworkRaw: cfg.saveNetworkRaw,
        runId,
        logEnabled: cfg.logEnabled,
        log
      });

      cardsSeen = extracted.cardsSeen;
      rowsExtracted = extracted.rows.length;

      const logsDir = path.resolve("logs");
      fs.mkdirSync(logsDir, { recursive: true });
      const discoveryPath = path.join(logsDir, `discovery-${runId}.json`);
      fs.writeFileSync(discoveryPath, JSON.stringify(extracted.rows, null, 2));
      log(`[INFO] discovery_json=${discoveryPath}`);

      if (!cfg.dryRun) {
        const res = await persistToDatabaseBatched(extracted.rows, { phase: "discovery", runId, log });
        discoveryInserted = res.inserted;
        discoveryExisting = res.existing;
        discoveryUpdated = res.updated;
        discoveryVersions = res.versionsInserted;
        log(
          `[INFO] results phase=discovery cards_found=${cardsSeen} inserted=${discoveryInserted} skipped_existing=${discoveryExisting} ` +
            `listings_updated=${discoveryUpdated} versions_inserted=${discoveryVersions}`
        );
      } else {
        for (const row of extracted.rows) log(JSON.stringify(row));
      }
      await page.close();
    }

    if (!cfg.dryRun && (mode === "monitor" || mode === "both") && cfg.watchlistRecheckLimit > 0) {
      const candidates = await fetchWatchlistCandidates({
        limit: cfg.watchlistRecheckLimit,
        mode: cfg.watchlistMode,
        tzOffsetMinutes: cfg.watchlistTzOffsetMinutes
      });
      monitorRechecked = candidates.length;
      log(
        `[INFO] monitor_start limit=${cfg.watchlistRecheckLimit} mode=${cfg.watchlistMode} concurrency=${cfg.watchlistConcurrency} ` +
          `chunk_size=${cfg.watchlistChunkSize} candidates=${monitorRechecked}`
      );

      const size = Math.max(1, cfg.watchlistChunkSize || 20);
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
        if (!out.length) continue;
        // eslint-disable-next-line no-await-in-loop
        const res = await persistToDatabaseBatched(out, { phase: "monitor", runId, log });
        monitorUpdated += res.updated;
        monitorVersions += res.versionsInserted;
        log(
          `[INFO] results phase=monitor_chunk processed=${out.length} listings_updated=${res.updated} versions_inserted=${res.versionsInserted}`
        );
      }
      log(
        `[INFO] results phase=monitor rechecked=${monitorRechecked} listings_updated=${monitorUpdated} versions_inserted=${monitorVersions}`
      );
    }
  } catch (e) {
    status = "failed";
    const msg = e instanceof Error ? e.message : String(e);
    error(`[ERROR] ${msg}`);
  } finally {
    await context.close();
  }

  const elapsedSeconds = ((Date.now() - started) / 1000).toFixed(2);
  log(
    `[SUMMARY] run_id=${runId} status=${status} cards_seen=${cardsSeen} rows_extracted=${rowsExtracted} ` +
      `inserted=${discoveryInserted} skipped_existing=${discoveryExisting} listings_updated=${discoveryUpdated} ` +
      `versions_inserted=${discoveryVersions} monitor_rechecked=${monitorRechecked} monitor_updated=${monitorUpdated} ` +
      `monitor_versions=${monitorVersions} elapsed_seconds=${elapsedSeconds}`
  );

  return status === "success" ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.stack : String(e));
    process.exit(1);
  });
