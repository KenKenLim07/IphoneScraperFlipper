import { createClient } from "@supabase/supabase-js";

import { cleanOgTitle, deriveLocationFromDetail, derivePriceRawFromDetail, extractDetailFieldsFromPage, looksLikeSoldListing, looksLikeUnavailableListing } from "./extract_detail.mjs";
import { looksLikeGenericMarketplaceShell, looksLikeLoginOrBlock, safePageTitle } from "./fb_checks.mjs";
import { cleanText, envBool, envInt, gotoWithRetry, gotoWithRetryWithReferer, inferDescription, isWeakDescription, parsePhpPrice, randomBetween, sleep } from "./utils.mjs";

function createSupabaseClient() {
  const url = cleanText(process.env.SUPABASE_URL);
  const key = cleanText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.");
  return createClient(url, key, { auth: { persistSession: false } });
}

function dedupeCandidates(candidates) {
  const byListingId = new Map();
  for (const row of candidates || []) {
    const key = cleanText(row?.listing_id);
    if (!key) continue;
    if (byListingId.has(key)) continue;
    byListingId.set(key, row);
  }
  return Array.from(byListingId.values());
}

export async function fetchWatchlistCandidates({ limit, mode, tzOffsetMinutes }) {
  if (!limit || limit <= 0) return [];
  const supabase = createSupabaseClient();
  const prioritizeMissing = envBool("PLAYWRIGHT_WATCHLIST_PRIORITIZE_MISSING_DESCRIPTION", false);
  const missingQuota = Math.max(
    0,
    Math.min(1, Number.parseFloat(process.env.PLAYWRIGHT_WATCHLIST_MISSING_DESCRIPTION_QUOTA || "0.4"))
  );
  const fetchMultiplier = Math.max(1, envInt("PLAYWRIGHT_WATCHLIST_FETCH_MULTIPLIER", prioritizeMissing ? 5 : 1));
  const fetchLimit = Math.max(1, Math.min(limit * fetchMultiplier, 5000));

  const query = supabase
    .from("listings")
    .select("listing_id,url,title,description,location_raw,price_raw,price_php,status,last_seen_at")
    .eq("status", "active");

  if (mode !== "oldest") {
    throw new Error("Unsupported watchlist mode. Use PLAYWRIGHT_WATCHLIST_RECHECK_MODE=oldest.");
  }

  query.order("last_seen_at", { ascending: true, nullsFirst: true });

  const res = await query.limit(fetchLimit);
  if (res.error) throw new Error(`DB watchlist fetch failed: ${res.error.message}`);
  const candidates = dedupeCandidates(res.data || []);

  if (!prioritizeMissing) return candidates.slice(0, limit);

  // Hybrid selection: reserve some of the budget for missing descriptions, but don't starve staleness.
  const missing = [];
  const rest = [];
  for (const c of candidates) {
    if (isWeakDescription(c.description)) missing.push(c);
    else rest.push(c);
  }

  const missingBudget = Math.min(missing.length, Math.max(0, Math.round(limit * missingQuota)));
  const picked = [];
  for (let i = 0; i < missing.length && picked.length < missingBudget; i += 1) {
    picked.push(missing[i]);
  }
  for (let i = 0; i < rest.length && picked.length < limit; i += 1) {
    picked.push(rest[i]);
  }
  // If we didn't fill the full limit from rest, top-up from remaining missing items.
  for (let i = missingBudget; i < missing.length && picked.length < limit; i += 1) {
    picked.push(missing[i]);
  }

  return picked;
}

async function recheckOne(page, candidate, opts, index, total) {
  const nowIso = new Date().toISOString();
  const url = cleanText(candidate.url);
  const listingId = cleanText(candidate.listing_id);
  if (!url || !listingId) return null;

  opts.log?.(`[INFO] monitor_check ${index}/${total} listing_id=${listingId} url=${url}`);

  try {
    await gotoWithRetryWithReferer(page, url, opts.gotoRetries, 4000, opts.refererUrl);
    await sleep(randomBetween(opts.delayMin, opts.delayMax));
    try {
      await page.waitForLoadState("networkidle", { timeout: 15000 });
    } catch {}

    const bodyText = await page.evaluate(() => document.body?.innerText || "");
    if (looksLikeLoginOrBlock(page.url(), bodyText)) {
      throw new Error("Session looks logged out or blocked.");
    }

    const meta = await page.evaluate(() => ({
      ogTitle: document.querySelector("meta[property='og:title']")?.getAttribute("content") || null,
      ogDescription: document.querySelector("meta[property='og:description']")?.getAttribute("content") || null
    }));

    if (looksLikeGenericMarketplaceShell(page.url(), meta.ogTitle)) {
      await sleep(1200);
      await gotoWithRetryWithReferer(page, url, 0, 0, opts.refererUrl);
      try {
        await page.waitForLoadState("networkidle", { timeout: 15000 });
      } catch {}
    }

    const derivedTitle = cleanOgTitle(meta.ogTitle) || cleanText(candidate.title);
    const derivedPriceRaw = derivePriceRawFromDetail({
      bodyText,
      metaOgDescription: meta.ogDescription,
      fallback: candidate.price_raw
    });

    const details = await extractDetailFieldsFromPage(page, {
      title: derivedTitle,
      price_raw: derivedPriceRaw
    });

    const derivedLocationRaw = deriveLocationFromDetail({
      bodyText,
      detailLocation: details.detailLocation,
      fallback: candidate.location_raw
    });

    const detailDescription = cleanText(details.detailDescription);
    const fallbackDescription = inferDescription(bodyText, derivedTitle, derivedPriceRaw);
    const derivedDescription = detailDescription || cleanText(fallbackDescription) || cleanText(candidate.description);

    if (opts.logEnabled) {
      const src = detailDescription ? "detail" : fallbackDescription ? "fallback" : "none";
      const preview = cleanText(derivedDescription)?.slice(0, 80) || "n/a";
      opts.log?.(
        `[INFO] monitor_desc listing_id=${listingId} source=${src} desc_len=${(derivedDescription || "").length} ` +
          `desc_preview="${preview}"`
      );
    }

    let listingStatus = "active";
    if (looksLikeUnavailableListing(bodyText)) listingStatus = "unavailable";
    else if (looksLikeSoldListing(bodyText)) listingStatus = "sold";

    return {
      listing_id: listingId,
      url,
      title: derivedTitle,
      description: derivedDescription,
      location_raw: derivedLocationRaw,
      price_raw: derivedPriceRaw,
      price_php: parsePhpPrice(derivedPriceRaw),
      listing_status: listingStatus,
      scraped_at: nowIso,
      run_id: opts.runId
    };
  } catch (error) {
    const title = await safePageTitle(page);
    const msg = error instanceof Error ? error.message : String(error);
    opts.log?.(`[WARN] monitor_failed listing_id=${listingId} error=${msg.slice(0, 160)} title=${title}`);
    return null;
  }
}

async function recheckParallel(context, candidates, opts) {
  const concurrency = Math.max(1, Math.min(opts.concurrency || 1, 6, candidates.length || 1));
  const pages = [];
  for (let i = 0; i < concurrency; i += 1) {
    pages.push(await context.newPage());
  }

  if (opts.warmupUrl) {
    await Promise.all(
      pages.map(async (p) => {
        try {
          await gotoWithRetry(p, opts.warmupUrl, 0, 0);
        } catch {}
      })
    );
  }

  const out = [];
  const total = candidates.length;
  let cursor = 0;

  async function worker(page) {
    for (;;) {
      const myIndex = cursor;
      cursor += 1;
      if (myIndex >= total) return;
      const candidate = candidates[myIndex];
      const row = await recheckOne(page, candidate, opts, myIndex + 1, total);
      if (row) out.push(row);
    }
  }

  try {
    await Promise.all(pages.map((p) => worker(p)));
  } finally {
    await Promise.all(pages.map((p) => p.close().catch(() => {})));
  }

  return out;
}

export async function recheckCandidatesChunk({ context, runId, queryUrl, gotoRetries, delayMin, delayMax, concurrency, candidates, logEnabled, log }) {
  return recheckParallel(context, candidates, {
    runId,
    gotoRetries,
    delayMin,
    delayMax,
    concurrency,
    refererUrl: queryUrl,
    warmupUrl: queryUrl,
    logEnabled,
    log
  });
}

export async function runMonitor({
  context,
  runId,
  queryUrl,
  gotoRetries,
  delayMin,
  delayMax,
  limit,
  mode,
  tzOffsetMinutes,
  concurrency,
  chunkSize,
  logEnabled,
  log
}) {
  const candidates = await fetchWatchlistCandidates({ limit, mode, tzOffsetMinutes });
  log?.(`[INFO] monitor_start limit=${limit} mode=${mode} concurrency=${concurrency} candidates=${candidates.length}`);

  const size = Math.max(1, chunkSize || 20);
  const rows = [];
  for (let i = 0; i < candidates.length; i += size) {
    const chunk = candidates.slice(i, i + size);
    // eslint-disable-next-line no-await-in-loop
    const out = await recheckCandidatesChunk({
      context,
      runId,
      queryUrl,
      gotoRetries,
      delayMin,
      delayMax,
      concurrency,
      candidates: chunk,
      logEnabled,
      log
    });
    rows.push(...out);
  }
  return { candidatesCount: candidates.length, rows };
}
