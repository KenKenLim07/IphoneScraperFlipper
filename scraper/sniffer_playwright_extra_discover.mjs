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
import { cleanText, gotoWithRetry, randomBetween, requireEnv, sleep } from "./playwright_extra/utils.mjs";

dotenv.config();

async function main() {
  const args = parseCommonArgs(process.argv);
  const runId = randomUUID();
  const started = Date.now();

  const cfg = readRuntimeConfig(args);
  const { log, error } = makeLogger(runId);

  fs.mkdirSync(cfg.userDataDir, { recursive: true });

  log(`[INFO] run_id=${runId}`);
  log(`[INFO] mode=discovery browser_channel=${cfg.browserChannel} headless=${cfg.headless} use_stealth=${cfg.useStealth}`);
  log(`[INFO] user_data_dir=${cfg.userDataDir}`);

  const context = await launchPersistentContext({
    userDataDir: cfg.userDataDir,
    browserChannel: cfg.browserChannel,
    headless: cfg.headless,
    useStealth: cfg.useStealth && !cfg.bootstrapLogin
  });

  try {
    const page = await context.newPage();

    await gotoWithRetry(
      page,
      cfg.bootstrapLogin ? "https://www.facebook.com/login" : cfg.queryUrl,
      cfg.gotoRetries,
      4000
    );

    if (cfg.bootstrapLogin) {
      log("[INFO] Bootstrap mode active.");
      log("[INFO] Log in in the browser window, open Marketplace, then press Enter here.");
      process.stdin.resume();
      await new Promise((resolve) => process.stdin.once("data", resolve));
      log("[INFO] Profile session saved.");
      return 0;
    }

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

    const logsDir = path.resolve("logs");
    fs.mkdirSync(logsDir, { recursive: true });
    const discoveryPath = path.join(logsDir, `discovery-${runId}.json`);
    fs.writeFileSync(discoveryPath, JSON.stringify(extracted.rows, null, 2));
    log(`[INFO] discovery_json=${discoveryPath}`);

    if (cfg.dryRun) {
      for (const row of extracted.rows) log(JSON.stringify(row));
    } else {
      const res = await persistToDatabaseBatched(extracted.rows, { phase: "discovery", runId, log });
      log(
        `[INFO] results phase=discovery cards_found=${extracted.cardsSeen} inserted=${res.inserted} skipped_existing=${res.existing} ` +
          `listings_updated=${res.updated} versions_inserted=${res.versionsInserted}`
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

