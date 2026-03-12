import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";

import { launchPersistentContext } from "./playwright_extra/browser.mjs";
import { parseCommonArgs, readRuntimeConfig } from "./playwright_extra/config.mjs";
import { fetchExistingListingIds, persistDiscoveryInsertOnlyBatched, persistToDatabaseBatched } from "./playwright_extra/db.mjs";
import { extractDiscoveryRows } from "./playwright_extra/extract_feed.mjs";
import { looksLikeLoginOrBlock } from "./playwright_extra/fb_checks.mjs";
import { makeLogger } from "./playwright_extra/logger.mjs";
import { fetchWatchlistCandidates, recheckCandidatesChunk } from "./playwright_extra/monitor.mjs";
import { cleanText, envBool, gotoWithRetry, randomBetween, sleep } from "./playwright_extra/utils.mjs";

dotenv.config();

function parseKeywordList(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const IPHONE_MODEL_RE =
  /\biphone\s*(se|x|xs|max|xr|6s?|7|8|11|12|13|14|15|16|17)\b/i;

function hasIphoneModel(title, description) {
  const text = `${title || ""} ${description || ""}`.trim();
  if (!text) return false;
  return IPHONE_MODEL_RE.test(text);
}

function shouldSkipAsNoise(row, cfg) {
  const title = String(row?.title || "").toLowerCase();
  const description = String(row?.description || "");
  const price = row?.price_php;

  const keywords = parseKeywordList(cfg.discoveryExcludeKeywords);
  for (const k of keywords) {
    if (k && title.includes(k)) return { skip: true, reason: "exclude_keyword" };
  }

  const swapLike = /\bswap\b/i.test(title) || /\bswap\b/i.test(description);
  if (swapLike) {
    if (!(typeof price === "number" && Number.isFinite(price) && price >= (cfg.discoveryMinPricePhp || 0))) {
      return { skip: true, reason: "swap_no_price" };
    }
  }

  const hasModel = hasIphoneModel(title, description);
  if (cfg.discoveryRequireIphoneModel) {
    if (!hasModel) return { skip: true, reason: "no_iphone_model" };
  }

  if (Number.isFinite(cfg.discoveryMinPricePhp) && cfg.discoveryMinPricePhp > 0) {
    if (typeof price === "number" && Number.isFinite(price) && price < cfg.discoveryMinPricePhp) {
      return { skip: true, reason: "min_price" };
    }
    if (price == null) {
      if (cfg.discoveryRequireIphoneModel && hasModel) {
        return { skip: false, reason: null };
      }
      return { skip: true, reason: "no_price" };
    }
  }

  return { skip: false, reason: null };
}

function parseMode(argv) {
  for (const arg of argv.slice(2)) {
    if (arg === "--discover-only") return "discover";
    if (arg === "--monitor-only") return "monitor";
    if (arg.startsWith("--mode=")) return arg.split("=", 2)[1];
  }
  return "both";
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
      if (cfg.discoveryFeedBlockImages) {
        try {
          await page.route("**/*", (route) => {
            try {
              const type = route.request().resourceType();
              if (type === "image" || type === "media" || type === "font") return route.abort();
              return route.continue();
            } catch {
              return route.continue();
            }
          });
        } catch {}
      }
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
        selectorTimeoutMs: cfg.feedSelectorTimeoutMs,
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
        const filtered = [];
        let dropped = 0;
        let droppedMinPrice = 0;
        let droppedNoPrice = 0;
        let droppedKeyword = 0;
        let droppedSwap = 0;
        let droppedNoModel = 0;
        for (const row of extracted.rows) {
          const decision = shouldSkipAsNoise(row, cfg);
          if (decision.skip) {
            dropped += 1;
            if (decision.reason === "min_price") droppedMinPrice += 1;
            else if (decision.reason === "no_price") droppedNoPrice += 1;
            else if (decision.reason === "exclude_keyword") droppedKeyword += 1;
            else if (decision.reason === "swap_no_price") droppedSwap += 1;
            else if (decision.reason === "no_iphone_model") droppedNoModel += 1;
            continue;
          }
          filtered.push(row);
        }
        if (dropped) {
          log(
            `[INFO] discovery_filter dropped=${dropped} dropped_min_price=${droppedMinPrice} dropped_no_price=${droppedNoPrice} ` +
              `dropped_keyword=${droppedKeyword} dropped_swap=${droppedSwap} dropped_no_model=${droppedNoModel} kept=${filtered.length}`
          );
        }

        const existingSet = await fetchExistingListingIds(
          filtered.map((r) => r.listing_id),
          { log }
        );
        const newRows = filtered.filter((r) => !existingSet.has(String(r.listing_id)));

        discoveryExisting = filtered.length - newRows.length;

        const doEnrich = cfg.discoveryEnrichEnabled && newRows.length > 0;
        const chunkSize = Math.max(1, cfg.discoveryEnrichChunkSize || 20);
        const concurrency = Math.max(1, Math.min(cfg.discoveryEnrichConcurrency || 2, 6));

        if (doEnrich) {
          log(
            `[INFO] discovery_enrich_start candidates=${newRows.length} concurrency=${concurrency} chunk_size=${chunkSize}`
          );
        }

        for (let i = 0; i < newRows.length; i += chunkSize) {
          const chunk = newRows.slice(i, i + chunkSize);
          let enriched = [];
          if (doEnrich) {
            // eslint-disable-next-line no-await-in-loop
            enriched = await recheckCandidatesChunk({
              context,
              runId,
              queryUrl: cfg.queryUrl,
              gotoRetries: cfg.gotoRetries,
              delayMin: cfg.delayMin,
              delayMax: cfg.delayMax,
              concurrency,
              candidates: chunk,
              logEnabled: cfg.logEnabled,
              log,
              label: "enrich",
              blockImages: cfg.discoveryEnrichBlockImages,
              waitForNetworkIdle: false,
              progressBase: i,
              progressTotal: newRows.length
            });
          }

          const byId = new Map(enriched.map((r) => [String(r.listing_id), r]));
          const finalRows = chunk.map((r) => byId.get(String(r.listing_id)) || r);

          // eslint-disable-next-line no-await-in-loop
          const res = await persistDiscoveryInsertOnlyBatched(finalRows, { phase: "discovery", runId, log });
          discoveryInserted += res.inserted;
          discoveryVersions += res.versionsInserted;
        }

        log(
          `[INFO] results phase=discovery cards_found=${cardsSeen} inserted=${discoveryInserted} skipped_existing=${discoveryExisting} ` +
            `listings_updated=0 versions_inserted=${discoveryVersions}`
        );
      } else {
        for (const row of extracted.rows) log(JSON.stringify(row));
      }
      await page.close();
    }

    if (!cfg.dryRun && (mode === "monitor" || mode === "both") && cfg.watchlistRecheckLimit > 0) {
      const candidates = await fetchWatchlistCandidates({
        limit: cfg.watchlistRecheckLimit,
      });
      monitorRechecked = candidates.length;
      log(
        `[INFO] monitor_start limit=${cfg.watchlistRecheckLimit} mode=oldest concurrency=${cfg.watchlistConcurrency} ` +
          `chunk_size=${cfg.watchlistChunkSize} candidates=${monitorRechecked}`
      );

      const size = Math.max(1, cfg.watchlistChunkSize || 20);
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
        if (!out.length) continue;
        // eslint-disable-next-line no-await-in-loop
        const res = await persistToDatabaseBatched(out, { phase: "monitor", runId, log });
        monitorUpdated += res.updated;
        monitorVersions += res.versionsInserted;
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
      log(
        `[INFO] results phase=monitor rechecked=${monitorRechecked} listings_updated=${monitorUpdated} versions_inserted=${monitorVersions}`
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
