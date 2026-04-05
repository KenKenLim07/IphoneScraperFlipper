import fs from "node:fs";
import path from "node:path";

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return { keys: new Set(), missing: true };
  const text = fs.readFileSync(filePath, "utf8");
  const keys = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (key) keys.add(key);
  }
  return { keys, missing: false };
}

const USED_BY_PLAYWRIGHT_EXTRA = new Set([
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "FB_MARKETPLACE_ILOILO_URL",
  "PLAYWRIGHT_PROFILE_DIR",
  "PLAYWRIGHT_PROFILE_ISOLATE_BY_CHANNEL",
  "PLAYWRIGHT_BROWSER_CHANNEL",
  "PLAYWRIGHT_HEADLESS",
  "PLAYWRIGHT_EXTRA_USE_STEALTH",
  "PLAYWRIGHT_DISCOVERY_ENRICH_ENABLED",
  "PLAYWRIGHT_DISCOVERY_ENRICH_CONCURRENCY",
  "PLAYWRIGHT_DISCOVERY_ENRICH_CHUNK_SIZE",
  "PLAYWRIGHT_DISCOVERY_ENRICH_BLOCK_IMAGES",
  "PLAYWRIGHT_DISCOVERY_FEED_BLOCK_IMAGES",
  "PLAYWRIGHT_DISCOVERY_MIN_PRICE_PHP",
  "PLAYWRIGHT_DISCOVERY_EXCLUDE_KEYWORDS",
  "PLAYWRIGHT_DISCOVERY_REQUIRE_IPHONE_MODEL",
  "PLAYWRIGHT_WATCHLIST_RECHECK_LIMIT",
  "PLAYWRIGHT_WATCHLIST_RECHECK_CONCURRENCY",
  "PLAYWRIGHT_WATCHLIST_CHUNK_SIZE",
  "PLAYWRIGHT_MONITOR_BLOCK_IMAGES",
  "PLAYWRIGHT_MONITOR_WAIT_FOR_NETWORKIDLE",
  "SCRAPE_GOTO_RETRY_COUNT",
  "SCRAPE_DELAY_MIN_MS",
  "SCRAPE_DELAY_MAX_MS",
  "SCRAPE_USE_NETWORK",
  "SCRAPE_NETWORK_SAVE_RAW",
  "SCRAPE_NETWORK_DEBUG",
  "SCRAPE_NETWORK_DEBUG_ALL",
  "SCRAPE_LOG_PROGRESS",
  "SCRAPE_LOG_FILE",
  "SCRAPE_SCROLL_PAGES",
  "SCRAPE_SCROLL_DELAY_MS",
  "SCRAPE_FEED_SELECTOR_TIMEOUT_MS"
  ,
  "DB_RETRY_COUNT",
  "DB_RETRY_BASE_MS",
  "DB_BATCH_SIZE"
  ,
  "DB_LOG_CHANGES",
  "DB_LOG_CHANGE_LIMIT"
]);

function diffKeys(a, b) {
  const out = [];
  for (const k of a) if (!b.has(k)) out.push(k);
  return out.sort();
}

function printList(label, items) {
  if (!items.length) return;
  console.log(label);
  for (const item of items) console.log(`- ${item}`);
  console.log("");
}

function main() {
  const envPath = path.resolve(".env");
  const examplePath = path.resolve(".env.example");

  const env = parseEnvFile(envPath);
  const example = parseEnvFile(examplePath);

  if (env.missing) {
    console.log("[WARN] .env is missing (create it from .env.example).");
  }
  if (example.missing) {
    console.log("[WARN] .env.example is missing.");
  }

  const envOnly = diffKeys(env.keys, example.keys);
  const exampleOnly = diffKeys(example.keys, env.keys);

  const envUnused = diffKeys(env.keys, USED_BY_PLAYWRIGHT_EXTRA);
  const exampleUnused = diffKeys(example.keys, USED_BY_PLAYWRIGHT_EXTRA);

  printList("[INFO] Keys in .env but not in .env.example:", envOnly);
  printList("[INFO] Keys in .env.example but not in .env:", exampleOnly);
  printList("[INFO] Keys in .env not used by Playwright-extra sniffer:", envUnused);
  printList("[INFO] Keys in .env.example not used by Playwright-extra sniffer:", exampleUnused);

  console.log("[INFO] Keys used by Playwright-extra sniffer:");
  for (const k of Array.from(USED_BY_PLAYWRIGHT_EXTRA).sort()) console.log(`- ${k}`);
}

main();
