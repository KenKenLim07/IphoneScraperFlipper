import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  fetchExistingListingIds,
  persistDiscoveryInsertOnlyBatched,
  persistDiscoveryNetworkUpdateBatched,
  persistToDatabaseBatched
} from "./db.mjs";
import { extractDiscoveryRows, installNetworkListingCollector } from "./extract_feed.mjs";
import { looksLikeLoginOrBlock } from "./fb_checks.mjs";
import { fetchWatchlistCandidates, recheckCandidatesChunk } from "./monitor.mjs";
import { envBool, gotoWithRetry, looksLikeBuyerWantedPost, randomBetween, sleep } from "./utils.mjs";

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

  if (cfg.discoveryFilterBuyers) {
    if (looksLikeBuyerWantedPost(row?.title || "")) return { skip: true, reason: "buyer_post" };
  }

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
      // If we can't parse a price at all, it's often a swap/ad/accessory. Let monitor pick up real phones later.
      if (cfg.discoveryRequireIphoneModel && hasModel) {
        // Keep model-matching listings for enrichment to fetch the real price.
        return { skip: false, reason: null };
      }
      return { skip: true, reason: "no_price" };
    }
  }

  return { skip: false, reason: null };
}

export async function runBootstrapLogin({ context, log }) {
  const page = await context.newPage();
  await page.goto("https://www.facebook.com/login", { waitUntil: "domcontentloaded", timeout: 90000 });
  log("[INFO] Bootstrap mode active.");
  log("[INFO] Log in in the browser window, open Marketplace, then press Enter here.");
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once("data", resolve));
  log("[INFO] Profile session saved.");
  await page.close();
}

export async function runDiscoveryJob({
  context,
  cfg,
  runId,
  log,
  writeDiscoveryJson = true
}) {
  const page = await context.newPage();
  try {
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

    const networkCollector = cfg.useNetwork
      ? installNetworkListingCollector(page, { log, saveNetworkRaw: cfg.saveNetworkRaw })
      : null;

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
      log,
      networkCollector,
      graphqlOnly: cfg.discoveryGraphqlOnly
    });

    if (writeDiscoveryJson) {
      const logsDir = path.resolve("logs");
      fs.mkdirSync(logsDir, { recursive: true });
      const discoveryPath = path.join(logsDir, `discovery-${runId}.json`);
      fs.writeFileSync(discoveryPath, JSON.stringify(extracted.rows, null, 2));
      log(`[INFO] discovery_json=${discoveryPath}`);
    }

    if (cfg.dryRun) {
      for (const row of extracted.rows) log(JSON.stringify(row));
      return {
        cardsSeen: extracted.cardsSeen,
        rowsExtracted: extracted.rows.length,
        inserted: 0,
        skippedExisting: 0,
        versionsInserted: 0
      };
    }

    const filtered = [];
    let dropped = 0;
    let droppedMinPrice = 0;
    let droppedNoPrice = 0;
    let droppedKeyword = 0;
    let droppedBuyer = 0;
    let droppedSwap = 0;
    let droppedNoModel = 0;

    for (const row of extracted.rows) {
      const decision = shouldSkipAsNoise(row, cfg);
      if (decision.skip) {
        dropped += 1;
        if (decision.reason === "min_price") droppedMinPrice += 1;
        else if (decision.reason === "no_price") droppedNoPrice += 1;
        else if (decision.reason === "exclude_keyword") droppedKeyword += 1;
        else if (decision.reason === "buyer_post") droppedBuyer += 1;
        else if (decision.reason === "swap_no_price") droppedSwap += 1;
        else if (decision.reason === "no_iphone_model") droppedNoModel += 1;
        continue;
      }
      filtered.push(row);
    }

    if (dropped) {
      log(
        `[INFO] discovery_filter dropped=${dropped} dropped_min_price=${droppedMinPrice} dropped_no_price=${droppedNoPrice} ` +
          `dropped_keyword=${droppedKeyword} dropped_buyer=${droppedBuyer} dropped_swap=${droppedSwap} ` +
          `dropped_no_model=${droppedNoModel} kept=${filtered.length}`
      );
    }

    const existingSet = await fetchExistingListingIds(
      filtered.map((r) => r.listing_id),
      { log }
    );
    const newRows = filtered.filter((r) => !existingSet.has(String(r.listing_id)));
    const existingRows = filtered.filter((r) => existingSet.has(String(r.listing_id)));

    const skippedExisting = filtered.length - newRows.length;

    const doEnrich = cfg.discoveryEnrichEnabled && !cfg.discoveryGraphqlOnly && newRows.length > 0;
    const chunkSize = Math.max(1, cfg.discoveryEnrichChunkSize || 20);
    const concurrency = Math.max(1, Math.min(cfg.discoveryEnrichConcurrency || 2, 6));

    if (cfg.discoveryGraphqlOnly && cfg.discoveryEnrichEnabled) {
      log("[INFO] discovery_graphql_only enabled; skipping enrich.");
    }
    if (doEnrich) {
      log(
        `[INFO] discovery_enrich_start candidates=${newRows.length} concurrency=${concurrency} chunk_size=${chunkSize}`
      );
    }

    let inserted = 0;
    let versionsInserted = 0;
    let updatedExisting = 0;

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
      inserted += res.inserted;
      versionsInserted += res.versionsInserted;
    }

    if (cfg.discoveryUpdateExistingGraphql && existingRows.length) {
      const res = await persistDiscoveryNetworkUpdateBatched(existingRows, { phase: "discovery_update", runId, log });
      updatedExisting = res.updated;
      log(
        `[INFO] discovery_update_existing total=${existingRows.length} updated=${res.updated} skipped=${res.skipped}`
      );
    }

    log(
      `[INFO] results phase=discovery cards_found=${extracted.cardsSeen} inserted=${inserted} skipped_existing=${skippedExisting} ` +
        `listings_updated=${updatedExisting} versions_inserted=${versionsInserted}`
    );

    return {
      cardsSeen: extracted.cardsSeen,
      rowsExtracted: extracted.rows.length,
      inserted,
      skippedExisting,
      versionsInserted
    };
  } finally {
    await page.close().catch(() => {});
  }
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

export async function runMonitorJob({
  context,
  cfg,
  runId,
  log,
  limit,
  writeMonitorJson = true,
  logRowsOnDryRun = true
}) {
  const finalLimit = limit ?? cfg.watchlistRecheckLimit;
  const candidates = await fetchWatchlistCandidates({
    limit: finalLimit
  });
  const candidatesCount = candidates.length;

  log(
    `[INFO] monitor_start limit=${finalLimit} mode=oldest concurrency=${cfg.watchlistConcurrency} ` +
      `chunk_size=${cfg.watchlistChunkSize} candidates=${candidatesCount}`
  );
  log?.(`[INFO] monitor_network enabled=${cfg.monitorUseNetwork ? "true" : "false"}`);

  const rows = [];
  const size = Math.max(1, cfg.watchlistChunkSize || 20);
  let totalUpdated = 0;
  let totalVersions = 0;
  const totalFieldCounts = Object.create(null);
  let networkHitCount = 0;
  let embedHitCount = 0;
  let noneHitCount = 0;
  let embedCheckedTotal = 0;
  let embedMatchedTotal = 0;
  const logChanges = envBool("DB_LOG_CHANGES", false);
  const changeSamples = [];
  const changeLimit = Math.max(0, Number.parseInt(process.env.DB_LOG_CHANGE_LIMIT || "25", 10) || 25);

  let wroteMonitorJson = false;
  try {
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
        useNetwork: cfg.monitorUseNetwork,
        saveNetworkRaw: cfg.saveNetworkRaw,
        progressBase: i,
        progressTotal: candidates.length
      });

      rows.push(...out);
      for (const row of out) {
        const source = row?._monitor_network_source || "none";
        if (source === "network") networkHitCount += 1;
        else if (source === "embed") embedHitCount += 1;
        else noneHitCount += 1;
        embedCheckedTotal += Number(row?._monitor_embed_checked || 0);
        embedMatchedTotal += Number(row?._monitor_embed_matched || 0);
      }

      if (cfg.dryRun) continue;
      if (!out.length) continue;

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
  } finally {
    if (writeMonitorJson) {
      try {
        const logsDir = path.resolve("logs");
        fs.mkdirSync(logsDir, { recursive: true });
        const monitorPath = path.join(logsDir, `monitor-${runId}.json`);
        fs.writeFileSync(monitorPath, JSON.stringify(rows, null, 2));
        log(`[INFO] monitor_json=${monitorPath}`);
        wroteMonitorJson = true;
      } catch {}
    }
  }

  if (cfg.dryRun) {
    if (logRowsOnDryRun) {
      for (const row of rows) log(JSON.stringify(row));
    }
    return {
      candidatesCount,
      rows,
      updated: 0,
      versionsInserted: 0,
      changedFieldCounts: Object.create(null)
    };
  }

  log(
    `[INFO] results phase=monitor rechecked=${candidatesCount} listings_updated=${totalUpdated} versions_inserted=${totalVersions}`
  );
  log(
    `[INFO] monitor_sources network=${networkHitCount} embed=${embedHitCount} none=${noneHitCount} ` +
      `embed_checked=${embedCheckedTotal} embed_matched=${embedMatchedTotal}`
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

  return {
    candidatesCount,
    rows,
    updated: totalUpdated,
    versionsInserted: totalVersions,
    changedFieldCounts: totalFieldCounts
  };
}
