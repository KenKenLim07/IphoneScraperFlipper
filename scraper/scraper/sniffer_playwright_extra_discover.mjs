import fs from "node:fs";
import process from "node:process";
import { randomUUID } from "node:crypto";

import { launchPersistentContext } from "./playwright_extra/browser.mjs";
import { parseCommonArgs, readRuntimeConfig } from "./playwright_extra/config.mjs";
import { makeLogger } from "./playwright_extra/logger.mjs";
import { runBootstrapLogin, runDiscoveryJob } from "./playwright_extra/jobs.mjs";
import { loadDotenv } from "./env.mjs";

// Load `scraper/.env` even when invoked from repo root.
loadDotenv();

async function main() {
  const args = parseCommonArgs(process.argv);
  const runId = randomUUID();
  const started = Date.now();

  const cfg = readRuntimeConfig(args);
  const { log, error } = makeLogger(runId);

  fs.mkdirSync(cfg.userDataDir, { recursive: true });

  log(`[INFO] run_id=${runId}`);
  log(
    `[INFO] mode=discovery browser_channel=${cfg.browserChannel} headless=${cfg.headless} use_stealth=${cfg.useStealth} max_cards=${cfg.maxCards}`
  );
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

    await runDiscoveryJob({ context, cfg, runId, log, writeDiscoveryJson: true });
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
