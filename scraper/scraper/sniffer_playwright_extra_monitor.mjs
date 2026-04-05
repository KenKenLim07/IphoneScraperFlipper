import fs from "node:fs";
import process from "node:process";
import { randomUUID } from "node:crypto";

import { launchPersistentContext } from "./playwright_extra/browser.mjs";
import { parseCommonArgs, readRuntimeConfig } from "./playwright_extra/config.mjs";
import { makeLogger } from "./playwright_extra/logger.mjs";
import { runBootstrapLogin, runMonitorJob } from "./playwright_extra/jobs.mjs";
import { loadDotenv } from "./env.mjs";

// Load `scraper/.env` even when invoked from repo root.
loadDotenv();

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

async function main() {
  const args = parseCommonArgs(process.argv);
  const extra = parseMonitorArgs(process.argv);
  const runId = randomUUID();
  const started = Date.now();

  const cfg = readRuntimeConfig(args);
  const { log, error } = makeLogger(runId);
  const limitUsed = extra.limit ?? cfg.watchlistRecheckLimit;

  fs.mkdirSync(cfg.userDataDir, { recursive: true });

  log(`[INFO] run_id=${runId}`);
  log(`[INFO] mode=monitor browser_channel=${cfg.browserChannel} headless=${cfg.headless} use_stealth=${cfg.useStealth}`);
  log(`[INFO] watchlist_limit=${limitUsed} watchlist_concurrency=${cfg.watchlistConcurrency}`);
  log(`[INFO] user_data_dir=${cfg.userDataDir}`);

  const context = await launchPersistentContext({
    userDataDir: cfg.userDataDir,
    browserChannel: cfg.browserChannel,
    headless: cfg.headless,
    useStealth: cfg.useStealth && !cfg.bootstrapLogin
  });

  try {
    if (cfg.bootstrapLogin) {
      await runBootstrapLogin({ context, log });
      return 0;
    }

    await runMonitorJob({
      context,
      cfg,
      runId,
      log,
      limit: limitUsed,
      writeMonitorJson: true,
      logRowsOnDryRun: true
    });
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
