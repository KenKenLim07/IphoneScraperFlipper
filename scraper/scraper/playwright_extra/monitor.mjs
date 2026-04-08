import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import {
  cleanOgTitle,
  deriveLocationFromDetail,
  derivePriceRawFromDetail,
  extractDetailFieldsFromPage,
  looksLikeSoldListing,
  looksLikeUnavailableListing
} from "./extract_detail.mjs";
import { collectNetworkListingsFromPayload, installNetworkListingCollector, parseJsonishPayload } from "./extract_feed.mjs";
import { looksLikeGenericMarketplaceShell, looksLikeLoginOrBlock, safePageTitle } from "./fb_checks.mjs";
import {
  cleanText,
  envBool,
  gotoWithRetry,
  gotoWithRetryWithReferer,
  inferDescription,
  inferHeaderLocationRaw,
  inferHeaderPriceRaw,
  inferPostedAtFromBodyText,
  looksLikeBuyerWantedPost,
  parsePhpPrice,
  randomBetween,
  sanitizeTitle,
  sleep
} from "./utils.mjs";

function inferLocationCityState(locationRaw) {
  const cleaned = cleanText(locationRaw);
  if (!cleaned) return { city: null, state: null };
  const match = cleaned.match(/^(.+?),\s*(PH-\d{2})$/i);
  if (!match) return { city: null, state: null };
  return { city: cleanText(match[1]), state: cleanText(match[2]) };
}

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
  let candidates = dedupeCandidates(res.data || []);

  const skipBuyers = envBool("PLAYWRIGHT_WATCHLIST_SKIP_BUYERS", true);
  if (skipBuyers) {
    candidates = candidates.filter((c) => !looksLikeBuyerWantedPost(c?.title || ""));
  }
  return candidates.slice(0, limit);
}

async function recheckOne(page, candidate, opts, index, total) {
  const nowIso = new Date().toISOString();
  const url = cleanText(candidate.url);
  const listingId = cleanText(candidate.listing_id);
  if (!url || !listingId) return null;
  const graphqlOnly = envBool("PLAYWRIGHT_MONITOR_GRAPHQL_ONLY", false);

  const networkCollector =
    opts.useNetwork && opts.runId
      ? installNetworkListingCollector(page, { log: opts.log, saveNetworkRaw: opts.saveNetworkRaw, runId: opts.runId })
      : null;

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
    if (networkCollector) {
      try {
        await page.setCacheEnabled(false);
      } catch {}
    }
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

    if (networkCollector) {
      const pokeCountRaw =
        process.env.SCRAPE_MONITOR_NETWORK_POKE_COUNT ??
        process.env.SCRAPE_NETWORK_POKE_COUNT ??
        "2";
      const pokeWaitRaw =
        process.env.SCRAPE_MONITOR_NETWORK_POKE_WAIT_MS ??
        process.env.SCRAPE_NETWORK_POKE_WAIT_MS ??
        "1200";
      const pokeCount = Math.max(0, Number.parseInt(pokeCountRaw, 10) || 0);
      const pokeWaitMs = Math.max(200, Number.parseInt(pokeWaitRaw, 10) || 1200);
      for (let i = 0; i < pokeCount; i += 1) {
        try {
          await page.waitForResponse((response) => {
            const url = response.url();
            if (!url.includes("graphql")) return false;
            const contentType = response.headers()["content-type"] || "";
            return /json|javascript|text\/plain|text\/html/i.test(contentType);
          }, { timeout: pokeWaitMs });
          break;
        } catch {}
        try {
          await page.evaluate(() => {
            window.scrollBy(0, Math.floor(window.innerHeight * 0.5));
          });
        } catch {}
        await sleep(Math.min(1200, Math.max(0, opts.delayMin || 0)));
      }
    }

    const bodyText = await page.evaluate(() => document.body?.innerText || "");
    if (looksLikeLoginOrBlock(page.url(), bodyText)) {
      throw new Error("Session looks logged out or blocked.");
    }

    const meta = graphqlOnly
      ? { ogTitle: null, ogDescription: null, priceAmount: null, priceCurrency: null }
      : await page.evaluate(() => {
          const get = (prop) =>
            document.querySelector(`meta[property='${prop}']`)?.getAttribute("content") ||
            document.querySelector(`meta[name='${prop}']`)?.getAttribute("content") ||
            null;
          return {
            ogTitle: get("og:title"),
            ogDescription: get("og:description"),
            priceAmount: get("product:price:amount") || get("og:price:amount") || get("product:price") || null,
            priceCurrency: get("product:price:currency") || get("og:price:currency") || null
          };
        });

    if (!graphqlOnly && looksLikeGenericMarketplaceShell(page.url(), meta.ogTitle)) {
      await sleep(1200);
      await gotoWithRetryWithReferer(page, url, 0, 0, opts.refererUrl);
      try {
        await page.waitForLoadState("networkidle", { timeout: 15000 });
      } catch {}
    }

    const derivedTitle = graphqlOnly
      ? sanitizeTitle(cleanText(candidate.title)) || cleanText(candidate.title)
      : sanitizeTitle(cleanOgTitle(meta.ogTitle)) ||
        sanitizeTitle(cleanText(candidate.title)) ||
        cleanText(candidate.title);

    let derivedPriceRaw = graphqlOnly
      ? cleanText(candidate.price_raw)
      : derivePriceRawFromDetail({
          bodyText,
          metaOgDescription: meta.ogDescription,
          fallback: candidate.price_raw
        });

    const details = graphqlOnly
      ? {
          primaryPriceRaw: null,
          aboveFoldTexts: [],
          detailDescription: null,
          detailCondition: null,
          detailLocation: null,
          listedLine: null
        }
      : await extractDetailFieldsFromPage(page, {
          title: derivedTitle,
          price_raw: derivedPriceRaw
        });

    if (!graphqlOnly) {
      // Pass 2: prefer the primary above-the-fold price (most stable), then the header price.
      const primaryPriceRaw = cleanText(details.primaryPriceRaw);
      const headerPriceRaw = inferHeaderPriceRaw(bodyText, details.aboveFoldTexts);
      derivedPriceRaw = primaryPriceRaw || headerPriceRaw || derivedPriceRaw;
    }

    // Meta price is sometimes stale or polluted; only use it if we still don't have any price.
    if (!graphqlOnly && !cleanText(derivedPriceRaw) && meta.priceAmount) {
      const amount = String(meta.priceAmount).replace(/[^\d.]/g, "");
      const num = Number.parseFloat(amount);
      if (Number.isFinite(num) && num > 0) {
        const currency = (meta.priceCurrency || "PHP").toUpperCase();
        if (currency === "PHP") {
          derivedPriceRaw = `PHP${Math.round(num).toLocaleString("en-US")}`;
        }
      }
    }

    if (opts.logEnabled) {
      const src = graphqlOnly
        ? "keep"
        : details.primaryPriceRaw
          ? "above_fold"
          : details.aboveFoldTexts?.length
            ? "header"
            : meta.priceAmount && !cleanText(candidate.price_raw)
              ? "meta"
              : "text";
      opts.log?.(`[INFO] ${label}_price listing_id=${listingId} source=${src} price_raw=${derivedPriceRaw || "n/a"}`);
    }

    // Location can get polluted by "Similar items" blocks; only update it if we can read it from the header area.
    const headerLocationRaw = graphqlOnly
      ? null
      : inferHeaderLocationRaw(bodyText, details.aboveFoldTexts, details.listedLine);
    let derivedLocationRaw = null;
    let locationSrc = "keep";
    if (headerLocationRaw) {
      derivedLocationRaw = headerLocationRaw;
      locationSrc = "header";
    } else if (cleanText(candidate.location_raw)) {
      derivedLocationRaw = cleanText(candidate.location_raw);
      locationSrc = "keep";
    } else if (!graphqlOnly) {
      derivedLocationRaw = deriveLocationFromDetail({
        bodyText,
        detailLocation: details.detailLocation,
        fallback: candidate.location_raw
      });
      locationSrc = cleanText(details.detailLocation) ? "detail" : derivedLocationRaw ? "text" : "none";
    }

    if (opts.logEnabled) {
      opts.log?.(
        `[INFO] ${label}_loc listing_id=${listingId} source=${locationSrc} location_raw=${derivedLocationRaw || "n/a"}`
      );
    }

    const detailDescription = cleanText(details.detailDescription);
    const detailCondition = cleanText(details.detailCondition);
    const fallbackDescription = graphqlOnly ? null : inferDescription(bodyText, derivedTitle, derivedPriceRaw);
    let derivedDescription = graphqlOnly
      ? cleanText(candidate.description)
      : detailDescription || cleanText(fallbackDescription) || cleanText(candidate.description);

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

    let listingStatus = cleanText(candidate.status) || "active";
    if (!graphqlOnly) {
      listingStatus = "active";
      if (looksLikeUnavailableListing(bodyText)) listingStatus = "unavailable";
      else if (looksLikeSoldListing(bodyText)) listingStatus = "sold";
    }

    let networkRow = null;
    let networkSource = "none";
    let embedChecked = 0;
    let embedMatched = 0;
    if (networkCollector) {
      try {
        await networkCollector.flush(2000);
      } catch {}
      const state = networkCollector.getState();
      networkRow = state?.networkListings?.get(String(listingId)) || null;
      if (opts.saveNetworkRaw && opts.networkDump && !opts.networkDump.saved && opts.runId) {
        try {
          const payload = state?.networkPayloads?.length
            ? state.networkPayloads
            : state?.firstParsed
              ? [state.firstParsed]
              : [];
          if (payload.length) {
            const dirPath = path.resolve("logs");
            fs.mkdirSync(dirPath, { recursive: true });
            const target = path.join(dirPath, `monitor-network-${opts.runId}.json`);
            fs.writeFileSync(target, JSON.stringify(payload, null, 2));
            opts.networkDump.saved = true;
            opts.log?.(`[INFO] monitor_network_saved path=${target} items=${payload.length}`);
          }
        } catch {}
      }
      if (opts.logEnabled) {
        opts.log?.(
          `[INFO] monitor_network listing_id=${listingId} found=${networkRow ? "yes" : "no"} ` +
            `network_listings=${state?.networkListings?.size ?? 0} network_candidates=${state?.networkCandidates ?? 0} ` +
            `network_json_responses=${state?.networkJsonResponses ?? 0}`
        );
      }
      if (networkRow) networkSource = "network";

      if (!networkRow) {
        let embeddedChecked = 0;
        let embeddedMatched = 0;
        try {
          const scriptPayloads = await page.evaluate(() => {
            const keywords = [
              "marketplace_listing_title",
              "marketplace_listing_seller",
              "listing_price",
              "groupcommerceproductitem"
            ];
            const matches = [];
            const scripts = Array.from(
              document.querySelectorAll("script[type='application/json'], script[type='application/ld+json']")
            );
            for (const node of scripts) {
              const text = node.textContent || "";
              if (!text) continue;
              const lower = text.toLowerCase();
              if (!keywords.some((k) => lower.includes(k))) continue;
              matches.push(text);
              if (matches.length >= 8) break;
            }
            if (!matches.length) {
              for (const node of scripts) {
                const text = node.textContent || "";
                if (!text) continue;
                matches.push(text);
                if (matches.length >= 2) break;
              }
            }
            return matches;
          });

          for (const payload of scriptPayloads || []) {
            embeddedChecked += 1;
            if (!payload || payload.length > 2_000_000) continue;
            const parsed = parseJsonishPayload(payload);
            if (!parsed) continue;
            const map = collectNetworkListingsFromPayload(parsed);
            const hit = map.get(String(listingId));
            if (hit) {
              networkRow = hit;
              embeddedMatched += 1;
              networkSource = "embed";
              break;
            }
          }
        } catch {}

        if (opts.logEnabled && embeddedChecked) {
          opts.log?.(
            `[INFO] monitor_embed listing_id=${listingId} found=${networkRow ? "yes" : "no"} ` +
              `checked=${embeddedChecked} matched=${embeddedMatched}`
          );
        }
        embedChecked = embeddedChecked;
        embedMatched = embeddedMatched;
      }
      if (networkRow) {
        const netSold = networkRow.listing_is_sold === true;
        const netUnavailable =
          networkRow.listing_is_pending === true ||
          networkRow.listing_is_hidden === true ||
          networkRow.listing_is_live === false;
        if (netSold) listingStatus = "sold";
        else if (netUnavailable && listingStatus === "active") listingStatus = "unavailable";
      }
    }

    const postedAt = inferPostedAtFromBodyText(
      `${details.listedLine || ""}\n${meta.ogDescription || ""}\n${bodyText}`,
      nowIso
    );

    const fallbackLocation = inferLocationCityState(derivedLocationRaw);

    return {
      listing_id: listingId,
      url,
      title: derivedTitle,
      description: derivedDescription,
      condition_raw: detailCondition,
      location_raw: derivedLocationRaw,
      price_raw: derivedPriceRaw,
      price_php: parsePhpPrice(derivedPriceRaw),
      listing_status: listingStatus,
      listing_price_amount: networkRow?.listing_price_amount ?? null,
      listing_price_formatted: networkRow?.listing_price_formatted ?? null,
      listing_strikethrough_price: networkRow?.listing_strikethrough_price ?? null,
      listing_is_live: networkRow?.listing_is_live ?? null,
      listing_is_sold: networkRow?.listing_is_sold ?? null,
      listing_is_pending: networkRow?.listing_is_pending ?? null,
      listing_is_hidden: networkRow?.listing_is_hidden ?? null,
      listing_seller_id: networkRow?.listing_seller_id ?? null,
      listing_location_city: networkRow?.listing_location_city ?? fallbackLocation.city ?? null,
      listing_location_state: networkRow?.listing_location_state ?? fallbackLocation.state ?? null,
      posted_at: postedAt,
      scraped_at: nowIso,
      run_id: opts.runId,
      _monitor_network_source: networkSource,
      _monitor_embed_checked: embedChecked,
      _monitor_embed_matched: embedMatched
    };
  } catch (error) {
    const title = await safePageTitle(page);
    const msg = error instanceof Error ? error.message : String(error);
    opts.log?.(`[WARN] monitor_failed listing_id=${listingId} error=${msg.slice(0, 160)} title=${title}`);
    return null;
  } finally {
    networkCollector?.dispose?.();
  }
}

async function recheckParallel(context, candidates, opts) {
  const concurrency = Math.max(1, Math.min(opts.concurrency || 1, 6, candidates.length || 1));
  const pages = [];
    for (let i = 0; i < concurrency; i += 1) {
      const page = await context.newPage();
      if (opts.useNetwork) {
        try {
          await page.setCacheEnabled(false);
        } catch {}
      }
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
  useNetwork = false,
  saveNetworkRaw = false,
  progressBase = 0,
  progressTotal = null
}) {
  const networkDump = { saved: false };
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
    useNetwork,
    saveNetworkRaw,
    networkDump,
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
