import fs from "node:fs";
import path from "node:path";

import { MARKETPLACE_SELECTOR, NETWORK_MAX_ITEMS } from "./constants.mjs";
import {
  canonicalMarketplaceItemUrl,
  cleanText,
  extractListingId,
  extractPrice,
  inferDescription,
  inferLocation,
  inferTitle,
  makeAbsoluteFacebookUrl,
  parsePhpPrice,
  sleep
} from "./utils.mjs";

function isLikelyMarketplaceResponse(url, contentType) {
  const lowerUrl = String(url || "").toLowerCase();
  const lowerType = String(contentType || "").toLowerCase();
  if (!lowerType.includes("application/json")) return false;
  if (lowerUrl.includes("graphql") || lowerUrl.includes("marketplace")) return true;
  return false;
}

function normalizeNetworkListing(node) {
  if (!node || typeof node !== "object") return null;
  const listing = node.listing && typeof node.listing === "object" ? node.listing : node;
  const listingId = listing.listing_id || listing.id || node.listing_id || node.id;
  if (!listingId) return null;
  const title =
    listing.marketplace_listing_title ||
    listing.title ||
    listing.listing_title ||
    node.marketplace_listing_title ||
    node.title ||
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
    title: cleanText(title),
    description: null,
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

export async function extractDiscoveryRows(page, opts) {
  const {
    maxCards,
    scrollPages,
    scrollDelayMs,
    useNetwork,
    saveNetworkRaw,
    runId,
    logEnabled,
    log
  } = opts;

  const networkPayloads = [];
  const networkListings = new Map();
  let networkResponses = 0;

  if (useNetwork) {
    page.on("response", async (response) => {
      try {
        const contentType = response.headers()["content-type"] || "";
        if (!isLikelyMarketplaceResponse(response.url(), contentType)) return;
        networkResponses += 1;
        const data = await response.json();
        if (saveNetworkRaw && networkPayloads.length < 50) {
          networkPayloads.push({ url: response.url(), data });
        }
        const networkMap = new Map();
        collectNetworkListings(data, networkMap);
        for (const [key, value] of networkMap.entries()) {
          if (!networkListings.has(key)) networkListings.set(key, value);
        }
      } catch {}
    });
  }

  await page.waitForSelector(MARKETPLACE_SELECTOR, { timeout: 30000 });

  let cardsSeen = 0;
  let rows = [];
  let dupListingIdsSkipped = 0;
  const seenInRun = new Set();
  const scrapedAt = new Date().toISOString();

  if (useNetwork && networkListings.size > 0) {
    if (logEnabled) log(`[INFO] data_source=network_json network_listings=${networkListings.size}`);
    cardsSeen = networkListings.size;
    rows = Array.from(networkListings.values()).map((row) => ({
      ...row,
      scraped_at: scrapedAt,
      run_id: runId
    }));
  } else {
    if (logEnabled) log(`[INFO] data_source=dom network_listings=0 network_responses=${networkResponses}`);
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

    cardsSeen = rawRows.length;
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
      const title = inferTitle(raw.cardText, raw.title || raw.anchorText);
      const priceRaw = extractPrice(raw.cardText);
      const pricePhp = parsePhpPrice(priceRaw);
      const locationRaw = inferLocation(raw.cardText);
      const description = inferDescription(raw.cardText, title, priceRaw);
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
        scraped_at: scrapedAt,
        run_id: runId
      });
    }
    rows = Array.from(seen.values());
  }

  if (saveNetworkRaw && networkPayloads.length) {
    const logsDir = path.resolve("logs");
    fs.mkdirSync(logsDir, { recursive: true });
    const target = path.join(logsDir, `network-${runId}.json`);
    fs.writeFileSync(target, JSON.stringify(networkPayloads, null, 2));
  }

  return { rows, cardsSeen, dupListingIdsSkipped };
}

