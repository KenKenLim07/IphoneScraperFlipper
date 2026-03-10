import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash, randomUUID } from "node:crypto";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

dotenv.config();

const LISTING_ID_RE = /\/marketplace\/item\/(\d+)/;
const PRICE_RE =
  /((?:\u20b1|PHP|\$)\s*\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s*(?:PHP))/i;
const TITLE_NOISE_RE =
  /(?:\b\d+\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|wk|week|weeks|mo|month|months)\b|\bkm away\b|^sponsored$|^boosted$)/i;
const LISTED_IN_RE = /listed .+ in (.+)$/i;
const LOCATION_LINE_RE = /.+,\s*PH-\d{2}$/i;
const DETAIL_STOP_RE =
  /(location is approximate|seller information|seller details|today's picks|similar items|message seller|send seller a message)/i;
const DETAIL_NOISE_RE = /^(details|detail|save|share|message|send|listed .+ in .+|location)$/i;
const MARKETPLACE_SELECTOR = "a[href*='/marketplace/item/']";

function parseArgs(argv) {
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

function envBool(name, fallback) {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function requireEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function cleanText(value) {
  if (!value) return null;
  const cleaned = String(value).replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function makeAbsoluteFacebookUrl(href) {
  if (!href) return "";
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("/")) return `https://www.facebook.com${href}`;
  return `https://www.facebook.com/${href.replace(/^\/+/, "")}`;
}

function canonicalMarketplaceItemUrl(url, listingId = null) {
  const id = listingId || extractListingId(url);
  if (!id) return makeAbsoluteFacebookUrl(url);
  return `https://www.facebook.com/marketplace/item/${id}/`;
}

function extractListingId(url) {
  const match = LISTING_ID_RE.exec(url);
  return match ? match[1] : null;
}

function extractPrice(text) {
  if (!text) return null;
  const match = PRICE_RE.exec(text);
  return match ? cleanText(match[1]) : null;
}

function isPriceOnly(text) {
  const cleaned = cleanText(text);
  if (!cleaned) return false;
  return PRICE_RE.test(cleaned) && cleaned.replace(PRICE_RE, "").trim() === "";
}

function inferTitle(cardText, fallbackTitle) {
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

function inferLocation(cardText) {
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

function inferDescription(cardText, title, priceRaw) {
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
    .filter((line) => line.length >= 3);
  if (!lines.length) return null;
  return cleanText(lines.slice(0, 3).join(" | "));
}

function isLocationLikeDescription(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return true;
  return LOCATION_LINE_RE.test(cleaned);
}

function isWeakDescription(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return true;
  if (isLocationLikeDescription(cleaned)) return true;
  return cleaned.length < 20;
}

function looksLikeLoginOrBlock(url, bodyText) {
  const current = String(url || "").toLowerCase();
  const body = String(bodyText || "").toLowerCase();
  if (current.includes("/login") || current.includes("checkpoint")) return true;
  const markers = [
    "log in to facebook",
    "create new account",
    "you must log in",
    "your request couldn't be processed"
  ];
  return markers.some((m) => body.includes(m));
}

function resolveProfileDir(baseProfileDir, browserChannel) {
  const isolateByChannel = envBool("PLAYWRIGHT_PROFILE_ISOLATE_BY_CHANNEL", true);
  const base = path.resolve(baseProfileDir);
  if (!isolateByChannel) return base;
  if (path.basename(base).toLowerCase() === browserChannel) return base;
  return path.join(base, browserChannel);
}

function findPlaywrightChromiumExecutable() {
  const explicit = cleanText(process.env.PUPPETEER_CHROMIUM_EXECUTABLE);
  if (explicit && fs.existsSync(explicit)) return explicit;

  const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
  if (!fs.existsSync(root)) return null;
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("chromium-"))
    .map((d) => d.name)
    .sort((a, b) => b.localeCompare(a));
  for (const dir of dirs) {
    const exe = path.join(root, dir, "chrome-win", "chrome.exe");
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

function resolveExecutablePath(channel) {
  if (channel === "chrome") {
    const explicit = cleanText(process.env.PUPPETEER_CHROME_EXECUTABLE);
    if (explicit && fs.existsSync(explicit)) return explicit;
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }
  if (channel === "msedge") {
    const explicit = cleanText(process.env.PUPPETEER_MSEDGE_EXECUTABLE);
    if (explicit && fs.existsSync(explicit)) return explicit;
    return "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  }
  const chromiumExe = findPlaywrightChromiumExecutable();
  if (chromiumExe) return chromiumExe;
  throw new Error(
    "Chromium executable not found. Install Playwright Chromium first (`python -m playwright install chromium`) " +
      "or set PUPPETEER_CHROMIUM_EXECUTABLE."
  );
}

function normalizeLocationKey(locationRaw) {
  return String(locationRaw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseLocationComponents(locationRaw) {
  const text = cleanText(locationRaw) || "";
  const parts = text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const municipality = parts.length ? parts[0] : null;
  let province = null;
  let regionCode = null;
  if (parts.length >= 2 && /^PH-\d{2}$/i.test(parts[parts.length - 1])) {
    regionCode = parts[parts.length - 1].toUpperCase();
    if (parts.length >= 3) province = parts[parts.length - 2];
  } else if (parts.length >= 2) {
    province = parts[parts.length - 1];
  }
  return { municipality, province, regionCode };
}

function computeContentHash(row) {
  const parts = [
    cleanText(row.title) || "",
    cleanText(row.description) || "",
    cleanText(row.price_raw) || "",
    cleanText(row.location_raw) || "",
    cleanText(row.url) || "",
    cleanText(row.listing_status) || ""
  ];
  return createHash("sha256").update(parts.join("\x1f"), "utf8").digest("hex");
}

function computeChangedFields(current, previous) {
  if (!previous) return ["new_listing"];
  const pairs = [
    ["title", current.title, previous.title],
    ["description", current.description, previous.description],
    ["price_raw", current.price_raw, previous.price_raw],
    ["location_raw", current.location_raw, previous.location_raw],
    ["url", current.url, previous.url],
    ["listing_status", current.listing_status, previous.listing_status]
  ];
  const changed = [];
  for (const [name, curr, prev] of pairs) {
    if ((cleanText(curr) || "") !== (cleanText(prev) || "")) changed.push(name);
  }
  return changed;
}

async function createSupabaseClient() {
  const url = cleanText(process.env.SUPABASE_URL);
  const key = cleanText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function upsertLocations(supabase, rows) {
  const byKey = new Map();
  for (const row of rows) {
    const raw = cleanText(row.location_raw);
    if (!raw) continue;
    const key = normalizeLocationKey(raw);
    if (!byKey.has(key)) byKey.set(key, raw);
  }
  if (!byKey.size) return { keyToId: new Map(), count: 0 };

  const payload = [];
  for (const [key, raw] of byKey.entries()) {
    const parsed = parseLocationComponents(raw);
    payload.push({
      location_key: key,
      location_raw: raw,
      municipality: parsed.municipality,
      province: parsed.province,
      region_code: parsed.regionCode
    });
  }

  const upsertRes = await supabase.from("iaase_locations").upsert(payload, { onConflict: "location_key" });
  if (upsertRes.error) throw new Error(`Location upsert failed: ${upsertRes.error.message}`);

  const selectRes = await supabase
    .from("iaase_locations")
    .select("id,location_key")
    .in(
      "location_key",
      Array.from(byKey.keys())
    );
  if (selectRes.error) throw new Error(`Location select failed: ${selectRes.error.message}`);

  const keyToId = new Map();
  for (const row of selectRes.data || []) {
    keyToId.set(String(row.location_key), Number(row.id));
  }
  return { keyToId, count: byKey.size };
}

async function fetchExistingByIds(supabase, listingIds) {
  if (!listingIds.length) return new Map();
  const res = await supabase
    .from("iaase_raw_listings")
    .select(
      "listing_id,title,description,price_raw,location_raw,location_id,url,listing_status,content_hash," +
        "first_seen_at,last_seen_at,last_seen_run_id,last_changed_at,sold_at,missing_run_count,is_active"
    )
    .in("listing_id", listingIds);
  if (res.error) throw new Error(`Existing row fetch failed: ${res.error.message}`);
  const out = new Map();
  for (const row of res.data || []) out.set(String(row.listing_id), row);
  return out;
}

function applyStateAndBuildVersions(rows, existingById, runId, nowIso) {
  const prepared = [];
  const versions = [];
  let rowsChanged = 0;

  for (const row of rows) {
    const previous = existingById.get(row.listing_id);
    const changedFields = computeChangedFields(row, previous);
    const isChanged = changedFields.length > 0;
    if (isChanged) rowsChanged += 1;

    const firstSeenAt = previous?.first_seen_at || row.scraped_at || nowIso;
    const lastChangedAt = isChanged ? nowIso : previous?.last_changed_at || nowIso;
    const soldAt =
      row.listing_status === "sold" && !previous?.sold_at ? nowIso : previous?.sold_at || row.sold_at || null;
    const next = {
      ...row,
      content_hash: computeContentHash(row),
      first_seen_at: firstSeenAt,
      last_seen_at: nowIso,
      last_seen_run_id: runId,
      last_changed_at: lastChangedAt,
      sold_at: soldAt,
      missing_run_count: 0,
      is_active: row.listing_status === "active"
    };
    prepared.push(next);

    if (isChanged) {
      versions.push({
        listing_id: next.listing_id,
        run_id: runId,
        scraped_at: nowIso,
        content_hash: next.content_hash,
        listing_status: next.listing_status,
        title: next.title,
        description: next.description,
        price_raw: next.price_raw,
        location_raw: next.location_raw,
        location_id: next.location_id,
        url: next.url,
        changed_fields: changedFields
      });
    }
  }

  return { prepared, versions, rowsChanged };
}

async function insertVersions(supabase, versions) {
  if (!versions.length) return 0;
  const res = await supabase.from("iaase_listing_versions").insert(versions);
  if (res.error) throw new Error(`Version insert failed: ${res.error.message}`);
  return versions.length;
}

async function writeRunLog(supabase, payload) {
  const res = await supabase.from("iaase_scrape_runs").insert(payload);
  if (res.error) throw new Error(`Run log insert failed: ${res.error.message}`);
}

async function maybePersistSupabase(rows, runId, maxCards, runMeta) {
  const supabase = await createSupabaseClient();
  const { keyToId, count: locationsUpserted } = await upsertLocations(supabase, rows);
  const withLocationId = rows.map((row) => {
    const key = cleanText(row.location_raw) ? normalizeLocationKey(row.location_raw) : null;
    return {
      ...row,
      location_id: key ? keyToId.get(key) || null : null
    };
  });

  const existingById = await fetchExistingByIds(
    supabase,
    withLocationId.map((row) => row.listing_id)
  );
  const nowIso = new Date().toISOString();
  const { prepared, versions, rowsChanged } = applyStateAndBuildVersions(withLocationId, existingById, runId, nowIso);

  const upsertRes = await supabase.from("iaase_raw_listings").upsert(prepared, { onConflict: "listing_id" });
  if (upsertRes.error) throw new Error(`Supabase upsert failed: ${upsertRes.error.message}`);

  const versionsInserted = await insertVersions(supabase, versions);

  await writeRunLog(supabase, {
    run_id: runId,
    started_at: runMeta.startedAt,
    finished_at: nowIso,
    status: runMeta.status,
    query_url: runMeta.queryUrl,
    browser_channel: runMeta.browserChannel,
    headless: runMeta.headless,
    use_stealth: runMeta.useStealth,
    dry_run: false,
    max_cards: maxCards,
    cards_seen: runMeta.cardsSeen,
    rows_extracted: prepared.length,
    rows_upserted: prepared.length,
    rows_failed: 0,
    rows_enriched_description: runMeta.rowsEnrichedDescription,
    rows_enriched_location: runMeta.rowsEnrichedLocation,
    rows_detected_sold: 0,
    rows_detected_unavailable: 0,
    locations_upserted: locationsUpserted,
    rows_changed: rowsChanged,
    versions_inserted: versionsInserted,
    rows_missing_seen: 0,
    rows_marked_not_seen: 0,
    error_count: runMeta.errorCount,
    error_details: runMeta.errorDetails
  });

  return {
    rowsUpserted: prepared.length,
    rowsChanged,
    versionsInserted,
    locationsUpserted
  };
}

async function extractDetailFields(page, record) {
  await page.goto(record.url, { waitUntil: "domcontentloaded", timeout: 90000 });
  try {
    await page.waitForNetworkIdle({ idleTime: 900, timeout: 12000 });
  } catch {}

  const result = await page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll("span[dir='auto'], div[dir='auto']"))
      .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const lowered = texts.map((t) => t.toLowerCase());
    let detailsIndex = lowered.findIndex((t) => t === "details" || t === "detail");
    if (detailsIndex < 0) detailsIndex = 0;
    return {
      allTexts: texts,
      detailTexts: texts.slice(detailsIndex, detailsIndex + 80)
    };
  });
  const bodyText = await page.evaluate(() => document.body?.innerText || "");
  const allTexts = Array.isArray(result?.allTexts) ? result.allTexts : [];
  const detailTexts = Array.isArray(result?.detailTexts) ? result.detailTexts : [];

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
    if (lowered === titleClean || lowered === priceClean) continue;
    if (isPriceOnly(line)) continue;
    if (LOCATION_LINE_RE.test(line)) continue;
    if (line.length < 4) continue;
    lines.push(line);
    if (lines.length >= 3) break;
  }

  return {
    detailDescription: lines.length ? cleanText(lines.join(" | ")) : null,
    detailLocation,
    bodyText
  };
}

async function enrichRowsFromDetails(browser, rows, maxPages) {
  const updated = [...rows];
  let descEnriched = 0;
  let locationEnriched = 0;

  const indices = Array.from(updated.keys()).sort((a, b) => {
    const ra = updated[a];
    const rb = updated[b];
    const pa = !ra.location_raw || isWeakDescription(ra.description) ? 0 : 1;
    const pb = !rb.location_raw || isWeakDescription(rb.description) ? 0 : 1;
    return pa - pb;
  });

  let inspected = 0;
  for (const idx of indices) {
    if (inspected >= maxPages) break;
    inspected += 1;
    const page = await browser.newPage();
    try {
      const details = await extractDetailFields(page, updated[idx]);
      const next = { ...updated[idx] };
      if (details.detailDescription && isWeakDescription(next.description)) {
        next.description = details.detailDescription;
        descEnriched += 1;
      }
      if (details.detailLocation && !next.location_raw) {
        next.location_raw = details.detailLocation;
        locationEnriched += 1;
      }
      updated[idx] = next;
    } catch {}
    await page.close();
  }

  return { rows: updated, descEnriched, locationEnriched };
}

async function main() {
  const args = parseArgs(process.argv);
  const runId = randomUUID();
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const queryUrl = requireEnv("FB_MARKETPLACE_ILOILO_URL");

  const browserChannel = cleanText(args.browserChannel) || cleanText(process.env.PLAYWRIGHT_BROWSER_CHANNEL) || "chromium";
  const headless = args.headless == null ? envBool("PLAYWRIGHT_HEADLESS", true) : args.headless;
  const useStealth = args.useStealth == null ? envBool("PUPPETEER_USE_STEALTH", true) : args.useStealth;
  const baseProfileDir = requireEnv("PLAYWRIGHT_PROFILE_DIR");
  const userDataDir = resolveProfileDir(baseProfileDir, browserChannel);
  const executablePath = resolveExecutablePath(browserChannel);

  fs.mkdirSync(userDataDir, { recursive: true });

  console.log(`[INFO] run_id=${runId}`);
  console.log(`[INFO] browser_channel=${browserChannel} headless=${headless} use_stealth=${useStealth}`);
  console.log(`[INFO] user_data_dir=${userDataDir}`);

  if (useStealth && !args.bootstrapLogin) {
    puppeteer.use(StealthPlugin());
  }

  const browser = await puppeteer.launch({
    headless,
    executablePath,
    userDataDir,
    defaultViewport: { width: 1366, height: 900 },
    args: ["--disable-dev-shm-usage", "--no-sandbox"]
  });

  let cardsSeen = 0;
  let rowsExtracted = 0;
  let rowsUpserted = 0;
  let rowsChanged = 0;
  let versionsInserted = 0;
  let locationsUpserted = 0;
  let rowsEnrichedDescription = 0;
  let rowsEnrichedLocation = 0;
  const runErrors = [];
  let status = "success";

  try {
    const page = await browser.newPage();
    await page.goto(args.bootstrapLogin ? "https://www.facebook.com/login" : queryUrl, {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    if (args.bootstrapLogin) {
      console.log("[INFO] Bootstrap mode active.");
      console.log("[INFO] Log in in the browser window, open Marketplace, then press Enter here.");
      process.stdin.resume();
      await new Promise((resolve) => process.stdin.once("data", resolve));
      console.log("[INFO] Profile session saved.");
      return 0;
    }

    try {
      await page.waitForNetworkIdle({ idleTime: 900, timeout: 15000 });
    } catch {}

    const bodyText = await page.evaluate(() => document.body?.innerText || "");
    if (looksLikeLoginOrBlock(page.url(), bodyText)) {
      throw new Error(
        "Facebook session looks logged out or blocked for this profile/channel. " +
          "Run with --bootstrap-login using the same --browser-channel."
      );
    }

    await page.waitForSelector(MARKETPLACE_SELECTOR, { timeout: 30000 });
    const rawRows = await page.evaluate(
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
      { selector: MARKETPLACE_SELECTOR, maxCards: args.maxCards }
    );

    cardsSeen = rawRows.length;
    const seen = new Map();
    const scrapedAt = new Date().toISOString();
    for (const raw of rawRows) {
      const rawUrl = makeAbsoluteFacebookUrl(raw.href);
      const listingId = extractListingId(rawUrl);
      if (!listingId) continue;
      const url = canonicalMarketplaceItemUrl(rawUrl, listingId);
      const title = inferTitle(raw.cardText, raw.title || raw.anchorText);
      const priceRaw = extractPrice(raw.cardText);
      const locationRaw = inferLocation(raw.cardText);
      const description = inferDescription(raw.cardText, title, priceRaw);
      seen.set(listingId, {
        listing_id: listingId,
        url,
        title,
        description,
        location_raw: locationRaw,
        location_id: null,
        price_raw: priceRaw,
        listing_status: "active",
        content_hash: null,
        scraped_at: scrapedAt,
        run_id: runId,
        first_seen_at: null,
        last_seen_at: scrapedAt,
        last_seen_run_id: runId,
        last_changed_at: null,
        sold_at: null,
        missing_run_count: 0,
        is_active: true,
        source: "facebook_marketplace",
        query_url: queryUrl
      });
    }

    let rows = Array.from(seen.values());
    rowsExtracted = rows.length;

    const detailMaxPages = Number.parseInt(process.env.PLAYWRIGHT_DETAIL_DESCRIPTION_MAX_PAGES || "8", 10);
    if (rows.length && detailMaxPages > 0) {
      const enriched = await enrichRowsFromDetails(browser, rows, Math.max(0, Math.min(detailMaxPages, 30)));
      rows = enriched.rows;
      rowsEnrichedDescription = enriched.descEnriched;
      rowsEnrichedLocation = enriched.locationEnriched;
    }

    if (args.dryRun) {
      console.log("[INFO] Dry-run mode enabled, skipping Supabase write.");
      for (const row of rows) console.log(JSON.stringify(row));
    } else {
      const persisted = await maybePersistSupabase(rows, runId, args.maxCards, {
        startedAt,
        status,
        queryUrl,
        browserChannel,
        headless,
        useStealth,
        cardsSeen,
        rowsEnrichedDescription,
        rowsEnrichedLocation,
        errorCount: runErrors.length,
        errorDetails: runErrors
      });
      rowsUpserted = persisted.rowsUpserted;
      rowsChanged = persisted.rowsChanged;
      versionsInserted = persisted.versionsInserted;
      locationsUpserted = persisted.locationsUpserted;
    }
  } catch (error) {
    status = "failed";
    const msg = error instanceof Error ? error.message : String(error);
    runErrors.push({ stage: "scrape", error: msg.slice(0, 400) });
    console.error(`[ERROR] ${msg}`);
  } finally {
    await browser.close();
  }

  const elapsedSeconds = ((Date.now() - started) / 1000).toFixed(2);
  console.log(
    `[SUMMARY] run_id=${runId} status=${status} cards_seen=${cardsSeen} rows_extracted=${rowsExtracted} ` +
      `rows_upserted=${rowsUpserted} rows_enriched_description=${rowsEnrichedDescription} ` +
      `rows_enriched_location=${rowsEnrichedLocation} locations_upserted=${locationsUpserted} ` +
      `rows_changed=${rowsChanged} versions_inserted=${versionsInserted} elapsed_seconds=${elapsedSeconds}`
  );
  return status === "success" ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[ERROR] Unhandled: ${error instanceof Error ? error.stack : String(error)}`);
    process.exit(1);
  });
