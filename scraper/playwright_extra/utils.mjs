import process from "node:process";

import {
  LISTING_ID_RE,
  PRICE_RE,
  TITLE_NOISE_RE,
  LISTED_IN_RE,
  LOCATION_LINE_RE
} from "./constants.mjs";

export function cleanText(value) {
  if (!value) return null;
  const cleaned = String(value).replace(/\s+/g, " ").trim();
  return cleaned || null;
}

export function requireEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function envBool(name, fallback) {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

export function envInt(name, fallback) {
  const raw = (process.env[name] || "").trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

export async function sleep(ms) {
  if (!ms || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomBetween(min, max) {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function gotoWithRetry(page, url, retries, waitMs) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(waitMs);
    }
  }
  throw lastError;
}

export async function gotoWithRetryWithReferer(page, url, retries, waitMs, referer) {
  const ref = cleanText(referer);
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 90000,
        referer: ref || undefined
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(waitMs);
    }
  }
  throw lastError;
}

export function makeAbsoluteFacebookUrl(href) {
  if (!href) return "";
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("/")) return `https://www.facebook.com${href}`;
  return `https://www.facebook.com/${href.replace(/^\/+/, "")}`;
}

export function extractListingId(url) {
  const match = LISTING_ID_RE.exec(url);
  return match ? match[1] : null;
}

export function canonicalMarketplaceItemUrl(url, listingId = null) {
  const id = listingId || extractListingId(url);
  if (!id) return makeAbsoluteFacebookUrl(url);
  return `https://www.facebook.com/marketplace/item/${id}/`;
}

export function extractPrice(text) {
  if (!text) return null;
  const match = PRICE_RE.exec(text);
  return match ? cleanText(match[1]) : null;
}

export function parsePhpPrice(value) {
  if (!value) return null;
  const cleaned = String(value)
    .toLowerCase()
    .replace(/[^\d.,]/g, "")
    .replace(/,/g, "");
  if (!cleaned) return null;
  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num)) return null;
  if (num < 500 || num > 500000) return null;
  return num;
}

export function isPriceOnly(text) {
  const cleaned = cleanText(text);
  if (!cleaned) return false;
  return PRICE_RE.test(cleaned) && cleaned.replace(PRICE_RE, "").trim() === "";
}

export function inferTitle(cardText, fallbackTitle) {
  const fallback = cleanText(fallbackTitle);
  if (fallback && !isPriceOnly(fallback) && !TITLE_NOISE_RE.test(fallback)) return fallback;
  const lines = String(cardText || "")
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean);
  for (const line of lines) {
    if (isPriceOnly(line)) continue;
    if (TITLE_NOISE_RE.test(line)) continue;
    if (/[a-z]/i.test(line)) return line;
  }
  return lines.length ? lines[0] : null;
}

export function inferLocation(cardText) {
  const lines = String(cardText || "")
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean);
  for (const line of lines) {
    const listed = LISTED_IN_RE.exec(line);
    if (listed && cleanText(listed[1])) return cleanText(listed[1]);
    if (LOCATION_LINE_RE.test(line)) return line;
    const embedded = /([A-Za-z][A-Za-z0-9 .,'-]+,\s*PH-\d{2})/i.exec(line);
    if (embedded && cleanText(embedded[1])) return cleanText(embedded[1]);
  }
  return null;
}

export function inferDescription(cardText, title, priceRaw) {
  const titleLower = (cleanText(title) || "").toLowerCase();
  const priceLower = (cleanText(priceRaw) || "").toLowerCase();
  const lines = String(cardText || "")
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean)
    .filter((line) => line.toLowerCase() !== titleLower)
    .filter((line) => line.toLowerCase() !== priceLower)
    .filter((line) => !isPriceOnly(line))
    .filter((line) => !TITLE_NOISE_RE.test(line))
    .filter((line) => !LOCATION_LINE_RE.test(line))
    .filter((line) => !/listed .+ in .+/i.test(line))
    .filter((line) => line.length >= 3);
  if (!lines.length) return null;
  return cleanText(lines.slice(0, 3).join(" | "));
}

export function isLocationLikeDescription(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return true;
  return LOCATION_LINE_RE.test(cleaned);
}

export function isWeakDescription(value) {
  // "Weak" is now intentionally strict: only treat missing/empty as weak.
  // Some sellers use very short descriptions, and location strings are not harmful.
  return cleanText(value) == null;
}
