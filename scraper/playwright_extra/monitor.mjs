import { createClient } from "@supabase/supabase-js";

import { cleanOgTitle, deriveLocationFromDetail, derivePriceRawFromDetail, extractDetailFieldsFromPage, looksLikeSoldListing, looksLikeUnavailableListing } from "./extract_detail.mjs";
import { looksLikeGenericMarketplaceShell, looksLikeLoginOrBlock, safePageTitle } from "./fb_checks.mjs";
import { cleanText, gotoWithRetry, gotoWithRetryWithReferer, inferDescription, parsePhpPrice, randomBetween, sleep } from "./utils.mjs";

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

export async function fetchWatchlistCandidates({ limit }) {
  if (!limit || limit <= 0) return [];
  const supabase = createSupabaseClient();

  const query = supabase
    .from("listings")
    .select("listing_id,url,title,description,location_raw,price_raw,price_php,status,last_seen_at")
    .eq("status", "active");

  query.order("last_seen_at", { ascending: true, nullsFirst: true });

  const res = await query.limit(Math.max(1, Math.min(limit, 5000)));
  if (res.error) throw new Error(`DB watchlist fetch failed: ${res.error.message}`);
  const candidates = dedupeCandidates(res.data || []);
  return candidates.slice(0, limit);
}

async function recheckOne(page, candidate, opts, index, total) {
  const nowIso = new Date().toISOString();
  const url = cleanText(candidate.url);
  const listingId = cleanText(candidate.listing_id);
  if (!url || !listingId) return null;

  const label = cleanText(opts.label) || "monitor";
  const base = Number.isFinite(opts.progressBase) ? opts.progressBase : 0;
  const globalTotal = Number.isFinite(opts.progressTotal) ? opts.progressTotal : null;
  const globalIndex = base + index;
  if (globalTotal) {
    opts.log?.(
      `[INFO] ${label}_check ${globalIndex}/${globalTotal} (chunk ${index}/${total}) listing_id=${listingId} url=${url}`
    );
  } else {
    opts.log?.(`[INFO] ${label}_check ${index}/${total} listing_id=${listingId} url=${url}`);
  }

  try {
    await gotoWithRetryWithReferer(page, url, opts.gotoRetries, 4000, opts.refererUrl);
    await sleep(randomBetween(opts.delayMin, opts.delayMax));
    if (opts.waitForNetworkIdle) {
      try {
        await page.waitForLoadState("networkidle", { timeout: 15000 });
      } catch {}
    } else {
      // In fast mode, don't wait for images/ads. Just ensure DOM + og tags are present.
      try {
        await page.waitForSelector("meta[property='og:title']", { timeout: 6000 });
      } catch {}
    }

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
    let derivedDescription = detailDescription || cleanText(fallbackDescription) || cleanText(candidate.description);

    // Guard: when Facebook redirects to a generic Marketplace shell, we sometimes pick up header chrome text.
    if (derivedDescription && /find friends\s*\|\s*marketplace\s*\|\s*browse all/i.test(derivedDescription)) {
      derivedDescription = cleanText(candidate.description);
    }

    if (opts.logEnabled) {
      const src = detailDescription ? "detail" : fallbackDescription ? "fallback" : "none";
      const preview = cleanText(derivedDescription)?.slice(0, 80) || "n/a";
      opts.log?.(
        `[INFO] ${label}_desc listing_id=${listingId} source=${src} desc_len=${(derivedDescription || "").length} ` +
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
    const page = await context.newPage();
    if (opts.blockImages) {
      try {
        await page.route("**/*", (route) => {
          try {
            const type = route.request().resourceType();
            if (type === "image" || type === "media" || type === "font") return route.abort();
            return route.continue();
          } catch {
            return route.continue();
          }
        });
      } catch {}
    }
    pages.push(page);
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

export async function recheckCandidatesChunk({
  context,
  runId,
  queryUrl,
  gotoRetries,
  delayMin,
  delayMax,
  concurrency,
  candidates,
  logEnabled,
  log,
  label = "monitor",
  blockImages = false,
  waitForNetworkIdle = true,
  progressBase = 0,
  progressTotal = null
}) {
  return recheckParallel(context, candidates, {
    runId,
    gotoRetries,
    delayMin,
    delayMax,
    concurrency,
    refererUrl: queryUrl,
    warmupUrl: queryUrl,
    logEnabled,
    log,
    label,
    blockImages,
    waitForNetworkIdle,
    progressBase,
    progressTotal
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
  concurrency,
  chunkSize,
  logEnabled,
  log
}) {
  const candidates = await fetchWatchlistCandidates({ limit });
  log?.(`[INFO] monitor_start limit=${limit} mode=oldest concurrency=${concurrency} candidates=${candidates.length}`);

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
