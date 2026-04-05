import fs from "node:fs";
import path from "node:path";

import { MARKETPLACE_SELECTOR, NETWORK_MAX_ITEMS } from "./constants.mjs";
import {
  canonicalMarketplaceItemUrl,
  cleanText,
  extractListingId,
  extractBestPhpPriceRaw,
  extractPrice,
  inferPostedAtFromBodyText,
  inferDescription,
  inferLocation,
  inferTitle,
  makeAbsoluteFacebookUrl,
  parsePhpPrice,
  sanitizeTitle,
  sleep
} from "./utils.mjs";

function envInt(name, fallback) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function isLikelyMarketplaceResponse(url, contentType) {
  const lowerUrl = String(url || "").toLowerCase();
  const lowerType = String(contentType || "").toLowerCase();
  // Facebook often serves GraphQL as JSON, but content-type can vary.
  if (lowerUrl.includes("graphql")) return true;
  if (lowerUrl.includes("/api/graphql")) return true;
  if (lowerType.includes("application/json") && lowerUrl.includes("marketplace")) return true;
  return lowerType.includes("application/json") && (lowerUrl.includes("graphql") || lowerUrl.includes("marketplace"));
}

function safeParseJsonish(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function normalizeNetworkListing(node) {
  if (!node || typeof node !== "object") return null;
  const listing = node.listing && typeof node.listing === "object" ? node.listing : node;
  const listingType = cleanText(listing.__typename) || cleanText(node.__typename) || "";
  const allowIdFallback =
    listingType === "GroupCommerceProductItem" ||
    listingType.toLowerCase().includes("marketplace");

  // Marketplace listing id is sometimes `listing_id`, sometimes just `id` on listing objects.
  // Never use the feed-story node's `id` (it contains colon-delimited story metadata).
  const listingId = listing.listing_id || node.listing_id || (allowIdFallback ? listing.id : null);
  if (!listingId) return null;
  const title =
    listing.marketplace_listing_title ||
    listing.title ||
    listing.listing_title ||
    node.marketplace_listing_title ||
    node.title ||
    null;
  const description =
    listing.marketplace_listing_description ||
    listing.marketplace_description ||
    listing.description ||
    node.marketplace_listing_description ||
    node.description ||
    null;
  const priceObj = listing.listing_price || listing.price || node.listing_price || node.price || null;
  let priceRaw = null;
  if (priceObj && typeof priceObj === "object") {
    priceRaw =
      priceObj.formatted_amount ||
      priceObj.formatted_amount_with_symbols ||
      priceObj.formatted_amount_without_currency ||
      priceObj.formatted_price ||
      null;
    if (!priceRaw && priceObj.amount && priceObj.currency) {
      priceRaw = `${priceObj.currency} ${priceObj.amount}`;
    }
  } else if (typeof priceObj === "string" || typeof priceObj === "number") {
    priceRaw = String(priceObj);
  }

  // If we can't see a price at all, it's very likely not a listing card node (avoid false positives like profile ids).
  if (!cleanText(priceRaw)) return null;

  const locationObj =
    listing.location ||
    listing.location_text ||
    listing.location_name ||
    listing.location_info ||
    node.location ||
    node.location_text ||
    node.location_name ||
    null;
  let locationRaw = null;
  if (typeof locationObj === "string") locationRaw = locationObj;
  if (locationObj && typeof locationObj === "object") {
    locationRaw =
      locationObj.full_address ||
      locationObj.label ||
      locationObj.text ||
      locationObj.name ||
      locationObj.city ||
      null;
  }

  const url = canonicalMarketplaceItemUrl(String(listingId), String(listingId));
  return {
    listing_id: String(listingId),
    url,
    title: sanitizeTitle(title),
    description: cleanText(description),
    location_raw: cleanText(locationRaw),
    price_raw: cleanText(priceRaw),
    price_php: parsePhpPrice(priceRaw),
    listing_status: "active"
  };
}

function collectNetworkListings(payload, outMap) {
  const stack = [payload];
  let inspected = 0;
  while (stack.length && inspected < 20000) {
    const current = stack.pop();
    inspected += 1;
    if (!current || typeof current !== "object") continue;

    const candidate = normalizeNetworkListing(current);
    if (candidate && !outMap.has(candidate.listing_id)) {
      outMap.set(candidate.listing_id, candidate);
      if (outMap.size >= NETWORK_MAX_ITEMS) return;
    }

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else {
      for (const value of Object.values(current)) stack.push(value);
    }
  }
}

async function scrollPage(page, delayMs) {
  await page.evaluate(() => {
    window.scrollBy(0, Math.floor(window.innerHeight * 0.9));
  });
  if (delayMs > 0) await sleep(delayMs);
}

async function extractFromDom(page, { maxCards, scrollPages, scrollDelayMs, runId, scrapedAt, logEnabled, log, seenInRun }) {
  const seenAnchors = new Set();
  const rawRows = [];
  const totalPasses = Math.max(0, scrollPages) + 1;
  for (let pass = 0; pass < totalPasses; pass += 1) {
    // eslint-disable-next-line no-await-in-loop
    const batch = await page.evaluate(
      ({ selector, maxCards }) => {
        const anchors = Array.from(document.querySelectorAll(selector));
        const out = [];
        for (const a of anchors) {
          if (out.length >= maxCards) break;
          if (!(a instanceof HTMLAnchorElement)) continue;
          const href = a.getAttribute("href") || "";
          if (!href.includes("/marketplace/item/")) continue;
          const rect = a.getBoundingClientRect();
          if (!(rect.bottom > 0 && rect.top < window.innerHeight)) continue;
          const card =
            a.closest("div[role='article']") ||
            a.closest("div[data-testid*='marketplace_feed_item']") ||
            a.closest("div");
          out.push({
            href,
            anchorText: (a.textContent || "").trim(),
            cardText: card ? (card.innerText || "").trim() : "",
            title:
              card?.querySelector("h2 span")?.textContent?.trim() ||
              card?.querySelector("span[dir='auto']")?.textContent?.trim() ||
              card?.querySelector("div[dir='auto']")?.textContent?.trim() ||
              null
          });
        }
        return out;
      },
      { selector: MARKETPLACE_SELECTOR, maxCards }
    );

    for (const row of batch) {
      if (rawRows.length >= maxCards) break;
      const key = row.href || "";
      if (!key || seenAnchors.has(key)) continue;
      seenAnchors.add(key);
      rawRows.push(row);
    }
    if (rawRows.length >= maxCards) break;
    if (pass < totalPasses - 1) {
      // eslint-disable-next-line no-await-in-loop
      await scrollPage(page, scrollDelayMs);
    }
  }

  let dupListingIdsSkipped = 0;
  const seen = new Map();
  for (const raw of rawRows) {
    const rawUrl = makeAbsoluteFacebookUrl(raw.href);
    const listingId = extractListingId(rawUrl);
    if (!listingId) continue;
    if (seenInRun.has(listingId)) {
      dupListingIdsSkipped += 1;
      continue;
    }
    seenInRun.add(listingId);
    const url = canonicalMarketplaceItemUrl(rawUrl, listingId);
    const title = sanitizeTitle(inferTitle(raw.cardText, raw.title || raw.anchorText));
    const priceRaw = extractBestPhpPriceRaw(raw.cardText) || extractPrice(raw.cardText);
    const pricePhp = parsePhpPrice(priceRaw);
    const locationRaw = inferLocation(raw.cardText);
    const description = inferDescription(raw.cardText, title, priceRaw);
    const postedAt = inferPostedAtFromBodyText(raw.cardText, scrapedAt);
    if (logEnabled) {
      log(
        `[INFO] row_extracted listing_id=${listingId} title=${title || "n/a"} price=${priceRaw || "n/a"} ` +
          `location=${locationRaw || "n/a"}`
      );
    }
    seen.set(listingId, {
      listing_id: listingId,
      url,
      title,
      description,
      location_raw: locationRaw,
      price_raw: priceRaw,
      price_php: pricePhp,
      listing_status: "active",
      posted_at: postedAt,
      scraped_at: scrapedAt,
      run_id: runId
    });
  }

  return { rows: Array.from(seen.values()), cardsSeen: rawRows.length, dupListingIdsSkipped };
}

export function installNetworkListingCollector(page, { log, saveNetworkRaw }) {
  const networkPayloads = [];
  const networkListings = new Map();
  let networkCandidates = 0;
  let networkJsonResponses = 0;
  let firstParsed = null;
  let networkDebugLogged = 0;

  const pending = new Set();

  const networkDebug = String(process.env.SCRAPE_NETWORK_DEBUG || "").trim().toLowerCase();
  const networkDebugEnabled = ["1", "true", "yes", "on"].includes(networkDebug);
  const networkDebugAll = ["1", "true", "yes", "on"].includes(
    String(process.env.SCRAPE_NETWORK_DEBUG_ALL || "").trim().toLowerCase()
  );

  function onResponse(response) {
    const task = (async () => {
      try {
        const contentType = response.headers()["content-type"] || "";
        const url = response.url();
        const isCandidate = isLikelyMarketplaceResponse(url, contentType);
        if ((networkDebugAll || (networkDebugEnabled && isCandidate)) && networkDebugLogged < 30) {
          networkDebugLogged += 1;
          log?.(
            `[INFO] network_debug url=${url} status=${response.status()} content_type=${String(contentType).slice(0, 80)}`
          );
        }

        if (!isCandidate) return;
        networkCandidates += 1;

        const text = await response.text();
        const data = safeParseJsonish(text);
        if (!data) {
          if (networkDebugEnabled) {
            const status = response.status();
            const preview = cleanText(text)?.slice(0, 120) || "n/a";
            log?.(
              `[WARN] graphql_non_json status=${status} content_type=${String(contentType).slice(0, 60)} ` +
                `preview="${preview}"`
            );
          }
          return;
        }

        networkJsonResponses += 1;
        if (!firstParsed) firstParsed = { url, data };
        if (saveNetworkRaw && networkPayloads.length < 50) {
          networkPayloads.push({ url, data });
        }

        const networkMap = new Map();
        collectNetworkListings(data, networkMap);
        for (const [key, value] of networkMap.entries()) {
          if (!networkListings.has(key)) networkListings.set(key, value);
        }
      } catch {}
    })();

    pending.add(task);
    task.finally(() => pending.delete(task));
  }

  page.on("response", onResponse);

  async function flush(timeoutMs = 2000) {
    const start = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const tasks = Array.from(pending);
      if (!tasks.length) return;
      if (Date.now() - start > timeoutMs) return;
      // eslint-disable-next-line no-await-in-loop
      await Promise.race([Promise.allSettled(tasks), sleep(100)]);
    }
  }

  return {
    flush,
    getState() {
      return {
        networkPayloads,
        networkListings,
        networkCandidates,
        networkJsonResponses,
        firstParsed
      };
    }
  };
}

export async function extractDiscoveryRows(page, opts) {
  const {
    maxCards,
    scrollPages,
    scrollDelayMs,
    selectorTimeoutMs,
    useNetwork,
    saveNetworkRaw,
    runId,
    logEnabled,
    log,
    networkCollector
  } = opts;

  const effectiveCollector = useNetwork
    ? networkCollector || installNetworkListingCollector(page, { log, saveNetworkRaw })
    : null;

  try {
    await page.waitForSelector(MARKETPLACE_SELECTOR, { timeout: Math.max(1, selectorTimeoutMs || 60000) });
  } catch (err) {
    try {
      const logsDir = path.resolve("logs");
      fs.mkdirSync(logsDir, { recursive: true });

      const finalUrl = cleanText(page.url()) || "n/a";
      let title = "n/a";
      try {
        title = cleanText(await page.title()) || "n/a";
      } catch {}

      let bodyPreview = "n/a";
      try {
        const bodyText = await page.evaluate(() => document.body?.innerText || "");
        bodyPreview = cleanText(bodyText)?.slice(0, 240) || "n/a";
      } catch {}

      const htmlPath = path.join(logsDir, `feed-timeout-${runId}.html`);
      try {
        const html = await page.content();
        fs.writeFileSync(htmlPath, html);
      } catch {}

      const screenshotPath = path.join(logsDir, `feed-timeout-${runId}.png`);
      try {
        await page.screenshot({ path: screenshotPath, fullPage: false });
      } catch {}

      log?.(
        `[ERROR] discovery_feed_timeout timeout_ms=${Math.max(1, selectorTimeoutMs || 60000)} final_url=${finalUrl} title=${title} ` +
          `body_preview="${bodyPreview}" debug_html=${htmlPath} debug_png=${screenshotPath}`
      );
    } catch {}
    throw err;
  }

  let cardsSeen = 0;
  let rows = [];
  let dupListingIdsSkipped = 0;
  const seenInRun = new Set();
  const scrapedAt = new Date().toISOString();

  if (useNetwork) {
    // Network-first: scroll to trigger GraphQL payloads, then fall back to DOM to top-up.
    const totalPasses = Math.max(0, scrollPages) + 1;
    for (let pass = 0; pass < totalPasses - 1; pass += 1) {
      // eslint-disable-next-line no-await-in-loop
      await scrollPage(page, scrollDelayMs);
    }
    // Give the response listener time to finish parsing payloads.
    const finalWaitMs = Math.max(0, envInt("SCRAPE_NETWORK_FINAL_WAIT_MS", 800));
    if (finalWaitMs) await sleep(finalWaitMs);
    await effectiveCollector?.flush(Math.max(500, finalWaitMs * 3));

    const state = effectiveCollector?.getState() || {
      networkPayloads: [],
      networkListings: new Map(),
      networkCandidates: 0,
      networkJsonResponses: 0,
      firstParsed: null
    };

    const fromNetworkAll = Array.from(state.networkListings.values()).map((row) => ({
      ...row,
      scraped_at: scrapedAt,
      run_id: runId
    }));
    const fromNetwork = fromNetworkAll.slice(0, maxCards);

    const merged = new Map();
    for (const row of fromNetwork) {
      if (!row?.listing_id) continue;
      merged.set(String(row.listing_id), row);
      seenInRun.add(String(row.listing_id));
    }

    if (fromNetwork.length) {
      if (logEnabled) {
        log(
          `[INFO] data_source=network_json_first network_listings=${state.networkListings.size} network_candidates=${state.networkCandidates} ` +
            `network_json_responses=${state.networkJsonResponses}`
        );
        if (fromNetworkAll.length !== fromNetwork.length) {
          log(`[INFO] network_used used=${fromNetwork.length} available=${fromNetworkAll.length} max_cards=${maxCards}`);
        }
      }
    } else {
      if (logEnabled) {
        log(
          `[INFO] data_source=network_json_first network_listings=0 network_candidates=${state.networkCandidates} ` +
            `network_json_responses=${state.networkJsonResponses}`
        );
      }
    }

    const networkDebugEnabled = ["1", "true", "yes", "on"].includes(
      String(process.env.SCRAPE_NETWORK_DEBUG || "").trim().toLowerCase()
    );
    if (!fromNetwork.length && state.firstParsed && (saveNetworkRaw || networkDebugEnabled)) {
      try {
        const logsDir = path.resolve("logs");
        fs.mkdirSync(logsDir, { recursive: true });
        const target = path.join(logsDir, `graphql-sample-${runId}.json`);
        fs.writeFileSync(target, JSON.stringify(state.firstParsed, null, 2));
        log?.(`[WARN] network_no_listings_saved_sample path=${target}`);
      } catch {}
    }

    if (merged.size < maxCards) {
      const remaining = maxCards - merged.size;
      // If network yields few items, go back to the top so DOM extraction can re-scan visible cards.
      if (merged.size < Math.max(1, Math.floor(maxCards * 0.6))) {
        try {
          await page.evaluate(() => window.scrollTo(0, 0));
          await sleep(Math.min(1200, Math.max(0, scrollDelayMs)));
        } catch {}
      }
      const dom = await extractFromDom(page, {
        maxCards: remaining,
        scrollPages: Math.min(2, Math.max(0, scrollPages || 0)),
        scrollDelayMs,
        runId,
        scrapedAt,
        logEnabled,
        log,
        seenInRun
      });
      dupListingIdsSkipped += dom.dupListingIdsSkipped;
      for (const row of dom.rows) merged.set(String(row.listing_id), row);
      if (logEnabled) log(`[INFO] data_fallback=dom_topup added=${dom.rows.length} total=${merged.size}`);
    }

    rows = Array.from(merged.values()).slice(0, maxCards);
    cardsSeen = rows.length;
  } else {
    if (logEnabled) log("[INFO] data_source=dom");
    const dom = await extractFromDom(page, {
      maxCards,
      scrollPages,
      scrollDelayMs,
      runId,
      scrapedAt,
      logEnabled,
      log,
      seenInRun
    });
    rows = dom.rows;
    cardsSeen = dom.cardsSeen;
    dupListingIdsSkipped = dom.dupListingIdsSkipped;
  }

  const finalState = effectiveCollector?.getState() || null;
  const networkPayloads = finalState?.networkPayloads || [];
  if (saveNetworkRaw && networkPayloads.length) {
    const logsDir = path.resolve("logs");
    fs.mkdirSync(logsDir, { recursive: true });
    const target = path.join(logsDir, `network-${runId}.json`);
    fs.writeFileSync(target, JSON.stringify(networkPayloads, null, 2));
  }

  return { rows, cardsSeen, dupListingIdsSkipped };
}
