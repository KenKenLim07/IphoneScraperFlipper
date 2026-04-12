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

const DISCOVERY_SELLER_BLOCKLIST = new Set([
  "100037405695171",
  "100094736079558"
]);

function envInt(name, fallback) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function envBool(name, fallback) {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function isLikelyMarketplaceResponse(url, contentType) {
  const lowerUrl = String(url || "").toLowerCase();
  const lowerType = String(contentType || "").toLowerCase();
  // Facebook often serves GraphQL as JSON, but content-type can vary.
  if (lowerUrl.includes("graphql")) {
    if (!lowerType) return true;
    return lowerType.includes("json") || lowerType.includes("javascript") || lowerType.includes("text");
  }
  if (lowerUrl.includes("/api/graphql")) return true;
  if (lowerType.includes("application/json") && lowerUrl.includes("marketplace")) return true;
  return lowerType.includes("application/json") && (lowerUrl.includes("graphql") || lowerUrl.includes("marketplace"));
}

function tryParseJsonLines(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  let found = false;
  for (const line of lines) {
    if (!(line.startsWith("{") || line.startsWith("["))) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") {
        found = true;
        return parsed;
      }
    } catch {
      // Ignore parse errors for individual lines.
    }
  }
  return found ? null : null;
}

export function parseJsonishPayload(text) {
  return safeParseJsonish(text) || tryParseJsonLines(text);
}

export function collectNetworkListingsFromPayload(payload, outMap = new Map()) {
  collectNetworkListings(payload, outMap);
  return outMap;
}

function safeParseJsonish(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  let cleaned = raw.replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/, "").trim();
  cleaned = cleaned.replace(/^\)\]\}',?\s*/i, "").trim();
  cleaned = cleaned.replace(/^while\s*\(\s*1\s*\)\s*;\s*/i, "").trim();

  const extractFirstJson = (input, startAt = 0) => {
    const startObj = input.indexOf("{", startAt);
    const startArr = input.indexOf("[", startAt);
    let start = -1;
    if (startObj === -1) start = startArr;
    else if (startArr === -1) start = startObj;
    else start = Math.min(startObj, startArr);
    if (start === -1) return null;

    const stack = [];
    let inString = false;
    let escaped = false;
    for (let i = start; i < input.length; i += 1) {
      const ch = input[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "{" || ch === "[") {
        stack.push(ch === "{" ? "}" : "]");
        continue;
      }
      if (ch === "}" || ch === "]") {
        if (!stack.length || stack[stack.length - 1] !== ch) continue;
        stack.pop();
        if (!stack.length) return input.slice(start, i + 1);
      }
    }
    return null;
  };

  try {
    return JSON.parse(cleaned);
  } catch {}

  const jsonLine = tryParseJsonLines(cleaned);
  if (jsonLine) return jsonLine;

  const candidates = ["{\"data\"", "{\"payload\"", "{\"errors\"", "{\"label\""];
  for (const needle of candidates) {
    const idx = cleaned.indexOf(needle);
    if (idx === -1) continue;
    const extracted = extractFirstJson(cleaned, idx);
    if (!extracted) continue;
    try {
      return JSON.parse(extracted);
    } catch {}
  }

  const extracted = extractFirstJson(cleaned);
  if (!extracted) return null;
  try {
    return JSON.parse(extracted);
  } catch {
    return null;
  }
}

function normalizeNetworkListing(node) {
  if (!node || typeof node !== "object") return null;
  const listing =
    (node.listing && typeof node.listing === "object")
      ? node.listing
      : (node.marketplace_listing && typeof node.marketplace_listing === "object")
        ? node.marketplace_listing
        : (node.marketplace_listing_renderable && typeof node.marketplace_listing_renderable === "object")
          ? node.marketplace_listing_renderable
          : node;

  const listingType = cleanText(listing.__typename) || cleanText(node.__typename) || "";

  const pickText = (value) => {
    if (value == null) return null;
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (typeof value !== "object") return null;
    return (
      value.text ||
      value.title ||
      value.name ||
      value.value ||
      value.message?.text ||
      value.text_with_entities?.text ||
      value.title_with_entities?.text ||
      null
    );
  };

  const hasMarketplaceSignals = Boolean(
    listing.marketplace_listing_title ||
      listing.listing_price ||
      listing.price ||
      listing.marketplace_listing_seller ||
      listing.marketplace_listing_category_name ||
      listing.marketplace_listing_leaf_vt_category_name ||
      listing.location?.reverse_geocode ||
      listing.marketplace_listing_id ||
      listing.listing_id ||
      listing.listingId ||
      listing.marketplace_listing_description
  );

  const allowIdFallback =
    listingType === "GroupCommerceProductItem" ||
    listingType.toLowerCase().includes("marketplace") ||
    hasMarketplaceSignals;

  // Marketplace listing id is sometimes `listing_id`, sometimes just `id` on listing objects.
  // Never use the feed-story node's `id` (it contains colon-delimited story metadata).
  let listingId =
    listing.listing_id ||
    listing.listingId ||
    listing.marketplace_listing_id ||
    node.listing_id ||
    node.listingId ||
    node.marketplace_listing_id ||
    null;
  if (!listingId && allowIdFallback) listingId = listing.id;
  if (listingId && typeof listingId === "string" && listingId.includes(":")) {
    const match = listingId.match(/\b\d{6,}\b/);
    if (match && match[0]) listingId = match[0];
  }
  if (!listingId) return null;
  const title =
    pickText(listing.marketplace_listing_title) ||
    pickText(listing.title) ||
    pickText(listing.listing_title) ||
    pickText(listing.custom_title) ||
    pickText(listing.title_with_entities) ||
    pickText(node.marketplace_listing_title) ||
    pickText(node.title) ||
    pickText(node.title_with_entities) ||
    null;
  const description =
    pickText(listing.marketplace_listing_description) ||
    pickText(listing.marketplace_description) ||
    pickText(listing.description) ||
    pickText(listing.description_with_entities) ||
    pickText(listing.description_text) ||
    pickText(node.marketplace_listing_description) ||
    pickText(node.description) ||
    null;
  const toNumber = (value) => {
    if (value == null) return null;
    const n = Number.parseFloat(String(value).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  const priceObj =
    listing.listing_price ||
    listing.marketplace_listing_price ||
    listing.price ||
    listing.price_info ||
    listing.marketplace_listing_price_info ||
    node.listing_price ||
    node.marketplace_listing_price ||
    node.price ||
    null;
  let listingPriceFormatted = null;
  let listingPriceAmount = null;
  if (priceObj && typeof priceObj === "object") {
    listingPriceFormatted =
      priceObj.formatted_amount ||
      priceObj.formatted_amount_with_symbols ||
      priceObj.formatted_amount_without_currency ||
      priceObj.formatted_price ||
      null;
    listingPriceAmount = toNumber(priceObj.amount);
    if (!listingPriceFormatted && priceObj.amount && priceObj.currency) {
      listingPriceFormatted = `${priceObj.currency} ${priceObj.amount}`;
    }
  } else if (typeof priceObj === "string" || typeof priceObj === "number") {
    listingPriceFormatted = String(priceObj);
  }

  const strikeObj =
    listing.strikethrough_price ||
    listing.marketplace_listing_strikethrough_price ||
    node.strikethrough_price ||
    node.marketplace_listing_strikethrough_price ||
    null;
  let listingStrikeFormatted = null;
  if (strikeObj && typeof strikeObj === "object") {
    listingStrikeFormatted =
      strikeObj.formatted_amount ||
      strikeObj.formatted_amount_with_symbols ||
      strikeObj.formatted_amount_without_currency ||
      strikeObj.formatted_price ||
      null;
    if (!listingStrikeFormatted && strikeObj.amount && strikeObj.currency) {
      listingStrikeFormatted = `${strikeObj.currency} ${strikeObj.amount}`;
    }
  } else if (typeof strikeObj === "string" || typeof strikeObj === "number") {
    listingStrikeFormatted = String(strikeObj);
  }

  // If we can't see a price at all, only allow it when it still looks like a marketplace listing.
  const priceRaw = cleanText(listingPriceFormatted);
  const pricePhp =
    listingPriceAmount != null
      ? listingPriceAmount
      : listingPriceFormatted
        ? parsePhpPrice(listingPriceFormatted)
        : null;

  if (!cleanText(priceRaw) && pricePhp == null && !hasMarketplaceSignals) return null;

  const locationObj =
    listing.location ||
    listing.location_text ||
    listing.location_name ||
    listing.location_info ||
    listing.listing_location ||
    node.location ||
    node.location_text ||
    node.location_name ||
    node.listing_location ||
    null;
  let locationRaw = null;
  let locationCity = null;
  let locationState = null;
  if (typeof locationObj === "string") locationRaw = locationObj;
  if (locationObj && typeof locationObj === "object") {
    locationRaw =
      locationObj.full_address ||
      locationObj.label ||
      locationObj.text ||
      locationObj.name ||
      locationObj.city ||
      null;

    const reverse = locationObj.reverse_geocode || null;
    if (reverse && typeof reverse === "object") {
      locationCity = reverse.city || null;
      locationState = reverse.state || null;
      const displayName = reverse.city_page?.display_name || null;
      if (!locationRaw && displayName) locationRaw = displayName;
      if (!locationRaw && locationCity && locationState) locationRaw = `${locationCity}, ${locationState}`;
    }
  }

  const sellerId =
    listing.marketplace_listing_seller?.id ||
    listing.seller?.id ||
    listing.seller_id ||
    null;

  let isLive = typeof listing.is_live === "boolean" ? listing.is_live : null;
  let isSold = typeof listing.is_sold === "boolean" ? listing.is_sold : null;
  let isPending = typeof listing.is_pending === "boolean" ? listing.is_pending : null;
  let isHidden = typeof listing.is_hidden === "boolean" ? listing.is_hidden : null;

  const statusText = cleanText(listing.listing_status || listing.availability || listing.status || listing.state);
  if (statusText) {
    if (isSold == null && /sold/i.test(statusText)) isSold = true;
    if (isPending == null && /pending/i.test(statusText)) isPending = true;
    if (isHidden == null && /(hidden|unavailable|removed)/i.test(statusText)) isHidden = true;
    if (isLive == null && /(active|live|available)/i.test(statusText)) isLive = true;
  }

  let listingStatus = "active";
  if (isSold) listingStatus = "sold";
  else if (isPending || isHidden || isLive === false) listingStatus = "unavailable";

  const url = canonicalMarketplaceItemUrl(String(listingId), String(listingId));
  const normalized = {
    listing_id: String(listingId),
    url,
    title: sanitizeTitle(title),
    description: cleanText(description),
    location_raw: cleanText(locationRaw),
    price_raw: cleanText(priceRaw),
    price_php: pricePhp,
    listing_status: listingStatus,
    listing_price_amount: listingPriceAmount,
    listing_price_formatted: cleanText(listingPriceFormatted),
    listing_strikethrough_price: cleanText(listingStrikeFormatted),
    listing_is_live: isLive,
    listing_is_sold: isSold,
    listing_is_pending: isPending,
    listing_is_hidden: isHidden,
    listing_seller_id: cleanText(sellerId),
    listing_location_city: cleanText(locationCity),
    listing_location_state: cleanText(locationState)
  };

  const filledSignals =
    cleanText(normalized.title) ||
    cleanText(normalized.description) ||
    normalized.listing_price_amount != null ||
    cleanText(normalized.listing_price_formatted) ||
    cleanText(normalized.listing_strikethrough_price) ||
    normalized.listing_is_live != null ||
    normalized.listing_is_sold != null ||
    normalized.listing_is_pending != null ||
    normalized.listing_is_hidden != null ||
    cleanText(normalized.listing_seller_id) ||
    cleanText(normalized.listing_location_city) ||
    cleanText(normalized.listing_location_state);

  if (!filledSignals && !hasMarketplaceSignals) return null;
  return normalized;
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
      const sellerId = cleanText(candidate.listing_seller_id);
      if (sellerId && DISCOVERY_SELLER_BLOCKLIST.has(sellerId)) {
        continue;
      }
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
    const priceRaw = extractPrice(raw.cardText) || extractBestPhpPriceRaw(raw.cardText);
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
    const sellerId = cleanText(row.listing_seller_id);
    if (sellerId && DISCOVERY_SELLER_BLOCKLIST.has(sellerId)) {
      continue;
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

export function installNetworkListingCollector(page, { log, saveNetworkRaw, runId }) {
  const networkPayloads = [];
  const networkListings = new Map();
  let networkCandidates = 0;
  let networkJsonResponses = 0;
  let firstParsed = null;
  let networkDebugLogged = 0;
  let htmlSampleSaved = false;

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
        if (!isCandidate) return;
        networkCandidates += 1;

        const text = await response.text();
        const data = safeParseJsonish(text);
        if (!data) {
          const jsonLine = tryParseJsonLines(text);
          if (jsonLine) {
            networkJsonResponses += 1;
            if (!firstParsed) firstParsed = { url, data: jsonLine };
            if (saveNetworkRaw && networkPayloads.length < 50) {
              networkPayloads.push({ url, data: jsonLine });
            }
            const beforeCount = networkListings.size;
            const networkMap = new Map();
            collectNetworkListings(jsonLine, networkMap);
            for (const [key, value] of networkMap.entries()) {
              if (!networkListings.has(key)) networkListings.set(key, value);
            }
            const addedListings = networkListings.size - beforeCount;
            if ((networkDebugAll || networkDebugEnabled) && addedListings > 0 && networkDebugLogged < 30) {
              networkDebugLogged += 1;
              log?.(
                `[INFO] network_debug url=${url} status=${response.status()} content_type=${String(contentType).slice(0, 80)} ` +
                  `added=${addedListings} total=${networkListings.size}`
              );
            }
            return;
          }
          const shouldSaveHtml =
            !htmlSampleSaved &&
            (saveNetworkRaw || networkDebugEnabled) &&
            String(contentType || "").toLowerCase().includes("text/html");
          if (shouldSaveHtml) {
            try {
              const logsDir = path.resolve("logs");
              fs.mkdirSync(logsDir, { recursive: true });
              const safeRunId = cleanText(runId) || "unknown";
              const target = path.join(logsDir, `graphql-html-${safeRunId}.html`);
              const trimmed = String(text || "");
              const payload = trimmed.length > 20000 ? trimmed.slice(0, 20000) : trimmed;
              fs.writeFileSync(target, payload);
              htmlSampleSaved = true;
              log?.(
                `[WARN] graphql_html_saved path=${target} bytes=${payload.length} content_type=${String(contentType).slice(0, 60)}`
              );
            } catch {}
          }
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

        const beforeCount = networkListings.size;
        const networkMap = new Map();
        collectNetworkListings(data, networkMap);
        for (const [key, value] of networkMap.entries()) {
          if (!networkListings.has(key)) networkListings.set(key, value);
        }
        const addedListings = networkListings.size - beforeCount;
        if ((networkDebugAll || networkDebugEnabled) && addedListings > 0 && networkDebugLogged < 30) {
          networkDebugLogged += 1;
          log?.(
            `[INFO] network_debug url=${url} status=${response.status()} content_type=${String(contentType).slice(0, 80)} ` +
              `added=${addedListings} total=${networkListings.size}`
          );
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

  function dispose() {
    try {
      page.off("response", onResponse);
    } catch {}
  }

  function clear() {
    networkPayloads.length = 0;
    networkListings.clear();
    networkCandidates = 0;
    networkJsonResponses = 0;
    firstParsed = null;
    htmlSampleSaved = false;
  }

  return {
    flush,
    clear,
    dispose,
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

function sortByNewest(rows) {
  const withIndex = (rows || []).map((row, idx) => ({ row, idx }));
  const toTs = (value) => {
    const ts = Date.parse(String(value || ""));
    return Number.isFinite(ts) ? ts : null;
  };
  withIndex.sort((a, b) => {
    const aPosted = toTs(a.row?.posted_at);
    const bPosted = toTs(b.row?.posted_at);
    const aScraped = toTs(a.row?.scraped_at);
    const bScraped = toTs(b.row?.scraped_at);
    const aTs = aPosted ?? aScraped ?? 0;
    const bTs = bPosted ?? bScraped ?? 0;
    if (bTs !== aTs) return bTs - aTs;
    return a.idx - b.idx;
  });
  return withIndex.map((item) => item.row);
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
    networkCollector,
    graphqlOnly
  } = opts;

  const effectiveCollector = useNetwork
    ? networkCollector || installNetworkListingCollector(page, { log, saveNetworkRaw, runId })
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

  if (graphqlOnly && !useNetwork) {
    if (logEnabled) {
      log?.("[WARN] discovery_graphql_only enabled but SCRAPE_USE_NETWORK=false; returning 0 rows.");
    }
    return { rows: [], cardsSeen: 0, dupListingIdsSkipped: 0 };
  }

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

    let state = effectiveCollector?.getState() || {
      networkPayloads: [],
      networkListings: new Map(),
      networkCandidates: 0,
      networkJsonResponses: 0,
      firstParsed: null
    };

    const pokeCount = Math.max(0, envInt("SCRAPE_NETWORK_POKE_COUNT", 2));
    const pokeWaitMs = Math.max(200, envInt("SCRAPE_NETWORK_POKE_WAIT_MS", 1200));
    if (pokeCount && state.networkListings.size === 0 && effectiveCollector) {
      for (let attempt = 1; attempt <= pokeCount; attempt += 1) {
        if (logEnabled) log(`[INFO] network_poke attempt=${attempt}/${pokeCount} reason=no_listings`);
        try {
          await page.evaluate(() => {
            window.scrollBy(0, Math.floor(window.innerHeight * 0.7));
          });
        } catch {}
        try {
          await page.waitForResponse((response) => {
            const url = response.url();
            if (!url.includes("graphql")) return false;
            const contentType = response.headers()["content-type"] || "";
            return /json|javascript|text\/plain/i.test(contentType);
          }, { timeout: pokeWaitMs });
        } catch {}
        await sleep(Math.min(1200, Math.max(0, scrollDelayMs || 0)));
        await effectiveCollector.flush(Math.max(500, pokeWaitMs * 2));
        state = effectiveCollector.getState();
        if (state.networkListings.size > 0) break;
      }
    }

    if (state.networkListings.size === 0 && effectiveCollector) {
      if (logEnabled) log("[INFO] network_reload reason=no_listings");
      try {
        effectiveCollector.clear?.();
      } catch {}
      try {
        await page.reload({ waitUntil: "domcontentloaded", timeout: Math.max(1, selectorTimeoutMs || 60000) });
      } catch {}
      try {
        await page.waitForSelector(MARKETPLACE_SELECTOR, { timeout: Math.max(1, selectorTimeoutMs || 60000) });
      } catch {}
      try {
        await page.evaluate(() => {
          window.scrollBy(0, Math.floor(window.innerHeight * 0.7));
        });
      } catch {}
      const reloadWaitMs = Math.max(0, envInt("SCRAPE_NETWORK_RELOAD_WAIT_MS", 1200));
      if (reloadWaitMs) await sleep(reloadWaitMs);
      await effectiveCollector.flush(Math.max(500, reloadWaitMs * 2));
      state = effectiveCollector.getState();
    }

    const fromNetworkAll = Array.from(state.networkListings.values()).map((row) => ({
      ...row,
      scraped_at: scrapedAt,
      run_id: runId
    }));
    const fromNetwork = sortByNewest(fromNetworkAll).slice(0, maxCards);

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

    if (!graphqlOnly && merged.size < maxCards) {
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

    // Overlay DOM prices when network JSON is stale (prefer first price seen on card).
    if (!graphqlOnly && merged.size && useNetwork) {
      try {
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(Math.min(1200, Math.max(0, scrollDelayMs)));
      } catch {}
      const domOverlay = await extractFromDom(page, {
        maxCards: Math.min(maxCards, 60),
        scrollPages: Math.min(1, Math.max(0, scrollPages || 0)),
        scrollDelayMs,
        runId,
        scrapedAt,
        logEnabled: false,
        log,
        seenInRun: new Set()
      });
      const preferGraphqlPrice = envBool("PLAYWRIGHT_PREFER_GRAPHQL_PRICE_RAW", false);
      let overlayed = 0;
      for (const row of domOverlay.rows) {
        const id = String(row.listing_id || "");
        if (!id || !merged.has(id)) continue;
        const existing = merged.get(id);
        if (!preferGraphqlPrice && row.price_php != null && Number.isFinite(row.price_php)) {
          existing.price_raw = row.price_raw;
          existing.price_php = row.price_php;
        }
        if (!existing.posted_at && row.posted_at) existing.posted_at = row.posted_at;
        if (!existing.location_raw && row.location_raw) existing.location_raw = row.location_raw;
        if (!existing.title && row.title) existing.title = row.title;
        if (!existing.description && row.description) existing.description = row.description;
        overlayed += 1;
      }
      if (logEnabled && overlayed) log(`[INFO] data_overlay=dom_price updated=${overlayed}`);
    }

    rows = sortByNewest(Array.from(merged.values())).slice(0, maxCards);
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
    rows = sortByNewest(dom.rows).slice(0, maxCards);
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
