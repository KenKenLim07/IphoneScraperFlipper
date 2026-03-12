import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID, createHash } from "node:crypto";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

dotenv.config();

const LISTING_ID_RE = /\/marketplace\/item\/(\d+)/;
const LOCATION_LINE_RE = /.+,\s*PH-\d{2}$/i;
const LISTED_IN_RE = /listed .+ in (.+)$/i;
const DETAIL_STOP_RE =
  /(location is approximate|seller information|seller details|today's picks|similar items|message seller|send seller a message)/i;
const DETAIL_NOISE_RE = /^(details|detail|save|share|message|send|listed .+ in .+|location)$/i;
const SOLD_RE = /\bsold\b/i;

function parseArgs(argv) {
  const out = { listingIds: [], limit: 10, headless: null, useStealth: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--listing-id") {
      const val = argv[i + 1];
      if (val) out.listingIds.push(val);
      i += 1;
    } else if (arg.startsWith("--listing-id=")) {
      const val = arg.split("=", 2)[1];
      if (val) out.listingIds.push(val);
    } else if (arg === "--limit") {
      out.limit = Number.parseInt(argv[i + 1], 10) || 10;
      i += 1;
    } else if (arg.startsWith("--limit=")) {
      out.limit = Number.parseInt(arg.split("=", 2)[1], 10) || 10;
    } else if (arg === "--headless") {
      out.headless = true;
    } else if (arg === "--no-headless") {
      out.headless = false;
    } else if (arg === "--use-stealth") {
      out.useStealth = true;
    } else if (arg === "--no-stealth") {
      out.useStealth = false;
    }
  }
  out.limit = Math.max(1, Math.min(out.limit, 200));
  return out;
}

function envBool(name, fallback) {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function cleanText(value) {
  if (!value) return null;
  const cleaned = String(value).replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function extractListingId(url) {
  const match = LISTING_ID_RE.exec(url || "");
  return match ? match[1] : null;
}

function isLocationLikeDescription(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return true;
  return LOCATION_LINE_RE.test(cleaned);
}

function detectListingStatus(bodyText, detailTexts, allTexts) {
  const body = String(bodyText || "").toLowerCase();
  if (body.includes("sold") && /(^|\s)sold(\s|$)/i.test(body)) return "sold";
  const combined = []
    .concat(detailTexts || [])
    .concat(allTexts || [])
    .map((t) => cleanText(t))
    .filter(Boolean);
  for (const token of combined) {
    const lower = token.toLowerCase();
    if (lower === "sold" || lower.startsWith("sold ·")) return "sold";
  }
  const detailJoined = combined.join(" ").toLowerCase();
  if (SOLD_RE.test(detailJoined)) return "sold";
  return "active";
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

function requireEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
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
    "Chromium executable not found. Install Playwright Chromium or set PUPPETEER_CHROMIUM_EXECUTABLE."
  );
}

async function createSupabaseClient() {
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fetchTargets(supabase, listingIds, limit) {
  if (listingIds.length) {
    const res = await supabase
      .from("iaase_raw_listings")
      .select("listing_id,url,title,price_raw,description,location_raw,listing_status")
      .in("listing_id", listingIds);
    if (res.error) throw new Error(`Target fetch failed: ${res.error.message}`);
    return res.data || [];
  }
  const res = await supabase
    .from("iaase_raw_listings")
    .select("listing_id,url,title,price_raw,description,location_raw,listing_status")
    .is("description", null)
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  if (res.error) throw new Error(`Target fetch failed: ${res.error.message}`);
  return res.data || [];
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
    if (LOCATION_LINE_RE.test(line)) continue;
    if (line.length < 4) continue;
    lines.push(line);
    if (lines.length >= 3) break;
  }

  return {
    detailDescription: lines.length ? cleanText(lines.join(" | ")) : null,
    detailLocation,
    listingStatus: detectListingStatus(bodyText, detailTexts, allTexts)
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const browserChannel = cleanText(process.env.PLAYWRIGHT_BROWSER_CHANNEL) || "chromium";
  const headless = args.headless == null ? envBool("PLAYWRIGHT_HEADLESS", true) : args.headless;
  const useStealth = args.useStealth == null ? envBool("PUPPETEER_USE_STEALTH", true) : args.useStealth;
  const baseProfileDir = requireEnv("PLAYWRIGHT_PROFILE_DIR");
  const queryUrl = requireEnv("FB_MARKETPLACE_ILOILO_URL");
  const userDataDir = resolveProfileDir(baseProfileDir, browserChannel);
  const runId = randomUUID();
  const nowIso = new Date().toISOString();
  const launchChannel = browserChannel === "chromium" ? undefined : browserChannel;
  const executablePath = launchChannel ? undefined : resolveExecutablePath(browserChannel);

  if (useStealth) puppeteer.use(StealthPlugin());

  const supabase = await createSupabaseClient();
  const targets = await fetchTargets(supabase, args.listingIds, args.limit);
  if (!targets.length) {
    console.log("[BACKFILL] No targets found.");
    return 0;
  }

  const browser = await puppeteer.launch({
    headless,
    userDataDir,
    executablePath,
    channel: launchChannel,
    defaultViewport: { width: 1366, height: 900 },
    args: ["--disable-dev-shm-usage", "--no-sandbox"]
  });

  let updated = 0;
  for (const record of targets) {
    const page = await browser.newPage();
    try {
      const details = await extractDetailFields(page, record);
      const nextDescription =
        details.detailDescription && !isLocationLikeDescription(details.detailDescription)
          ? details.detailDescription
          : record.description;
      const nextLocation = details.detailLocation || record.location_raw;
      const nextStatus = details.listingStatus || record.listing_status || "active";

      const nextRow = {
        listing_id: record.listing_id,
        url: record.url,
        title: record.title,
        price_raw: record.price_raw,
        description: nextDescription,
        location_raw: nextLocation,
        listing_status: nextStatus,
        sold_at: nextStatus === "sold" ? nowIso : null
      };

      const contentHash = computeContentHash(nextRow);

      const upsertRes = await supabase
        .from("iaase_raw_listings")
        .upsert(
          {
            ...nextRow,
            content_hash: contentHash,
            scraped_at: nowIso,
            run_id: runId,
            source: "facebook_marketplace",
            query_url: queryUrl,
            last_seen_at: nowIso,
            last_seen_run_id: runId
          },
          { onConflict: "listing_id" }
        );
      if (upsertRes.error) throw new Error(upsertRes.error.message);

      const versionRes = await supabase.from("iaase_listing_versions").insert({
        listing_id: record.listing_id,
        run_id: runId,
        scraped_at: nowIso,
        content_hash: contentHash,
        listing_status: nextStatus,
        title: record.title,
        description: nextDescription,
        price_raw: record.price_raw,
        location_raw: nextLocation,
        url: record.url,
        changed_fields: ["backfill"]
      });
      if (versionRes.error) throw new Error(versionRes.error.message);

      updated += 1;
      console.log(`[BACKFILL] updated listing_id=${record.listing_id}`);
    } catch (error) {
      console.error(
        `[BACKFILL] failed listing_id=${record.listing_id}: ${error instanceof Error ? error.message : error}`
      );
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log(`[BACKFILL] done updated=${updated}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[BACKFILL] fatal: ${error instanceof Error ? error.stack : String(error)}`);
    process.exit(1);
  });
