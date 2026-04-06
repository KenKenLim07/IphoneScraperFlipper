import { DETAIL_NOISE_RE, DETAIL_STOP_RE, LISTED_IN_RE, LOCATION_LINE_RE } from "./constants.mjs";
import { cleanText, extractBestPhpPriceRaw, extractPrice, inferDescription, inferLocation, isPriceOnly } from "./utils.mjs";

export function looksLikeUnavailableListing(bodyText) {
  const body = String(bodyText || "").toLowerCase();
  const markers = [
    "this listing isn't available",
    "this listing is no longer available",
    "this content isn't available",
    "something went wrong",
    "page isn't available",
    "page not found"
  ];
  return markers.some((m) => body.includes(m));
}

export function looksLikeSoldListing(bodyText) {
  const body = String(bodyText || "").toLowerCase();
  const markers = ["this item is sold", "this listing is sold", "marked as sold", "sold Â·"];
  return markers.some((m) => body.includes(m));
}

export function cleanOgTitle(value) {
  const title = cleanText(value);
  if (!title) return null;
  const lowered = title.toLowerCase();
  if (lowered.includes("facebook marketplace")) return null;
  if (lowered === "marketplace") return null;
  return title;
}

function normalizeDetailDescription(value) {
  const text = cleanText(value);
  if (!text) return null;
  const parts = text
    .split("|")
    .map((p) => cleanText(p))
    .filter(Boolean);
  if (!parts.length) return null;

  if (parts[0].toLowerCase() === "condition") parts.shift();
  if (parts[0] && /^(used|new)\s*-\s*/i.test(parts[0])) parts.shift();

  const joined = cleanText(parts.join(" | "));
  return joined || null;
}

function pickPrimaryPriceRaw(texts) {
  if (!Array.isArray(texts) || !texts.length) return null;
  for (const raw of texts) {
    const line = cleanText(raw);
    if (!line) continue;
    if (isPriceOnly(line)) return extractPrice(line) || line;
  }
  // Fallback: short lines near top sometimes include separators; still prefer the first price.
  for (const raw of texts) {
    const line = cleanText(raw);
    if (!line) continue;
    if (line.length > 48) continue;
    const p = extractPrice(line);
    if (p) return p;
  }
  return null;
}

export async function extractDetailFieldsFromPage(page, record) {
  const result = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("span[dir='auto'], div[dir='auto']"));
    const texts = [];
    const aboveFoldTexts = [];
    const foldBottom = Math.floor(window.innerHeight * 1.6);
    for (const el of nodes) {
      const t = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (!t) continue;
      texts.push(t);
      try {
        const r = el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < foldBottom) {
          aboveFoldTexts.push(t);
        }
      } catch {}
    }
    const lowered = texts.map((t) => t.toLowerCase());
    let detailsIndex = lowered.findIndex((t) => t === "details" || t === "detail");
    if (detailsIndex < 0) detailsIndex = 0;
    const listedLine = texts.find((t) => /\blisted\b/i.test(t)) || null;

    let detailCondition = null;
    const conditionIdx = lowered.findIndex((t) => t === "condition");
    if (conditionIdx >= 0) {
      for (let i = conditionIdx + 1; i < Math.min(lowered.length, conditionIdx + 6); i += 1) {
        const v = texts[i];
        if (!v) continue;
        if (String(v).toLowerCase() === "condition") continue;
        detailCondition = v;
        break;
      }
    }

    return {
      allTexts: texts,
      detailTexts: texts.slice(detailsIndex, detailsIndex + 80),
      listedLine,
      aboveFoldTexts: aboveFoldTexts.slice(0, 240),
      detailCondition
    };
  });

  const allTexts = Array.isArray(result?.allTexts) ? result.allTexts : [];
  const detailTexts = Array.isArray(result?.detailTexts) ? result.detailTexts : [];
  const listedLine = cleanText(result?.listedLine);
  const aboveFoldTexts = Array.isArray(result?.aboveFoldTexts) ? result.aboveFoldTexts : [];
  const detailCondition = cleanText(result?.detailCondition);
  const primaryPriceRaw = pickPrimaryPriceRaw(aboveFoldTexts);

  let detailLocation = null;
  for (const raw of allTexts) {
    const line = cleanText(raw);
    if (!line) continue;
    const listed = LISTED_IN_RE.exec(line);
    if (listed && cleanText(listed[1])) {
      detailLocation = cleanText(listed[1]);
      break;
    }
    if (LOCATION_LINE_RE.test(line)) {
      detailLocation = line;
      break;
    }
    const embedded = /([A-Za-z][A-Za-z0-9 .,'-]+,\s*PH-\d{2})/i.exec(line);
    if (embedded && cleanText(embedded[1])) {
      detailLocation = cleanText(embedded[1]);
      break;
    }
  }

  const titleClean = (cleanText(record.title) || "").toLowerCase();
  const priceClean = (cleanText(record.price_raw) || "").toLowerCase();
  const seen = new Set();
  const lines = [];
  for (const raw of detailTexts) {
    const line = cleanText(raw);
    if (!line) continue;
    const lowered = line.toLowerCase();
    if (seen.has(lowered)) continue;
    seen.add(lowered);
    if (DETAIL_STOP_RE.test(line)) break;
    if (DETAIL_NOISE_RE.test(line)) continue;
    if (lowered === "condition") continue;
    if (/^(used|new)\s*-\s*/i.test(line)) continue;
    if (lowered === titleClean || lowered === priceClean) continue;
    if (isPriceOnly(line)) continue;
    if (LOCATION_LINE_RE.test(line)) continue;
    if (line.length < 4) continue;
    lines.push(line);
    if (lines.length >= 3) break;
  }

  const detailDescription = lines.length ? normalizeDetailDescription(lines.join(" | ")) : null;
  return { detailDescription, detailLocation, listedLine, aboveFoldTexts, primaryPriceRaw, detailCondition };
}

export function deriveDescriptionFromDetail({ bodyText, metaOgDescription, title, priceRaw, detailDescription }) {
  const detail = cleanText(detailDescription);
  if (detail) return detail;
  const fallback = inferDescription(bodyText || metaOgDescription || "", title, priceRaw);
  return cleanText(fallback);
}

export function derivePriceRawFromDetail({ bodyText, metaOgDescription, fallback }) {
  const head = String(bodyText || "").slice(0, 4000);

  // Prefer the first visible price (top of page) over "best"/max across the entire body,
  // because the body can include "similar items" with unrelated prices.
  return (
    extractPrice(head) ||
    extractPrice(metaOgDescription || "") ||
    extractBestPhpPriceRaw(head) ||
    extractBestPhpPriceRaw(metaOgDescription || "") ||
    cleanText(fallback)
  );
}

export function deriveLocationFromDetail({ bodyText, detailLocation, fallback }) {
  return cleanText(detailLocation) || inferLocation(bodyText || "") || cleanText(fallback);
}
