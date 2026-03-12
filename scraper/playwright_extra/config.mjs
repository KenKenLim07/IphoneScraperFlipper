import process from "node:process";

import { cleanText, envBool, envInt, requireEnv } from "./utils.mjs";
import { resolveProfileDir } from "./browser.mjs";

export function parseCommonArgs(argv) {
  const out = {
    bootstrapLogin: false,
    maxCards: 50,
    dryRun: false,
    browserChannel: null,
    headless: null,
    useStealth: null
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--bootstrap-login") out.bootstrapLogin = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--headless") out.headless = true;
    else if (arg === "--no-headless") out.headless = false;
    else if (arg === "--use-stealth") out.useStealth = true;
    else if (arg === "--no-stealth") out.useStealth = false;
    else if (arg === "--max-cards") {
      out.maxCards = Number.parseInt(argv[i + 1], 10) || 50;
      i += 1;
    } else if (arg === "--browser-channel") {
      out.browserChannel = argv[i + 1];
      i += 1;
    }
  }

  out.maxCards = Math.max(1, out.maxCards);
  return out;
}

export function readRuntimeConfig(args) {
  const queryUrl = requireEnv("FB_MARKETPLACE_ILOILO_URL");
  const browserChannel = cleanText(args.browserChannel) || cleanText(process.env.PLAYWRIGHT_BROWSER_CHANNEL) || "chromium";
  const headless = args.headless == null ? envBool("PLAYWRIGHT_HEADLESS", true) : args.headless;
  const useStealth = args.useStealth == null ? envBool("PLAYWRIGHT_EXTRA_USE_STEALTH", true) : args.useStealth;

  const baseProfileDir = requireEnv("PLAYWRIGHT_PROFILE_DIR");
  const userDataDir = resolveProfileDir(baseProfileDir, browserChannel);

  return {
    queryUrl,
    browserChannel,
    headless,
    useStealth,
    baseProfileDir,
    userDataDir,
    gotoRetries: envInt("SCRAPE_GOTO_RETRY_COUNT", 2),
    delayMin: envInt("SCRAPE_DELAY_MIN_MS", 0),
    delayMax: envInt("SCRAPE_DELAY_MAX_MS", 0),
    useNetwork: envBool("SCRAPE_USE_NETWORK", false),
    saveNetworkRaw: envBool("SCRAPE_NETWORK_SAVE_RAW", false),
    logEnabled: envBool("SCRAPE_LOG_PROGRESS", false),
    scrollPages: envInt("SCRAPE_SCROLL_PAGES", 0),
    scrollDelayMs: envInt("SCRAPE_SCROLL_DELAY_MS", 1200),
    feedSelectorTimeoutMs: envInt("SCRAPE_FEED_SELECTOR_TIMEOUT_MS", 60000),
    discoveryFeedBlockImages: envBool("PLAYWRIGHT_DISCOVERY_FEED_BLOCK_IMAGES", true),
    discoveryEnrichEnabled: envBool("PLAYWRIGHT_DISCOVERY_ENRICH_ENABLED", true),
    discoveryEnrichConcurrency: envInt("PLAYWRIGHT_DISCOVERY_ENRICH_CONCURRENCY", 2),
    discoveryEnrichChunkSize: envInt("PLAYWRIGHT_DISCOVERY_ENRICH_CHUNK_SIZE", 20),
    discoveryEnrichBlockImages: envBool("PLAYWRIGHT_DISCOVERY_ENRICH_BLOCK_IMAGES", true),
    discoveryMinPricePhp: envInt("PLAYWRIGHT_DISCOVERY_MIN_PRICE_PHP", 5000),
    discoveryExcludeKeywords: cleanText(process.env.PLAYWRIGHT_DISCOVERY_EXCLUDE_KEYWORDS) || "",
    discoveryRequireIphoneModel: envBool("PLAYWRIGHT_DISCOVERY_REQUIRE_IPHONE_MODEL", false),
    watchlistRecheckLimit: envInt("PLAYWRIGHT_WATCHLIST_RECHECK_LIMIT", 8),
    watchlistConcurrency: envInt("PLAYWRIGHT_WATCHLIST_RECHECK_CONCURRENCY", 1),
    watchlistChunkSize: envInt("PLAYWRIGHT_WATCHLIST_CHUNK_SIZE", 20),
    monitorBlockImages: envBool("PLAYWRIGHT_MONITOR_BLOCK_IMAGES", true),
    monitorWaitForNetworkIdle: envBool("PLAYWRIGHT_MONITOR_WAIT_FOR_NETWORKIDLE", false),
    maxCards: args.maxCards,
    dryRun: !!args.dryRun,
    bootstrapLogin: !!args.bootstrapLogin
  };
}
