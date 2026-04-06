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

export function stripEmoji(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  // Best-effort emoji + pictograph removal for titles (keeps normal punctuation/letters).
  // Covers: emoticons, symbols, dingbats, transport/map symbols, misc pictographs, variation selectors, joiners.
  const without = cleaned
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "") // flags
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "") // skin tones
    .replace(/[\u200D\uFE0F]/g, ""); // zwj + variation selectors
  return cleanText(without);
}

export function sanitizeTitle(value) {
  // Title is used for filtering and display; strip emojis and normalize whitespace.
  const stripped = stripEmoji(value);
  if (!stripped) return null;
  // Trim noisy repeated separators.
  return cleanText(stripped.replace(/[•·]+/g, "•"));
}

export function looksLikeBuyerWantedPost(title) {
  const t = String(sanitizeTitle(title) || "").trim().toLowerCase();
  if (!t) return false;
  // Buyer / "looking for" posts (not actual seller listings).
  return /^(lf\b|lf:|looking\s+for\b|wtb\b|buying\b)/i.test(t);
}

function unitToMs(unit) {
  const u = String(unit || "").toLowerCase();
  if (u === "min" || u === "mins") return 60 * 1000;
  if (u.startsWith("minute")) return 60 * 1000;
  if (u === "hr" || u === "hrs") return 60 * 60 * 1000;
  if (u.startsWith("hour")) return 60 * 60 * 1000;
  if (u.startsWith("day")) return 24 * 60 * 60 * 1000;
  if (u.startsWith("week")) return 7 * 24 * 60 * 60 * 1000;
  if (u.startsWith("month")) return 30 * 24 * 60 * 60 * 1000;
  if (u.startsWith("year")) return 365 * 24 * 60 * 60 * 1000;
  return null;
}

export function inferPostedAtFromBodyText(bodyText, scrapedAtIso) {
  const raw = String(bodyText || "");
  if (!raw) return null;

  const scrapedAt = new Date(scrapedAtIso || "");
  const baseMs = Number.isNaN(scrapedAt.getTime()) ? Date.now() : scrapedAt.getTime();

  const lower = raw.toLowerCase();
  // Common Marketplace pattern: "Listed 2 days ago" / "Listed about an hour ago"
  const m =
    /listed\s+(?:about\s+)?(\d+|a|an)\s+(min|mins|minute|minutes|hr|hrs|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago\b/i.exec(
      lower
    );
  if (m) {
    const countRaw = String(m[1] || "").toLowerCase();
    const count = countRaw === "a" || countRaw === "an" ? 1 : Number.parseInt(countRaw, 10);
    const unitMs = unitToMs(m[2]);
    if (Number.isFinite(count) && count > 0 && unitMs) {
      return new Date(baseMs - count * unitMs).toISOString();
    }
  }

  if (/\blisted\s+just\s+now\b/i.test(lower)) {
    return new Date(baseMs).toISOString();
  }

  if (/\blisted\s+yesterday\b/i.test(lower)) {
    return new Date(baseMs - 24 * 60 * 60 * 1000).toISOString();
  }

  if (/\blisted\s+today\b/i.test(lower)) {
    return new Date(baseMs).toISOString();
  }

  return null;
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

export function extractBestPhpPriceRaw(text) {
  const raw = cleanText(text);
  if (!raw) return null;
  const re = new RegExp(PRICE_RE.source, "gi");
  let best = null;
  let bestNum = null;
  for (;;) {
    const m = re.exec(raw);
    if (!m) break;
    const candidate = cleanText(m[1]);
    const num = parsePhpPrice(candidate);
    if (num == null) continue;
    if (bestNum == null || num > bestNum) {
      bestNum = num;
      best = candidate;
    }
  }
  return best;
}

export function inferHeaderPriceRawFromBodyText(bodyText) {
  const raw = String(bodyText || "");
  if (!raw) return null;
  const linesAll = raw
    .split("\n")
    .map((l) => cleanText(l))
    .filter(Boolean);

  const findInWindow = (lines) => {
    // Most common: "Listed ... ago" (sometimes includes "in <Location>", sometimes not)
    const listedIdx = lines.findIndex((l) => /\blisted\b/i.test(l));
    if (listedIdx >= 0) {
      for (let i = listedIdx - 1; i >= Math.max(0, listedIdx - 20); i -= 1) {
        const p = extractPrice(lines[i]);
        if (p) return p;
      }
    }

    // Fallback: "Details" often appears immediately below the header block.
    const detailsIdx = lines.findIndex((l) => /^(details|detail)$/i.test(l));
    if (detailsIdx >= 0) {
      for (let i = detailsIdx - 1; i >= Math.max(0, detailsIdx - 28); i -= 1) {
        const p = extractPrice(lines[i]);
        if (p) return p;
      }
    }

    return null;
  };

  // Facebook sometimes renders the "Listed ..." line far from the beginning of `document.body.innerText`,
  // so scan BOTH the head and the tail.
  const head = linesAll.slice(0, 260);
  const tail = linesAll.slice(-260);

  const best = findInWindow(head) || findInWindow(tail);
  if (best) return best;

  // Fallback: first price line near the very top of the page (still better than "max price").
  for (let i = 0; i < Math.min(80, head.length); i += 1) {
    const p = extractPrice(head[i]);
    if (p) return p;
  }

  return null;
}

export function inferHeaderPriceRaw(bodyText, aboveFoldTexts = []) {
  // Prefer above-the-fold nodes (tends to include the header block), then fall back to whole body.
  const fold = Array.isArray(aboveFoldTexts) ? aboveFoldTexts.map((t) => cleanText(t)).filter(Boolean) : [];
  const foldJoined = fold.length ? fold.join("\n") : "";
  return inferHeaderPriceRawFromBodyText(foldJoined) || inferHeaderPriceRawFromBodyText(bodyText);
}

export function inferHeaderLocationRawFromBodyText(bodyText) {
  const raw = String(bodyText || "");
  if (!raw) return null;
  const linesAll = raw
    .split("\n")
    .map((l) => cleanText(l))
    .filter(Boolean);

  const scan = (lines) => {
    // Direct "Listed ... in <Location>" line.
    for (const line of lines) {
      const m = LISTED_IN_RE.exec(line);
      if (m && cleanText(m[1])) return normalizeLocationRaw(m[1]);
    }

    // If "Listed ..." exists, prefer nearby location-like lines.
    const listedIdx = lines.findIndex((l) => /\blisted\b/i.test(l));
    if (listedIdx >= 0) {
      for (let i = listedIdx; i < Math.min(lines.length, listedIdx + 8); i += 1) {
        const m = LISTED_IN_RE.exec(lines[i]);
        if (m && cleanText(m[1])) return normalizeLocationRaw(m[1]);
        if (LOCATION_LINE_RE.test(lines[i])) return normalizeLocationRaw(lines[i]);
      }
      for (let i = listedIdx - 1; i >= Math.max(0, listedIdx - 16); i -= 1) {
        const m = LISTED_IN_RE.exec(lines[i]);
        if (m && cleanText(m[1])) return normalizeLocationRaw(m[1]);
        if (LOCATION_LINE_RE.test(lines[i])) return normalizeLocationRaw(lines[i]);
      }
    }

    // Fallback: first location-looking line near the top.
    for (const line of lines.slice(0, 120)) {
      if (LOCATION_LINE_RE.test(line)) return normalizeLocationRaw(line);
    }

    return null;
  };

  const head = linesAll.slice(0, 260);
  const tail = linesAll.slice(-260);
  return scan(head) || scan(tail) || null;
}

export function inferHeaderLocationRaw(bodyText, aboveFoldTexts = [], listedLine = null) {
  const listed = cleanText(listedLine);
  if (listed) {
    const m = LISTED_IN_RE.exec(listed);
    if (m && cleanText(m[1])) return normalizeLocationRaw(m[1]);
    if (LOCATION_LINE_RE.test(listed)) return normalizeLocationRaw(listed);
  }

  const fold = Array.isArray(aboveFoldTexts) ? aboveFoldTexts.map((t) => cleanText(t)).filter(Boolean) : [];
  const foldJoined = fold.length ? fold.join("\n") : "";
  return inferHeaderLocationRawFromBodyText(foldJoined) || inferHeaderLocationRawFromBodyText(bodyText);
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

export function normalizeLocationRaw(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const listed = /^listed\s+in\s+/i;
  if (listed.test(cleaned)) return cleanText(cleaned.replace(listed, ""));
  return cleaned;
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
