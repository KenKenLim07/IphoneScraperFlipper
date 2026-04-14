import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import {
  cleanOgTitle,
  deriveDescriptionFromDetail,
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
  envInt,
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

function formatGraphqlPriceRaw({ formatted, amount }) {
  const formattedClean = cleanText(formatted);
  if (formattedClean) return formattedClean;
  const parsed =
    typeof amount === "number"
      ? amount
      : Number.parseFloat(String(amount || "").replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return `PHP${Math.round(parsed).toLocaleString("en-US")}`;
}

function hoursSince(value) {
  if (!value) return null;
  const ms = new Date(String(value)).getTime();
  if (!Number.isFinite(ms)) return null;
  return (Date.now() - ms) / (1000 * 60 * 60);
}

function shouldRefreshDescription(candidate, refreshHours) {
  if (!cleanText(candidate?.description)) return true;
  if (!Number.isFinite(refreshHours) || refreshHours <= 0) return true;
  const hrs = hoursSince(candidate?.last_seen_at);
  if (!Number.isFinite(hrs)) return true;
  return hrs >= refreshHours;
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
  const preferGraphqlPrice = envBool("PLAYWRIGHT_PREFER_GRAPHQL_PRICE_RAW", false);
  const label = cleanText(opts.label) || "monitor";
  const isMonitor = label === "monitor";
  const enrichOnly = label === "enrich";
  const embedFallbackEnabled = envBool("PLAYWRIGHT_MONITOR_EMBED_FALLBACK", true);
  const useDomStatus = !graphqlOnly && envBool("PLAYWRIGHT_MONITOR_STATUS_FALLBACK", true);
  let domMode = isMonitor
    ? cleanText(process.env.PLAYWRIGHT_MONITOR_DOM_MODE)?.toLowerCase() || "full"
    : "full";
  if (enrichOnly) domMode = "full";
  if (!["off", "desc", "embed", "full"].includes(domMode)) domMode = "full";
  const descRefreshHours = envInt("PLAYWRIGHT_MONITOR_DESC_REFRESH_HOURS", 24);
  const refreshDescription = !isMonitor
    ? true
    : domMode === "full"
      ? true
      : domMode === "desc"
        ? shouldRefreshDescription(candidate, descRefreshHours)
        : false;
  const useDomFull = !graphqlOnly && domMode === "full";
  const useDomForDesc = !graphqlOnly && refreshDescription;
  const useDomEmbed = !graphqlOnly && domMode === "embed";
  const useDom = useDomFull || useDomForDesc || useDomEmbed;
  const useDomText = useDomFull || useDomForDesc || useDomStatus;

  const networkCollector =
    opts.useNetwork && opts.runId
      ? installNetworkListingCollector(page, { log: opts.log, saveNetworkRaw: opts.saveNetworkRaw, runId: opts.runId })
      : null;

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
      if (useDomFull || useDomForDesc) {
        try {
          await page.waitForSelector("meta[property='og:title']", { timeout: 6000 });
        } catch {}
      }
    }

    if (useDomForDesc) {
      try {
        await page.evaluate(() => {
          const nodes = Array.from(document.querySelectorAll("button, a, div[role='button'], span[role='button']"));
          for (const el of nodes) {
            const text = (el.textContent || "").trim().toLowerCase();
            if (text === "see more" || text.includes("see more")) {
              el.click();
            }
          }
        });
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

    let bodyText = useDomText
      ? await page.evaluate(() => document.body?.innerText || "")
      : "";
    if (useDomText && looksLikeLoginOrBlock(page.url(), bodyText)) {
      if (opts.abortRef) opts.abortRef.blocked = true;
      throw new Error("SESSION_BLOCKED");
    }

    const meta =
      graphqlOnly || !(useDomFull || useDomForDesc)
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

    if ((useDomFull || useDomForDesc) && !graphqlOnly && looksLikeGenericMarketplaceShell(page.url(), meta.ogTitle)) {
      await sleep(1200);
      await gotoWithRetryWithReferer(page, url, 0, 0, opts.refererUrl);
      try {
        await page.waitForLoadState("networkidle", { timeout: 15000 });
      } catch {}
    }

    let derivedTitle =
      graphqlOnly || !(useDomFull || useDomForDesc)
        ? sanitizeTitle(cleanText(candidate.title)) || cleanText(candidate.title)
        : sanitizeTitle(cleanOgTitle(meta.ogTitle)) ||
          sanitizeTitle(cleanText(candidate.title)) ||
          cleanText(candidate.title);

    let derivedPriceRaw =
      graphqlOnly || !useDomFull
        ? cleanText(candidate.price_raw)
        : enrichOnly
          ? cleanText(candidate.price_raw)
          : derivePriceRawFromDetail({
              bodyText,
              metaOgDescription: meta.ogDescription,
              fallback: candidate.price_raw
            });

    const details =
      graphqlOnly || !(useDomFull || useDomForDesc)
        ? {
            primaryPriceRaw: null,
            aboveFoldTexts: [],
            detailDescription: null,
            detailCondition: null,
            detailLocation: null,
            listedLine: null,
            allTexts: []
          }
        : await extractDetailFieldsFromPage(page, {
            title: derivedTitle,
            price_raw: derivedPriceRaw
          });
    if (useDomText && !cleanText(bodyText) && Array.isArray(details.allTexts) && details.allTexts.length) {
      bodyText = details.allTexts.join("\n");
    }
    const statusText = useDomStatus
      ? cleanText(bodyText) || cleanText(meta.ogDescription) || ""
      : "";
    const statusDebug = envBool("SCRAPE_DEBUG_STATUS_TEXT", false) ? {} : null;
    const isUnavailableText = useDomStatus && looksLikeUnavailableListing(statusText, statusDebug);
    const isSoldText = useDomStatus && looksLikeSoldListing(statusText, statusDebug);
    if (useDomStatus && envBool("SCRAPE_DEBUG_STATUS_TEXT", false)) {
      const snippet = cleanText(statusText)?.slice(0, 200) || "n/a";
      opts.log?.(
        `[INFO] monitor_status_check listing_id=${listingId} unavailable=${isUnavailableText} sold=${isSoldText} ` +
          `match="${statusDebug?.match || "n/a"}" snippet="${snippet}"`
      );
    }

    if (useDomFull && !enrichOnly) {
      // Pass 2: prefer the primary above-the-fold price (most stable), then the header price.
      const primaryPriceRaw = cleanText(details.primaryPriceRaw);
      const headerPriceRaw = inferHeaderPriceRaw(bodyText, details.aboveFoldTexts);
      derivedPriceRaw = primaryPriceRaw || headerPriceRaw || derivedPriceRaw;
    }

    // Meta price is sometimes stale or polluted; only use it if we still don't have any price.
    if (useDomFull && !enrichOnly && !cleanText(derivedPriceRaw) && meta.priceAmount) {
      const amount = String(meta.priceAmount).replace(/[^\d.]/g, "");
      const num = Number.parseFloat(amount);
      if (Number.isFinite(num) && num > 0) {
        const currency = (meta.priceCurrency || "PHP").toUpperCase();
        if (currency === "PHP") {
          derivedPriceRaw = `PHP${Math.round(num).toLocaleString("en-US")}`;
        }
      }
    }

    let priceSourceBase =
      graphqlOnly || !useDomFull
        ? "keep"
        : enrichOnly
          ? "keep"
          : details.primaryPriceRaw
            ? "above_fold"
            : details.aboveFoldTexts?.length
              ? "header"
              : meta.priceAmount && !cleanText(candidate.price_raw)
                ? "meta"
                : "text";

    // Location can get polluted by "Similar items" blocks; only update it if we can read it from the header area.
    const headerLocationRaw =
      useDomFull && !enrichOnly
        ? inferHeaderLocationRaw(bodyText, details.aboveFoldTexts, details.listedLine)
        : null;
    let derivedLocationRaw = cleanText(candidate.location_raw);
    let locationSrc = derivedLocationRaw ? "keep" : "none";
    if (useDomFull && !enrichOnly) {
      if (headerLocationRaw) {
        derivedLocationRaw = headerLocationRaw;
        locationSrc = "header";
      } else if (cleanText(candidate.location_raw)) {
        derivedLocationRaw = cleanText(candidate.location_raw);
        locationSrc = "keep";
      } else {
        derivedLocationRaw = deriveLocationFromDetail({
          bodyText,
          detailLocation: details.detailLocation,
          fallback: candidate.location_raw
        });
        locationSrc = cleanText(details.detailLocation) ? "detail" : derivedLocationRaw ? "text" : "none";
      }
    }

    if (opts.logEnabled) {
      opts.log?.(
        `[INFO] ${label}_loc listing_id=${listingId} source=${locationSrc} location_raw=${derivedLocationRaw || "n/a"}`
      );
    }

    let embeddedDescription = null;
    if (useDomForDesc) {
      try {
        const scriptPayloads = await page.evaluate(() => {
          const keywords = [
            "marketplace_listing_description",
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
          if (!payload || payload.length > 2_000_000) continue;
          const parsed = parseJsonishPayload(payload);
          if (!parsed) continue;
          const map = collectNetworkListingsFromPayload(parsed);
          const hit = map.get(String(listingId));
          const desc = cleanText(hit?.description);
          if (desc) {
            embeddedDescription = desc;
            break;
          }
        }
      } catch {}
    }

    const detailDescription = useDomForDesc
      ? cleanText(details.detailDescription) || cleanText(embeddedDescription)
      : null;
    const detailCondition = useDomFull ? cleanText(details.detailCondition) : null;
    const derivedDescription = useDomForDesc
      ? deriveDescriptionFromDetail({
          bodyText: statusText,
          metaOgDescription: meta.ogDescription,
          title: derivedTitle,
          priceRaw: derivedPriceRaw,
          detailDescription
        }) || cleanText(candidate.description)
      : cleanText(candidate.description);

    // Guard: when Facebook redirects to a generic Marketplace shell, we sometimes pick up header chrome text.
    let safeDescription = derivedDescription;
    if (safeDescription && /find friends\s*\|\s*marketplace(\s*\|\s*browse all)?/i.test(safeDescription)) {
      safeDescription = cleanText(candidate.description);
    }

    const descSource = !useDomForDesc
      ? "keep"
      : cleanText(embeddedDescription)
        ? "embed"
        : cleanText(details.detailDescription)
          ? "detail"
          : cleanText(meta.ogDescription)
            ? "meta"
            : safeDescription
              ? "fallback"
              : "none";
    if (opts.logEnabled) {
      const preview = cleanText(safeDescription)?.slice(0, 80) || "n/a";
      opts.log?.(
        `[INFO] ${label}_desc listing_id=${listingId} source=${descSource} desc_len=${(safeDescription || "").length} ` +
          `desc_preview="${preview}"`
      );
    }
    if (opts.logEnabled) {
      const debugRaw = String(process.env.SCRAPE_DEBUG_DESC || "").trim().toLowerCase();
      let debugMode = debugRaw;
      if (!debugMode) {
        if (envBool("SCRAPE_DEBUG_DESC_ALL", false)) debugMode = "full";
        else if (envBool("SCRAPE_DEBUG_DESC", false)) debugMode = "min";
      }
      if (debugMode && debugMode !== "off") {
        const isMissing = !cleanText(safeDescription);
        const full = debugMode === "full";
        if (full || isMissing) {
          const preview = (value) => cleanText(value)?.slice(0, 80) || "n/a";
          const winner =
            descSource === "embed"
              ? embeddedDescription
              : descSource === "detail"
                ? details.detailDescription
                : descSource === "meta"
                  ? meta.ogDescription
                  : descSource === "fallback"
                    ? derivedDescription
                    : null;
          if (full) {
            opts.log?.(
              `[DEBUG] ${label}_desc_detail listing_id=${listingId} ` +
                `detail_desc="${preview(details.detailDescription)}" embed_desc="${preview(embeddedDescription)}" ` +
                `meta_og="${preview(meta.ogDescription)}" fallback_desc="${preview(derivedDescription)}" ` +
                `cond_raw="${preview(detailCondition)}" listed_line="${preview(details.listedLine)}"`
            );
          } else {
            opts.log?.(
              `[DEBUG] ${label}_desc_detail listing_id=${listingId} desc_src=${descSource} ` +
                `desc="${preview(winner)}" cond_raw="${preview(detailCondition)}" listed_line="${preview(details.listedLine)}"`
            );
          }
        }
      }
    }

    let listingStatus = cleanText(candidate.status) || "active";
    let statusSource = "keep";
    if (useDomStatus) {
      listingStatus = "active";
      if (isUnavailableText) listingStatus = "unavailable";
      else if (isSoldText) listingStatus = "sold";
      statusSource = "dom";
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
      const debugNetworkKeys = envBool("SCRAPE_DEBUG_NETWORK_KEYS", false);
      if (debugNetworkKeys && !networkRow) {
        const payload = state?.firstParsed?.data || null;
        const dataRoot =
          payload && typeof payload === "object"
            ? payload.data && typeof payload.data === "object"
              ? payload.data
              : payload
            : null;
        const keys = dataRoot && typeof dataRoot === "object" ? Object.keys(dataRoot).slice(0, 8) : [];
        const errors = Array.isArray(payload?.errors) ? payload.errors.length : 0;
        if (keys.length || errors) {
          opts.log?.(
            `[INFO] monitor_network_keys listing_id=${listingId} keys=${keys.join("|") || "n/a"} ` +
              `errors=${errors}`
          );
        }
      }
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
        if (useDom) {
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
              if (envBool("SCRAPE_DEBUG_EMBED_KEYS", false) && !opts.embedKeysLogged) {
                const keys = Object.keys(hit || {}).slice(0, 20);
                const hasDesc = cleanText(hit?.description) ? "yes" : "no";
                opts.embedKeysLogged = true;
                opts.log?.(
                  `[INFO] monitor_embed_keys listing_id=${listingId} keys=${keys.join("|") || "n/a"} desc=${hasDesc}`
                );
              }
              break;
            }
            }
          } catch {}
        }

        if (opts.logEnabled && embeddedChecked) {
          opts.log?.(
            `[INFO] monitor_embed listing_id=${listingId} found=${networkRow ? "yes" : "no"} ` +
              `checked=${embeddedChecked} matched=${embeddedMatched}`
          );
        }
        embedChecked = embeddedChecked;
        embedMatched = embeddedMatched;
      }
      if (networkRow && networkSource === "embed" && envBool("SCRAPE_DEBUG_EMBED_FIELDS", false)) {
        const fields = [];
        const push = (value) => {
          if (value) fields.push(value);
        };
        if (cleanText(networkRow.title)) push("title");
        if (cleanText(networkRow.description)) push("description");
        if (cleanText(networkRow.price_raw)) push("price_raw");
        if (networkRow.price_php != null) push("price_php");
        if (networkRow.listing_price_amount != null) push("listing_price_amount");
        if (cleanText(networkRow.listing_price_formatted)) push("listing_price_formatted");
        if (cleanText(networkRow.listing_strikethrough_price)) push("listing_strikethrough_price");
        if (typeof networkRow.listing_is_live === "boolean") push(`listing_is_live=${networkRow.listing_is_live}`);
        if (typeof networkRow.listing_is_sold === "boolean") push(`listing_is_sold=${networkRow.listing_is_sold}`);
        if (typeof networkRow.listing_is_pending === "boolean") push(`listing_is_pending=${networkRow.listing_is_pending}`);
        if (typeof networkRow.listing_is_hidden === "boolean") push(`listing_is_hidden=${networkRow.listing_is_hidden}`);
        if (cleanText(networkRow.listing_seller_id)) push("listing_seller_id");
        if (cleanText(networkRow.listing_location_city)) push("listing_location_city");
        if (cleanText(networkRow.listing_location_state)) push("listing_location_state");
        if (cleanText(networkRow.location_raw)) push("location_raw");
        if (cleanText(networkRow.listing_status)) push("listing_status");
        opts.log?.(
          `[INFO] monitor_embed_fields listing_id=${listingId} fields=${fields.join("|") || "n/a"}`
        );
      }
      if (networkRow && networkSource === "embed" && envBool("SCRAPE_DEBUG_EMBED_SAMPLE", false)) {
        const preview = (value, max = 80) => cleanText(value)?.slice(0, max) || "n/a";
        opts.log?.(
          `[INFO] monitor_embed_sample listing_id=${listingId} ` +
            `title="${preview(networkRow.title, 60)}" price_raw="${preview(networkRow.price_raw, 32)}" ` +
            `price_fmt="${preview(networkRow.listing_price_formatted, 32)}" price_amt=${networkRow.listing_price_amount ?? "n/a"} ` +
            `sold=${networkRow.listing_is_sold ?? "n/a"} pending=${networkRow.listing_is_pending ?? "n/a"} ` +
            `hidden=${networkRow.listing_is_hidden ?? "n/a"} live=${networkRow.listing_is_live ?? "n/a"} ` +
            `loc_city="${preview(networkRow.listing_location_city, 40)}" loc_state="${preview(networkRow.listing_location_state, 20)}" ` +
            `desc_len=${cleanText(networkRow.description)?.length || 0}`
        );
      }
      if (networkRow) {
        const beforeStatus = listingStatus;
        const netSold = networkRow.listing_is_sold === true;
        const netUnavailable =
          networkRow.listing_is_pending === true ||
          networkRow.listing_is_hidden === true ||
          networkRow.listing_is_live === false;
        if (netSold) listingStatus = "sold";
        else if (netUnavailable && listingStatus === "active") listingStatus = "unavailable";
        if (listingStatus !== beforeStatus) statusSource = "network";
      }
    }
    if (opts.logEnabled && envBool("SCRAPE_DEBUG_STATUS", false)) {
      opts.log?.(
        `[INFO] ${label}_status listing_id=${listingId} source=${statusSource} status=${listingStatus}`
      );
    }

    if (!networkRow && embedFallbackEnabled && (useDomFull || useDomForDesc)) {
      if (isUnavailableText) {
        derivedPriceRaw = cleanText(candidate.price_raw);
        priceSourceBase = "keep";
      } else {
      let fallbackPriceRaw = derivePriceRawFromDetail({
        bodyText: statusText,
        metaOgDescription: meta.ogDescription,
        fallback: candidate.price_raw
      });
      const primaryPriceRaw = cleanText(details.primaryPriceRaw);
      const headerPriceRaw = inferHeaderPriceRaw(bodyText, details.aboveFoldTexts);
      fallbackPriceRaw = primaryPriceRaw || headerPriceRaw || fallbackPriceRaw;
      if (!cleanText(fallbackPriceRaw) && meta.priceAmount) {
        const amount = String(meta.priceAmount).replace(/[^\d.]/g, "");
        const num = Number.parseFloat(amount);
        if (Number.isFinite(num) && num > 0) {
          const currency = (meta.priceCurrency || "PHP").toUpperCase();
          if (currency === "PHP") {
            fallbackPriceRaw = `PHP${Math.round(num).toLocaleString("en-US")}`;
          }
        }
      }
      if (cleanText(fallbackPriceRaw)) {
        derivedPriceRaw = fallbackPriceRaw;
        priceSourceBase = "fallback";
      }
      }
    }

    const candidateGraphqlPriceRaw = preferGraphqlPrice
      ? formatGraphqlPriceRaw({
          formatted: candidate?.listing_price_formatted,
          amount: candidate?.listing_price_amount
        })
      : null;
    const networkGraphqlPriceRaw = preferGraphqlPrice
      ? formatGraphqlPriceRaw({
          formatted: networkRow?.listing_price_formatted,
          amount: networkRow?.listing_price_amount
        })
      : null;
    const graphqlPriceRaw = networkGraphqlPriceRaw || candidateGraphqlPriceRaw;
    const finalPriceRaw = graphqlPriceRaw || derivedPriceRaw;
    const finalPricePhp = parsePhpPrice(finalPriceRaw);
    const priceSource = graphqlPriceRaw ? "graphql" : priceSourceBase;

    if (opts.logEnabled) {
      opts.log?.(
        `[INFO] ${label}_price listing_id=${listingId} source=${priceSource} price_raw=${finalPriceRaw || "n/a"}`
      );
    }

    if (networkRow && cleanText(networkRow.title)) {
      derivedTitle = sanitizeTitle(cleanText(networkRow.title)) || cleanText(networkRow.title);
    }

    const postedAt = useDomFull
      ? inferPostedAtFromBodyText(
          `${details.listedLine || ""}\n${meta.ogDescription || ""}\n${bodyText}`,
          nowIso
        )
      : null;

    const fallbackLocation = inferLocationCityState(derivedLocationRaw);

    return {
      listing_id: listingId,
      url,
      title: derivedTitle,
      description: safeDescription,
      condition_raw: detailCondition,
      location_raw: derivedLocationRaw,
      price_raw: finalPriceRaw,
      price_php: finalPricePhp,
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
    if (msg.includes("SESSION_BLOCKED") && opts.abortRef) {
      opts.abortRef.blocked = true;
    }
    opts.log?.(`[WARN] monitor_failed listing_id=${listingId} error=${msg.slice(0, 160)} title=${title}`);
    return null;
  } finally {
    networkCollector?.dispose?.();
  }
}

async function recheckParallel(context, candidates, opts) {
  const concurrency = Math.max(1, Math.min(opts.concurrency || 1, 6, candidates.length || 1));
  const abortRef = opts.abortRef || { blocked: false };
  opts.abortRef = abortRef;
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
      if (abortRef.blocked) return;
      const myIndex = cursor;
      cursor += 1;
      if (myIndex >= total) return;
      const candidate = candidates[myIndex];
      const row = await recheckOne(page, candidate, opts, myIndex + 1, total);
      if (row) out.push(row);
      if (abortRef.blocked) return;
    }
  }

  try {
    await Promise.all(pages.map((p) => worker(p)));
  } finally {
    await Promise.all(pages.map((p) => p.close().catch(() => {})));
  }

  if (abortRef.blocked) throw new Error("SESSION_BLOCKED");
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
