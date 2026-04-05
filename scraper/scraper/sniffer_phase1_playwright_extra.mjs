import fs from "node:fs";
import process from "node:process";
import { randomUUID } from "node:crypto";

import { launchPersistentContext } from "./playwright_extra/browser.mjs";
import { parseCommonArgs, readRuntimeConfig } from "./playwright_extra/config.mjs";
import { makeLogger } from "./playwright_extra/logger.mjs";
import { runBootstrapLogin, runDiscoveryJob, runMonitorJob } from "./playwright_extra/jobs.mjs";
import { loadDotenv } from "./env.mjs";

// Load `scraper/.env` even when invoked from repo root.
loadDotenv();

function parseMode(argv) {
  for (const arg of argv.slice(2)) {
    if (arg === "--discover-only") return "discover";
    if (arg === "--monitor-only") return "monitor";
    if (arg.startsWith("--mode=")) return arg.split("=", 2)[1];
  }
  return "both";
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
  let discoveryVersions = 0;
  let monitorRechecked = 0;
  let monitorUpdated = 0;
  let monitorVersions = 0;

  try {
    if (cfg.bootstrapLogin) {
      await runBootstrapLogin({ context, log });
      return 0;
    }

    if (mode === "discover" || mode === "both") {
      const res = await runDiscoveryJob({ context, cfg, runId, log, writeDiscoveryJson: true });
      cardsSeen = res.cardsSeen;
      rowsExtracted = res.rowsExtracted;
      discoveryInserted = res.inserted;
      discoveryExisting = res.skippedExisting;
      discoveryVersions = res.versionsInserted;
    }

    if (!cfg.dryRun && (mode === "monitor" || mode === "both") && cfg.watchlistRecheckLimit > 0) {
      const monitorRes = await runMonitorJob({
        context,
        cfg,
        runId,
        log,
        limit: cfg.watchlistRecheckLimit,
        writeMonitorJson: false
      });
      monitorRechecked = monitorRes.candidatesCount;
      monitorUpdated = monitorRes.updated;
      monitorVersions = monitorRes.versionsInserted;
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
      `inserted=${discoveryInserted} skipped_existing=${discoveryExisting} listings_updated=0 ` +
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
