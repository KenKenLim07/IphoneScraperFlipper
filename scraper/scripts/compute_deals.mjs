import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { loadDotenv } from "../scraper/env.mjs";

loadDotenv();

function cleanText(value) {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  return raw || null;
}

function requireEnv(name) {
  const value = cleanText(process.env[name]);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseIsoMs(value) {
  const s = cleanText(value);
  if (!s) return null;
  const ms = new Date(s).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function regionCodeFromLocation(value) {
  const s = cleanText(value);
  if (!s) return null;
  const m = /(PH-\d{2})/i.exec(s);
  return m ? m[1].toUpperCase() : null;
}

function normalizeTitle(value) {
  const s = cleanText(value);
  return s ? s.replace(/\s+/g, " ").trim() : "";
}

function parseModelFamily(text) {
  const s = String(text || "").toLowerCase();
  if (!s) return null;

  // Prefer numbered iPhones first.
  const num = /\biphone\s*(\d{1,2})\b/i.exec(s);
  if (num) {
    const n = Number.parseInt(num[1], 10);
    if (Number.isFinite(n) && n >= 7 && n <= 16) return `iphone_${n}`;
  }

  // iPhone XR / XS / X (order matters: XS before X).
  if (/\biphone\s*xr\b/i.test(s)) return "iphone_xr";
  if (/\biphone\s*xs\b/i.test(s)) return "iphone_xs";
  if (/\biphone\s*x\b/i.test(s)) return "iphone_x";

  // iPhone SE (best-effort generation tagging)
  if (/\biphone\s*se\b/i.test(s)) {
    if (/\b(2020|se2|2nd)\b/i.test(s)) return "iphone_se_2";
    if (/\b(2022|se3|3rd)\b/i.test(s)) return "iphone_se_3";
    return "iphone_se";
  }

  return null;
}

function parseVariant(text) {
  const s = String(text || "").toLowerCase();
  // X-series "Max" variants (XS Max). Keep as a distinct variant.
  if (/\b(xs|x)\s*max\b/i.test(s) || /\bxsmax\b/i.test(s)) return "max";
  if (/(pro\s*max|promax)/i.test(s)) return "pro_max";
  if (/\bpro\b/i.test(s)) return "pro";
  if (/\bplus\b/i.test(s)) return "plus";
  if (/\bmini\b/i.test(s)) return "mini";
  return "base";
}

function parseStorageGb(text) {
  const s = String(text || "");
  const m = /\b(\d{2,4})\s*(gb|g|tb|t)\b/i.exec(s);
  if (!m) return null;
  const num = Number.parseInt(m[1], 10);
  if (!Number.isFinite(num) || num <= 0) return null;
  const unit = String(m[2] || "").toLowerCase();
  if (unit === "tb" || unit === "t") return num * 1024;
  return num;
}

function parseBatteryHealth(text) {
  const raw = String(text || "");
  if (!raw) return null;

  // Normalize weird whitespace (NBSP etc.) and reduce noise.
  const s = raw.replace(/[\u00A0\u2007\u202F]/g, " ");

  // Capture battery health only when it's explicitly labeled (avoid false matches like "256 batthealth").
  // Supported patterns:
  // - "100% BH", "100%BH", "100BH", "78bh", "77 bh"
  // - "92 batt health", "Battery health : 88 %", "88% Battery Health", "100 Battery Health"
  // - common typos like "battheath"
  const tag =
    "(?:bh|battery\\s*health|batt\\s*health|bat\\s*health|batt(?:ery)?\\s*health|bat(?:tery)?\\s*health|battheath|batthealt?h|batthealth|bathealth)";
  const candidates = [];

  const patterns = [
    // label then number
    new RegExp(`\\b${tag}\\b[^\\d\\n]{0,24}?(\\d{2,3})\\s*%?\\b`, "ig"),
    // number then label
    new RegExp(`\\b(\\d{2,3})\\s*%?[^\\d\\n]{0,24}?\\b${tag}\\b`, "ig"),
    // "100%bh" compact
    /\b(\d{2,3})\s*%\s*bh\b/gi,
    // compact "100bh" / "78bh"
    /\b(\d{2,3})\s*bh\b/gi,
    // compact "100batt" / "92 batt" (some sellers omit "health")
    /\b(\d{2,3})\s*%?\s*batt\b/gi,
    /\bbatt\s*(\d{2,3})\b/gi,
    /\bbh\s*(\d{2,3})\b/gi
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    for (;;) {
      const m = re.exec(s);
      if (!m) break;
      const raw = m[1];
      const n = Number.parseInt(String(raw), 10);
      if (!Number.isFinite(n)) continue;
      // Only treat 40..100 as valid battery health.
      if (n < 40 || n > 100) continue;
      candidates.push(n);
      if (candidates.length >= 6) break;
    }
  }

  if (!candidates.length) return null;
  // Conservative: keep the lowest mentioned BH if multiple appear.
  return Math.min(...candidates);
}

function parseOpenline(text) {
  const s = String(text || "").toLowerCase();
  if (!s) return null;
  if (/(open\s*line|openline|unlocked|factory\s+unlocked|any\s*sim|anysim)/i.test(s)) return true;
  return null;
}

function parseConditionText(text) {
  const s = String(text || "");
  const patterns = [
    /\bused\s*-\s*like\s*new\b/i,
    /\bused\s*-\s*good\b/i,
    /\bused\s*-\s*fair\b/i,
    /\blike\s*new\b/i,
    /\bbrand\s*new\b/i,
    /\bnew\b/i
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m) return cleanText(m[0]);
  }
  return null;
}

function hasIcloudRisk(text) {
  const s = String(text || "").toLowerCase();
  if (!s) return false;
  if (/\bnot\s+safe\s+to\s+reset\b/i.test(s)) return true;
  if (/\bactivation\s+lock\b/i.test(s)) return true;
  if (/\bicloud\b/i.test(s)) return true;
  if (/\bbypass\b/i.test(s)) return true;
  // "locked" is ambiguous; still treat as risky in v1.
  if (/\blocked\b/i.test(s)) return true;
  return false;
}

function anyMatch(text, patterns) {
  const s = String(text || "");
  if (!s) return false;
  for (const re of patterns) {
    re.lastIndex = 0;
    if (re.test(s)) return true;
  }
  return false;
}

function detectLcdReplaced(text) {
  const raw = String(text || "");
  if (!raw) return false;

  // Avoid false positives when the seller explicitly says the LCD is original / not replaced.
  const negated = anyMatch(raw, [
    /\boriginal\s+lcd\b/i,
    /\borig(?:inal)?\b[^\n]{0,12}\blcd\b/i,
    /\blcd\b[^\n]{0,24}\b(not|never)\s*(?:been\s*)?(?:replac|palit)\w*\b/i,
    /\b(not|never)\s*(?:been\s*)?(?:replac|palit)\w*\b[^\n]{0,24}\blcd\b/i,
    /\borig\b[^\n]{0,24}\blcd\b[^\n]{0,24}\bnot\s*replac\w*\b/i
  ]);
  if (negated) return false;

  // Strong evidence of replacement / aftermarket display types.
  if (anyMatch(raw, [/\bincell\b/i, /\bin-?cell\b/i])) return true;

  const replaced = anyMatch(raw, [
    /\b(replace|replaced|replacement|palit|pinalitan)\b[^\n]{0,24}\b(lcd|oled|screen|display)\b/i,
    /\b(lcd|oled|screen|display)\b[^\n]{0,24}\b(replace|replaced|replacement|palit|pinalitan)\b/i,
    /\b(replaced)\s+(oled|lcd)\b/i,
    /\bpalit\s+(oled|lcd)\b/i
  ]);

  return replaced;
}

function detectIssues(text) {
  const raw = String(text || "");
  const s = raw.toLowerCase();
  if (!raw) {
    return {
      face_id_working: null,
      face_id_not_working: false,
      trutone_working: null,
      trutone_missing: false,
      lcd_replaced: false,
      back_glass_replaced: false,
      camera_issue: false,
      screen_issue: false,
      network_locked: false
    };
  }

  const faceIdNo = anyMatch(raw, [
    /\b(no|wala|wla)\s+face\s*id\b/i,
    /\bface\s*id\b[^\n]{0,40}\b(not\s*work|not\s*working|issue|broken|defect|dead|disable|disabled)\b/i,
    /\bfaceid\b[^\n]{0,40}\b(not\s*work|not\s*working|issue|broken|defect|dead)\b/i,
    /\b(di|indi)\s+ga\s+work\s+face\s*id\b/i,
    /\bface\s*id\b[^\n]{0,12}(?:❌|✖️|✗|x|×)/i,
    /(?:❌|✖️|✗)\s*face\s*id\b/i
  ]);
  const faceIdYes = anyMatch(raw, [
    /\bface\s*id\b[^\n]{0,40}\b(working|works|okay|ok|functional)\b/i,
    /\b(working|works|okay|ok|functional)\b[^\n]{0,40}\bface\s*id\b/i,
    /\b(with|w\/|may)\s*face\s*id\b/i,
    /\bface\s*id\b[^\n]{0,12}(?:✅|✔️|☑️)/i,
    /(?:✅|✔️|☑️)\s*face\s*id\b/i
  ]);
  const faceIdNotWorking = !!faceIdNo;
  const faceIdWorking = !faceIdNo && !!faceIdYes;

  const trueToneNo = anyMatch(raw, [
    /\b(no|wala|wla)\s+(?:true\s*tone|trutone)\b/i,
    /\b(?:true\s*tone|trutone)\b[^\n]{0,40}\b(not\s*work|not\s*working|issue|broken|missing|wala|dead)\b/i,
    /\b(?:true\s*tone|trutone)\b[^\n]{0,12}(?:❌|✖️|✗|x|×)/i,
    /(?:❌|✖️|✗)\s*(?:true\s*tone|trutone)\b/i
  ]);
  const trueToneYes = anyMatch(raw, [
    /\b(?:true\s*tone|trutone)\b[^\n]{0,40}\b(working|works|okay|ok|functional)\b/i,
    /\b(working|works|okay|ok|functional)\b[^\n]{0,40}\b(?:true\s*tone|trutone)\b/i,
    /\b(with|w\/|may)\s*(?:true\s*tone|trutone)\b/i,
    /\b(?:true\s*tone|trutone)\b[^\n]{0,12}(?:✅|✔️|☑️)/i,
    /(?:✅|✔️|☑️)\s*(?:true\s*tone|trutone)\b/i
  ]);
  const trueToneMissing = !!trueToneNo;
  const trueToneWorking = !trueToneNo && !!trueToneYes;

  const lcdReplaced = detectLcdReplaced(raw);

  const backGlassReplaced =
    /\bback\s*glass\b[^\n]{0,40}\b(replace|replaced|replacement)\b/i.test(s) ||
    /\breplaced\s+back\s*glass\b/i.test(s);

  const cameraIssue =
    /\bcamera\b[^\n]{0,40}\b(issue|problem|broken|not\s*work|not\s*working|blur|fog)\b/i.test(s) ||
    /\bno\s+camera\b/i.test(s);

  const screenIssue =
    /\bscreen\b[^\n]{0,40}\b(issue|problem|broken|lines|green|pink|flicker|burn|dead|touch)\b/i.test(s) ||
    /\bghost\s*touch\b/i.test(s) ||
    /\bline(s)?\s+sa\s+screen\b/i.test(s);

  const networkLocked =
    /\bglobe\s*lock\b/i.test(s) ||
    /\bsmart\s*lock\b/i.test(s) ||
    /\btnt\s*lock\b/i.test(s) ||
    /\bsim\s*lock\b/i.test(s) ||
    /\bnetwork\s*lock\b/i.test(s) ||
    /\blocked\s+to\s+(globe|smart|tnt)\b/i.test(s) ||
    /\b(globe|smart|tnt)\b[^\n]{0,18}\bonly\b/i.test(s) ||
    /\b(globe|smart|tnt)\b[^\n]{0,18}\bonly\s*sim\b/i.test(s) ||
    /\bsmart\s*tnt\b[^\n]{0,18}\bonly\b/i.test(s);

  return {
    face_id_working: faceIdWorking ? true : null,
    face_id_not_working: !!faceIdNotWorking,
    trutone_working: trueToneWorking ? true : null,
    trutone_missing: !!trueToneMissing,
    lcd_replaced: !!lcdReplaced,
    back_glass_replaced: !!backGlassReplaced,
    camera_issue: !!cameraIssue,
    screen_issue: !!screenIssue,
    network_locked: !!networkLocked
  };
}

function looksLikeWantedPost(title) {
  const t = normalizeTitle(title).toLowerCase();
  if (!t) return false;
  return /^(lf\b|lf:|looking\s+for\b|wtb\b|buying\b)/i.test(t) || /\bbuying\s+rush\b/i.test(t);
}

function quantile(sorted, q) {
  const n = sorted.length;
  if (!n) return null;
  if (n === 1) return sorted[0];
  const pos = (n - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const a = sorted[base];
  const b = sorted[Math.min(n - 1, base + 1)];
  return a + rest * (b - a);
}

function scoreFromBelowPct(belowPct) {
  if (belowPct == null || !Number.isFinite(belowPct)) return "NA";
  if (belowPct >= 0.25) return "A";
  if (belowPct >= 0.15) return "B";
  if (belowPct >= 0.08) return "C";
  return "D";
}

function scoreRank(score) {
  const s = String(score || "").toUpperCase();
  if (s === "A") return 4;
  if (s === "B") return 3;
  if (s === "C") return 2;
  if (s === "D") return 1;
  return 0; // NA/unknown
}

function applyMaxScore(score, cap) {
  const s = String(score || "").toUpperCase();
  const c = String(cap || "").toUpperCase();
  const r = scoreRank(s);
  const cr = scoreRank(c);
  if (!cr) return s || "NA";
  if (!r) return s || "NA";
  if (r <= cr) return s; // already worse/equal than cap
  return c;
}

function confidenceFromSample(sampleSize, complete) {
  if (!complete) return "low";
  if (sampleSize >= 30) return "high";
  if (sampleSize >= 10) return "med";
  return "low";
}

function riskCostFromText(text) {
  const s = String(text || "");
  if (!s) return 0;

  const issues = detectIssues(s);
  const cost = (re, v) => (re.test(s) ? v : 0);
  const faceId = issues.face_id_not_working ? 3000 : 0;
  const trutone = issues.trutone_missing ? 1500 : 0;
  const camera = issues.camera_issue ? 2000 : 0;
  const display = issues.lcd_replaced ? 2500 : issues.screen_issue ? 2500 : 0;
  const battery = cost(/\bbattery\b.*\b(issue|problem|broken|service)\b/i, 1500);

  return faceId + trutone + camera + display + battery;
}

function formatPhpCompact(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 }).format(n);
}

function makeSupabase() {
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const supabase = makeSupabase();
  const debugListingId = cleanText(process.env.DEALS_DEBUG_LISTING_ID);

  const nowMs = Date.now();
  const windowDays = 30;
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const cutoffMs = nowMs - windowMs;
  const limit = Math.max(100, Number.parseInt(process.env.DEALS_MAX_LISTINGS || "5000", 10) || 5000);

  console.log(`[INFO] deals_start window_days=${windowDays} max_listings=${limit}`);

  const listingsRes = await supabase
    .from("listings")
    .select(
      "listing_id,title,description,condition_raw,location_raw,price_php,status,posted_at,first_seen_at,last_seen_at"
    )
    .eq("status", "active")
    .order("posted_at", { ascending: false, nullsFirst: false })
    .order("first_seen_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (listingsRes.error) throw new Error(listingsRes.error.message);
  const listings = listingsRes.data || [];

  const featuresById = new Map();
  const candidates = [];

  for (const l of listings) {
    const listingId = String(l.listing_id || "");
    if (!listingId) continue;
    const title = cleanText(l.title) || "";
    const desc = cleanText(l.description) || "";
    const text = `${title}\n${desc}`;

    const modelFamily = parseModelFamily(text);
    if (!modelFamily) continue;

    const variant = parseVariant(text);
    const storageGb = parseStorageGb(text);
    const batteryHealth = parseBatteryHealth(text);
    const openline = parseOpenline(text);
    // Condition is a canonical Marketplace field; rely on scraped `listings.condition_raw`.
    const conditionText = parseConditionText(l.condition_raw);
    const regionCode = regionCodeFromLocation(l.location_raw);
    const issues = detectIssues(text);

    const descLen = cleanText(l.description)?.length || 0;
    const noDescription = descLen < 24;

    if (debugListingId && debugListingId === listingId) {
      console.log(
        `[DEBUG] listing_id=${listingId} battery_health=${batteryHealth ?? "n/a"} storage_gb=${storageGb ?? "n/a"} desc_len=${descLen} ` +
          `text_preview="${cleanText(text)?.slice(0, 200) || "n/a"}"`
      );
    }

    const riskFlags = {
      icloud_lock: hasIcloudRisk(text) || null,
      wanted_post: looksLikeWantedPost(title) || null,
      face_id_working: issues.face_id_working || null,
      face_id_not_working: issues.face_id_not_working || null,
      trutone_working: issues.trutone_working || null,
      trutone_missing: issues.trutone_missing || null,
      lcd_replaced: issues.lcd_replaced || null,
      back_glass_replaced: issues.back_glass_replaced || null,
      camera_issue: issues.camera_issue || null,
      screen_issue: issues.screen_issue || null,
      network_locked: issues.network_locked || null,
      no_description: noDescription || null
    };

    const listingTimeMs =
      parseIsoMs(l.posted_at) ?? parseIsoMs(l.first_seen_at) ?? parseIsoMs(l.last_seen_at) ?? null;

    const row = {
      listing_id: listingId,
      model_family: modelFamily,
      variant,
      storage_gb: storageGb,
      battery_health: batteryHealth,
      openline,
      condition_text: conditionText,
      region_code: regionCode,
      risk_flags: riskFlags,
      updated_at: new Date().toISOString()
    };

    featuresById.set(listingId, row);

    candidates.push({
      listing_id: listingId,
      price_php: typeof l.price_php === "number" ? l.price_php : l.price_php == null ? null : Number(l.price_php),
      listing_time_ms: listingTimeMs,
      region_code: regionCode,
      model_family: modelFamily,
      variant,
      storage_gb: storageGb,
      title,
      description: desc,
      description_len: descLen,
      risk_flags: riskFlags
    });
  }

  const recentPriced = candidates.filter(
    (c) =>
      c.price_php != null &&
      Number.isFinite(c.price_php) &&
      c.listing_time_ms != null &&
      c.listing_time_ms >= cutoffMs
  );

  const groupKey = (region, modelFamily, variant, storageGb) =>
    `${region || "ALL"}|${modelFamily || "unknown"}|${variant || "base"}|${storageGb ?? "unknown"}`;

  const groups = new Map();
  const groupsAll = new Map();
  for (const c of recentPriced) {
    const keyRegional = groupKey(c.region_code, c.model_family, c.variant, c.storage_gb);
    if (!groups.has(keyRegional)) groups.set(keyRegional, []);
    groups.get(keyRegional).push(c);

    const keyAll = groupKey("ALL", c.model_family, c.variant, c.storage_gb);
    if (!groupsAll.has(keyAll)) groupsAll.set(keyAll, []);
    groupsAll.get(keyAll).push(c);
  }

  const dealRows = [];
  const nowIso = new Date().toISOString();

  for (const c of candidates) {
    const featureComplete = !!(c.model_family && c.variant && c.storage_gb != null);

    const primaryKey = groupKey(c.region_code, c.model_family, c.variant, c.storage_gb);
    const allKey = groupKey("ALL", c.model_family, c.variant, c.storage_gb);

    let comps = (groups.get(primaryKey) || []).filter((x) => x.listing_id !== c.listing_id);
    let compRegionCode = c.region_code || null;
    if (comps.length < 10) {
      const fallback = (groupsAll.get(allKey) || []).filter((x) => x.listing_id !== c.listing_id);
      if (fallback.length) {
        comps = fallback;
        compRegionCode = "ALL";
      }
    }

    const prices = comps
      .map((x) => x.price_php)
      .filter((p) => p != null && Number.isFinite(p))
      .map((p) => Number(p))
      .sort((a, b) => a - b);

    const sampleSize = prices.length;
    const p25 = sampleSize >= 3 ? quantile(prices, 0.25) : null;
    const p50 = sampleSize >= 3 ? quantile(prices, 0.5) : null;
    const p75 = sampleSize >= 3 ? quantile(prices, 0.75) : null;

    const asking = c.price_php != null && Number.isFinite(c.price_php) ? Number(c.price_php) : null;
    const hardBlock = !!(c.risk_flags?.icloud_lock || c.risk_flags?.wanted_post);
    const hasCriticalIssue = !!(
      c.risk_flags?.face_id_not_working ||
      c.risk_flags?.screen_issue ||
      c.risk_flags?.camera_issue ||
      c.risk_flags?.lcd_replaced ||
      c.risk_flags?.network_locked
    );
    const hasMinorIssue = !!(c.risk_flags?.trutone_missing || c.risk_flags?.back_glass_replaced);
    const lowConfidenceComps = sampleSize < 10;
    const noDesc = !!c.risk_flags?.no_description;

    let belowMarketPct = null;
    if (!hardBlock && asking != null && p50 != null && Number.isFinite(p50) && p50 > 0) {
      belowMarketPct = (p50 - asking) / p50;
    }

    let dealScore = hardBlock ? "NA" : scoreFromBelowPct(belowMarketPct);
    const baseScore = dealScore;

    // Caps (max score constraints)
    let cap = null;
    if (!hardBlock && hasCriticalIssue) cap = "C";
    if (!hardBlock && !cap && hasMinorIssue) cap = "B";
    if (!hardBlock && (lowConfidenceComps || noDesc)) cap = "C";
    if (cap) {
      dealScore = applyMaxScore(dealScore, cap);
    }

    const confidence = confidenceFromSample(sampleSize, featureComplete);

    const costBuffer = 1000;
    const riskCost = riskCostFromText(`${c.title}\n${c.description}`);
    const estProfit =
      !hardBlock && asking != null && p50 != null && Number.isFinite(p50)
        ? p50 - asking - (costBuffer + riskCost)
        : null;

    const reasons = [];
    if (hardBlock) {
      if (c.risk_flags?.wanted_post) reasons.push("❌ Looks like a buyer / wanted post (LF/WTB/Buying)");
      if (c.risk_flags?.icloud_lock) reasons.push("❌ High risk keywords found (iCloud/locked/bypass/reset/not safe to reset)");
    }

    if (!hardBlock && belowMarketPct != null) {
      const pct = Math.round(belowMarketPct * 100);
      reasons.push(`${pct}% below market (p50 ₱${formatPhpCompact(p50)})`);
    }

    if (!hardBlock && baseScore !== dealScore && cap) {
      if (hasCriticalIssue) {
        if (c.risk_flags?.face_id_not_working) reasons.push("⚠️ Face ID not working (score capped to C)");
        if (c.risk_flags?.screen_issue) reasons.push("⚠️ Screen issue detected (score capped to C)");
        if (c.risk_flags?.camera_issue) reasons.push("⚠️ Camera issue detected (score capped to C)");
        if (c.risk_flags?.lcd_replaced) reasons.push("⚠️ LCD replaced (score capped to C)");
        if (c.risk_flags?.network_locked) reasons.push("⚠️ Network-locked (Globe/Smart/SIM lock) (score capped to C)");
      } else if (hasMinorIssue) {
        if (c.risk_flags?.trutone_missing) reasons.push("⚠️ TrueTone missing (score capped to B)");
        if (c.risk_flags?.back_glass_replaced) reasons.push("⚠️ Back glass replaced (score capped to B)");
      }

      if (lowConfidenceComps) reasons.push(`⚠️ Low confidence comps (n=${sampleSize}, score capped to C)`);
      if (noDesc) reasons.push("⚠️ No/short description (unknown condition, score capped to C)");
    } else {
      if (!hardBlock && lowConfidenceComps) reasons.push(`⚠️ Low confidence comps (n=${sampleSize})`);
      if (!hardBlock && noDesc) reasons.push("⚠️ No/short description (unknown condition)");
    }

    if (!hardBlock && riskCost > 0) {
      reasons.push(`Risk cost applied: ₱${formatPhpCompact(riskCost)}`);
    }

    reasons.push(`Confidence: ${confidence} (n=${sampleSize} comps)`);

    const ageMs = c.listing_time_ms != null ? nowMs - c.listing_time_ms : null;
    if (ageMs != null && Number.isFinite(ageMs)) {
      const ageHr = ageMs / (60 * 60 * 1000);
      if (ageHr <= 6) reasons.push("New listing (≤6h)");
      else if (ageHr <= 24) reasons.push("Recent listing (≤24h)");
    }

    // If score is D, keep it computed but the UI will hide it from the public table.
    if (dealScore === "NA") {
      // Ensure NA isn't accidentally shown due to NaN math.
      belowMarketPct = null;
    }

    dealRows.push({
      listing_id: c.listing_id,
      asking_price_php: asking,
      comp_region_code: compRegionCode,
      comp_sample_size: sampleSize,
      comp_p25: p25 == null ? null : Number(p25.toFixed(2)),
      comp_p50: p50 == null ? null : Number(p50.toFixed(2)),
      comp_p75: p75 == null ? null : Number(p75.toFixed(2)),
      below_market_pct: belowMarketPct == null ? null : Number(belowMarketPct.toFixed(4)),
      deal_score: dealScore,
      confidence,
      est_profit_php: estProfit == null ? null : Number(estProfit.toFixed(2)),
      reasons,
      computed_at: nowIso
    });
  }

  const features = Array.from(featuresById.values());

  console.log(
    `[INFO] deals_compute candidates=${candidates.length} features=${features.length} metrics=${dealRows.length} recent_priced=${recentPriced.length}`
  );

  if (features.length) {
    const res = await supabase.from("listing_features").upsert(features, { onConflict: "listing_id" });
    if (res.error) throw new Error(res.error.message);
  }

  if (dealRows.length) {
    const res = await supabase.from("deal_metrics").upsert(dealRows, { onConflict: "listing_id" });
    if (res.error) throw new Error(res.error.message);
  }

  const sample = dealRows.find((r) => r.deal_score === "A" || r.deal_score === "B" || r.deal_score === "C") || dealRows[0];
  if (sample) {
    console.log(
      `[INFO] deals_sample listing_id=${sample.listing_id} score=${sample.deal_score} below_market_pct=${sample.below_market_pct ?? "n/a"} profit=${sample.est_profit_php ?? "n/a"} comps_n=${sample.comp_sample_size}`
    );
  }

  console.log("[SUMMARY] deals_done status=success");
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[ERROR] ${msg}`);
  if (/relation .*listing_features.* does not exist|relation .*deal_metrics.* does not exist/i.test(msg)) {
    console.error("[HINT] Run the Supabase SQL migration: scraper/sql/add_deal_intelligence_tables.sql");
  }
  if (/column .*condition_raw.* does not exist/i.test(msg)) {
    console.error("[HINT] Run the Supabase SQL migration: scraper/sql/add_condition_raw.sql");
  }
  process.exit(1);
});
