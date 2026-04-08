import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { cleanText, envBool, envInt, isWeakDescription, normalizeLocationRaw, parsePhpPrice } from "./utils.mjs";

function createSupabaseClient() {
  const url = cleanText(process.env.SUPABASE_URL);
  const key = cleanText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function withRetry(fn, { retries, baseDelayMs, log, label }) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      if (attempt < retries) {
        const wait = baseDelayMs * Math.pow(2, attempt);
        if (log) log(`[WARN] retry label=${label} attempt=${attempt + 1}/${retries + 1} wait_ms=${wait} error=${msg}`);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastError;
}

function toNumber(value) {
  if (value == null) return null;
  const n = Number.parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function boolOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function inferLocationCityStateFromRaw(locationRaw) {
  const cleaned = cleanText(locationRaw);
  if (!cleaned) return { city: null, state: null };
  const match = cleaned.match(/^(.+?),\s*(PH-\d{2})$/i);
  if (match) return { city: cleanText(match[1]), state: cleanText(match[2]) };
  const parts = cleaned
    .split(",")
    .map((part) => cleanText(part))
    .filter(Boolean);
  if (parts.length >= 2) return { city: parts[0], state: null };
  return { city: null, state: null };
}

function buildDiscoveryNetworkUpdate(row, nowIso) {
  const listingId = cleanText(row?.listing_id);
  if (!listingId) return null;
  const url = cleanText(row?.url);
  if (!url) return null;

  const payload = { listing_id: listingId, url };
  let hasField = false;

  const priceAmount = toNumber(row.listing_price_amount);
  if (priceAmount != null) {
    payload.listing_price_amount = priceAmount;
    hasField = true;
  }


  const priceFormatted = cleanText(row.listing_price_formatted);
  if (priceFormatted) {
    payload.listing_price_formatted = priceFormatted;
    hasField = true;
  }

  const strike = cleanText(row.listing_strikethrough_price);
  if (strike) {
    payload.listing_strikethrough_price = strike;
    hasField = true;
  }

  const isLive = boolOrNull(row.listing_is_live);
  if (isLive != null) {
    payload.listing_is_live = isLive;
    hasField = true;
  }

  const isSold = boolOrNull(row.listing_is_sold);
  if (isSold != null) {
    payload.listing_is_sold = isSold;
    hasField = true;
  }

  const isPending = boolOrNull(row.listing_is_pending);
  if (isPending != null) {
    payload.listing_is_pending = isPending;
    hasField = true;
  }

  const isHidden = boolOrNull(row.listing_is_hidden);
  if (isHidden != null) {
    payload.listing_is_hidden = isHidden;
    hasField = true;
  }

  const sellerId = cleanText(row.listing_seller_id);
  if (sellerId) {
    payload.listing_seller_id = sellerId;
    hasField = true;
  }

  const locationCity = cleanText(row.listing_location_city);
  if (locationCity) {
    payload.listing_location_city = locationCity;
    hasField = true;
  }

  const locationState = cleanText(row.listing_location_state);
  if (locationState) {
    payload.listing_location_state = locationState;
    hasField = true;
  }

  if (!hasField) return null;
  payload.updated_at = nowIso;
  return payload;
}

export function savePendingRows({ runId, phase, rows, error, log }) {
  const logsDir = path.resolve("logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const target = path.join(logsDir, `pending-${phase}-${runId}.json`);
  const payload = {
    run_id: runId,
    phase,
    error: error instanceof Error ? error.message : String(error),
    rows
  };
  fs.writeFileSync(target, JSON.stringify(payload, null, 2));
  if (log) log(`[WARN] pending_saved phase=${phase} path=${target} rows=${rows.length}`);
  return target;
}

export async function persistToDatabase(rows, { log } = {}) {
  if (!rows.length) {
    return { inserted: 0, updated: 0, unchanged: 0, existing: 0, versionsInserted: 0 };
  }

  const retries = envInt("DB_RETRY_COUNT", 3);
  const baseDelayMs = envInt("DB_RETRY_BASE_MS", 1500);
  const captureChanges = envBool("DB_LOG_CHANGES", false);
  const changeLimit = Math.max(0, envInt("DB_LOG_CHANGE_LIMIT", 25));

  const supabase = createSupabaseClient();
  const listingIds = rows.map((r) => String(r.listing_id));
  const nowIso = new Date().toISOString();

  const existingRes = await withRetry(
    () =>
      supabase
        .from("listings")
        .select(
          "id,listing_id,title,description,condition_raw,location_raw,price_raw,price_php,status,posted_at,first_seen_at,last_seen_at,last_price_change_at,listing_price_amount,listing_price_formatted,listing_strikethrough_price,listing_is_live,listing_is_sold,listing_is_pending,listing_is_hidden,listing_seller_id,listing_location_city,listing_location_state"
        )
        .in("listing_id", listingIds),
    { retries, baseDelayMs, log, label: "db_existing_select" }
  );
  if (existingRes.error) {
    throw new Error(`DB existing listings fetch failed: ${existingRes.error.message}`);
  }
  const existingByListingId = new Map();
  for (const row of existingRes.data || []) {
    existingByListingId.set(String(row.listing_id), row);
  }

  const upserts = [];
  const versions = [];
  const changeSamples = [];
  const changedFieldCounts = Object.create(null);
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const row of rows) {
    const listingId = String(row.listing_id);
    const existing = existingByListingId.get(listingId) || null;
    const changedFields = [];

    const nextTitle = row.title;
    let nextDescription = row.description;
    let nextConditionRaw = cleanText(row.condition_raw);
    let nextLocationRaw = normalizeLocationRaw(row.location_raw);
    let nextPriceRaw = row.price_raw;
    let nextPricePhp = row.price_php;
    const incomingPriceAmount = toNumber(row.listing_price_amount);
    const incomingPriceFormatted = cleanText(row.listing_price_formatted);
    const incomingStrike = cleanText(row.listing_strikethrough_price);
    const incomingIsLive = typeof row.listing_is_live === "boolean" ? row.listing_is_live : null;
    const incomingIsSold = typeof row.listing_is_sold === "boolean" ? row.listing_is_sold : null;
    const incomingIsPending = typeof row.listing_is_pending === "boolean" ? row.listing_is_pending : null;
    const incomingIsHidden = typeof row.listing_is_hidden === "boolean" ? row.listing_is_hidden : null;
    const incomingSellerId = cleanText(row.listing_seller_id);
    const incomingLocationCity = cleanText(row.listing_location_city);
    const incomingLocationState = cleanText(row.listing_location_state);

    let nextListingPriceAmount = incomingPriceAmount;
    let nextListingPriceFormatted = incomingPriceFormatted;
    let nextListingStrike = incomingStrike;
    let nextListingIsLive = incomingIsLive;
    let nextListingIsSold = incomingIsSold;
    let nextListingIsPending = incomingIsPending;
    let nextListingIsHidden = incomingIsHidden;
    let nextListingSellerId = incomingSellerId;
    let nextListingLocationCity = incomingLocationCity;
    let nextListingLocationState = incomingLocationState;

    if (!cleanText(nextPriceRaw) && incomingPriceFormatted) {
      nextPriceRaw = incomingPriceFormatted;
    }
    if (incomingPriceAmount != null) {
      nextPricePhp = incomingPriceAmount;
    } else if ((nextPricePhp == null || !Number.isFinite(nextPricePhp)) && incomingPriceFormatted) {
      nextPricePhp = parsePhpPrice(incomingPriceFormatted);
    }

    if (existing) {
      if (isWeakDescription(nextDescription) && !isWeakDescription(existing.description)) {
        nextDescription = existing.description;
      }
      if (!cleanText(nextConditionRaw) && cleanText(existing.condition_raw)) {
        nextConditionRaw = cleanText(existing.condition_raw);
      }
      const prevLocation = normalizeLocationRaw(existing.location_raw);
      if (!cleanText(nextLocationRaw) && cleanText(prevLocation)) {
        nextLocationRaw = prevLocation;
      }
      if (nextListingPriceAmount == null && existing.listing_price_amount != null) {
        nextListingPriceAmount = existing.listing_price_amount;
      }
      if (!cleanText(nextListingPriceFormatted) && cleanText(existing.listing_price_formatted)) {
        nextListingPriceFormatted = cleanText(existing.listing_price_formatted);
      }
      if (!cleanText(nextListingStrike) && cleanText(existing.listing_strikethrough_price)) {
        nextListingStrike = cleanText(existing.listing_strikethrough_price);
      }
      if (nextListingIsLive == null && typeof existing.listing_is_live === "boolean") {
        nextListingIsLive = existing.listing_is_live;
      }
      if (nextListingIsSold == null && typeof existing.listing_is_sold === "boolean") {
        nextListingIsSold = existing.listing_is_sold;
      }
      if (nextListingIsPending == null && typeof existing.listing_is_pending === "boolean") {
        nextListingIsPending = existing.listing_is_pending;
      }
      if (nextListingIsHidden == null && typeof existing.listing_is_hidden === "boolean") {
        nextListingIsHidden = existing.listing_is_hidden;
      }
      if (!cleanText(nextListingSellerId) && cleanText(existing.listing_seller_id)) {
        nextListingSellerId = cleanText(existing.listing_seller_id);
      }
      if (!cleanText(nextListingLocationCity) && cleanText(existing.listing_location_city)) {
        nextListingLocationCity = cleanText(existing.listing_location_city);
      }
    if (!cleanText(nextListingLocationState) && cleanText(existing.listing_location_state)) {
      nextListingLocationState = cleanText(existing.listing_location_state);
    }
      if ((nextPricePhp == null || !Number.isFinite(nextPricePhp)) && existing.price_php != null) {
        nextPricePhp = existing.price_php;
        if (!cleanText(nextPriceRaw) && cleanText(existing.price_raw)) {
          nextPriceRaw = existing.price_raw;
        }
      }
    }

    const fallbackLocation = inferLocationCityStateFromRaw(nextLocationRaw);
    if (!cleanText(nextListingLocationCity) && cleanText(fallbackLocation.city)) {
      nextListingLocationCity = fallbackLocation.city;
    }
    if (!cleanText(nextListingLocationState) && cleanText(fallbackLocation.state)) {
      nextListingLocationState = fallbackLocation.state;
    }

    const payload = {
      listing_id: listingId,
      url: row.url,
      title: nextTitle,
      description: nextDescription,
      condition_raw: nextConditionRaw,
      location_raw: nextLocationRaw,
      price_raw: nextPriceRaw,
      price_php: nextPricePhp,
      listing_price_amount: nextListingPriceAmount,
      listing_price_formatted: nextListingPriceFormatted,
      listing_strikethrough_price: nextListingStrike,
      listing_is_live: nextListingIsLive,
      listing_is_sold: nextListingIsSold,
      listing_is_pending: nextListingIsPending,
      listing_is_hidden: nextListingIsHidden,
      listing_seller_id: nextListingSellerId,
      listing_location_city: nextListingLocationCity,
      listing_location_state: nextListingLocationState,
      status: row.listing_status || "active",
      posted_at: existing?.posted_at || row.posted_at || null,
      updated_at: nowIso,
      last_seen_at: row.scraped_at || nowIso
    };

    if (!existing) {
      payload.first_seen_at = row.scraped_at || nowIso;
      changedFields.push("new_listing");
      inserted += 1;
    } else {
      payload.first_seen_at = existing.first_seen_at || existing.last_seen_at || nowIso;

      if ((nextTitle || null) !== (existing.title || null)) changedFields.push("title");
      if ((nextDescription || null) !== (existing.description || null)) changedFields.push("description");

      const prevPrice = existing.price_php;
      const currPrice = nextPricePhp;
      if ((currPrice ?? null) !== (prevPrice ?? null)) {
        changedFields.push("price_php");
        payload.last_price_change_at = nowIso;
      } else {
        payload.last_price_change_at = existing.last_price_change_at || null;
      }

      if ((row.listing_status || "active") !== (existing.status || "active")) {
        changedFields.push("status");
      }

      if (changedFields.length) {
        updated += 1;
        for (const f of changedFields) changedFieldCounts[f] = (changedFieldCounts[f] || 0) + 1;
        if (captureChanges && changeSamples.length < changeLimit) {
          changeSamples.push({
            listing_id: listingId,
            changed_fields: changedFields,
            prev: {
              title: existing.title || null,
              price_php: existing.price_php ?? null,
              status: existing.status || null,
              description_len: cleanText(existing.description)?.length || 0
            },
            next: {
              title: nextTitle || null,
              price_php: nextPricePhp ?? null,
              status: row.listing_status || "active",
              description_len: cleanText(nextDescription)?.length || 0
            }
          });
        }
      } else {
        unchanged += 1;
      }
    }

    upserts.push(payload);

    if (changedFields.length) {
      versions.push({
        listing_id_key: listingId,
        snapshot_at: nowIso,
        price_raw: nextPriceRaw,
        price_php: nextPricePhp,
        status: row.listing_status || "active",
        title: nextTitle,
        description: nextDescription,
        posted_at: existing?.posted_at || row.posted_at || null,
        changed_fields: changedFields
      });
    }
  }

  let versionsInserted = 0;
  const upsertRes = await withRetry(
    () => supabase.from("listings").upsert(upserts, { onConflict: "listing_id" }).select("id,listing_id"),
    { retries, baseDelayMs, log, label: "db_listings_upsert" }
  );
  if (upsertRes.error) {
    const msg = String(upsertRes.error.message || "");
    if (/column .*condition_raw.* does not exist/i.test(msg)) {
      throw new Error(
        `DB listings upsert failed: ${msg} (hint: run scraper/sql/add_condition_raw.sql in Supabase)`
      );
    }
    throw new Error(`DB listings upsert failed: ${msg}`);
  }

  if (versions.length && upsertRes.data) {
    const idByListingId = new Map();
    for (const row of upsertRes.data) {
      idByListingId.set(String(row.listing_id), Number(row.id));
    }
    const versionsWithFk = versions
      .map((v) => {
        const numericId = idByListingId.get(String(v.listing_id_key));
        if (!numericId) return null;
        const { listing_id_key, ...payload } = v;
        return { ...payload, listing_id: numericId };
      })
      .filter(Boolean);

    if (versionsWithFk.length) {
      const versionsRes = await withRetry(
        () => supabase.from("listing_versions").insert(versionsWithFk),
        { retries, baseDelayMs, log, label: "db_versions_insert" }
      );
      if (versionsRes.error) {
        throw new Error(`DB listing_versions insert failed: ${versionsRes.error.message}`);
      }
      versionsInserted = versionsWithFk.length;
    }
  }

  const existing = updated + unchanged;
  return { inserted, updated, unchanged, existing, versionsInserted, changedFieldCounts, changeSamples };
}

function dedupeRowsByListingId(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const listingId = cleanText(row?.listing_id);
    if (!listingId) continue;
    if (seen.has(listingId)) continue;
    seen.add(listingId);
    out.push(row);
  }
  return out;
}

export async function fetchExistingListingIds(listingIds, { log } = {}) {
  const cleaned = Array.from(
    new Set((listingIds || []).map((id) => cleanText(id)).filter(Boolean))
  );
  if (!cleaned.length) return new Set();

  const retries = envInt("DB_RETRY_COUNT", 3);
  const baseDelayMs = envInt("DB_RETRY_BASE_MS", 1500);
  const supabase = createSupabaseClient();

  const existingRes = await withRetry(
    () => supabase.from("listings").select("listing_id").in("listing_id", cleaned),
    { retries, baseDelayMs, log, label: "db_existing_ids_select" }
  );
  if (existingRes.error) {
    throw new Error(`DB existing listings fetch failed: ${existingRes.error.message}`);
  }
  return new Set((existingRes.data || []).map((r) => String(r.listing_id)));
}

export async function persistDiscoveryInsertOnly(rows, { log } = {}) {
  const input = dedupeRowsByListingId(rows);
  if (!input.length) {
    return { inserted: 0, updated: 0, unchanged: 0, existing: 0, versionsInserted: 0 };
  }

  const retries = envInt("DB_RETRY_COUNT", 3);
  const baseDelayMs = envInt("DB_RETRY_BASE_MS", 1500);

  const supabase = createSupabaseClient();
  const listingIds = input.map((r) => String(r.listing_id));
  const nowIso = new Date().toISOString();

  const existingSet = await fetchExistingListingIds(listingIds, { log });
  const toInsert = input.filter((r) => !existingSet.has(String(r.listing_id)));
  if (!toInsert.length) {
    return { inserted: 0, updated: 0, unchanged: 0, existing: input.length, versionsInserted: 0 };
  }

  const inserts = toInsert.map((row) => {
    const scrapedAt = row.scraped_at || nowIso;
    const priceAmount = toNumber(row.listing_price_amount);
    const priceFormatted = cleanText(row.listing_price_formatted);
    const strike = cleanText(row.listing_strikethrough_price);
    const isLive = typeof row.listing_is_live === "boolean" ? row.listing_is_live : null;
    const isSold = typeof row.listing_is_sold === "boolean" ? row.listing_is_sold : null;
    const isPending = typeof row.listing_is_pending === "boolean" ? row.listing_is_pending : null;
    const isHidden = typeof row.listing_is_hidden === "boolean" ? row.listing_is_hidden : null;
    const sellerId = cleanText(row.listing_seller_id);
    const locationCity = cleanText(row.listing_location_city);
    const locationState = cleanText(row.listing_location_state);

    let priceRaw = row.price_raw;
    let pricePhp = row.price_php;
    if (!cleanText(priceRaw) && priceFormatted) priceRaw = priceFormatted;
    if (priceAmount != null) pricePhp = priceAmount;
    else if ((pricePhp == null || !Number.isFinite(pricePhp)) && priceFormatted) {
      pricePhp = parsePhpPrice(priceFormatted);
    }
    return {
      listing_id: String(row.listing_id),
      url: row.url,
      title: row.title,
      description: row.description,
      condition_raw: cleanText(row.condition_raw),
      location_raw: normalizeLocationRaw(row.location_raw),
      price_raw: priceRaw,
      price_php: pricePhp,
      listing_price_amount: priceAmount,
      listing_price_formatted: priceFormatted,
      listing_strikethrough_price: strike,
      listing_is_live: isLive,
      listing_is_sold: isSold,
      listing_is_pending: isPending,
      listing_is_hidden: isHidden,
      listing_seller_id: sellerId,
      listing_location_city: locationCity,
      listing_location_state: locationState,
      status: row.listing_status || "active",
      posted_at: row.posted_at || null,
      first_seen_at: scrapedAt,
      last_seen_at: scrapedAt,
      last_price_change_at: null,
      created_at: nowIso,
      updated_at: nowIso
    };
  });

  const insertRes = await withRetry(
    () =>
      supabase
        .from("listings")
        .insert(inserts, { onConflict: "listing_id", ignoreDuplicates: true })
        .select("id,listing_id"),
    { retries, baseDelayMs, log, label: "db_listings_insert_discovery" }
  );
  if (insertRes.error) {
    const msg = String(insertRes.error.message || "");
    if (/column .*condition_raw.* does not exist/i.test(msg)) {
      throw new Error(
        `DB listings insert failed: ${msg} (hint: run scraper/sql/add_condition_raw.sql in Supabase)`
      );
    }
    throw new Error(`DB listings insert failed: ${msg}`);
  }

  const insertedRows = insertRes.data || [];
  const idByListingId = new Map();
  for (const row of insertedRows) {
    idByListingId.set(String(row.listing_id), Number(row.id));
  }

  const versions = [];
  for (const row of toInsert) {
    const numericId = idByListingId.get(String(row.listing_id));
    if (!numericId) continue;
    versions.push({
      listing_id: numericId,
      snapshot_at: nowIso,
      price_raw: row.price_raw,
      price_php: row.price_php,
      status: row.listing_status || "active",
      title: row.title,
      description: row.description,
      posted_at: row.posted_at || null,
      changed_fields: ["new_listing"]
    });
  }

  let versionsInserted = 0;
  if (versions.length) {
    const versionsRes = await withRetry(() => supabase.from("listing_versions").insert(versions), {
      retries,
      baseDelayMs,
      log,
      label: "db_versions_insert_discovery"
    });
    if (versionsRes.error) {
      throw new Error(`DB listing_versions insert failed: ${versionsRes.error.message}`);
    }
    versionsInserted = versions.length;
  }

  const inserted = insertedRows.length;
  const existing = input.length - inserted;
  return { inserted, updated: 0, unchanged: 0, existing, versionsInserted };
}

export async function persistDiscoveryNetworkUpdate(rows, { log } = {}) {
  const input = dedupeRowsByListingId(rows);
  if (!input.length) {
    return { updated: 0, skipped: 0 };
  }

  const retries = envInt("DB_RETRY_COUNT", 3);
  const baseDelayMs = envInt("DB_RETRY_BASE_MS", 1500);
  const supabase = createSupabaseClient();
  const nowIso = new Date().toISOString();

  const updates = [];
  for (const row of input) {
    const payload = buildDiscoveryNetworkUpdate(row, nowIso);
    if (payload) updates.push(payload);
  }

  if (!updates.length) {
    return { updated: 0, skipped: input.length };
  }

  const res = await withRetry(
    () => supabase.from("listings").upsert(updates, { onConflict: "listing_id" }),
    { retries, baseDelayMs, log, label: "db_listings_update_discovery_network" }
  );
  if (res.error) {
    throw new Error(`DB listings update failed: ${res.error.message}`);
  }

  return { updated: updates.length, skipped: input.length - updates.length };
}

export async function persistToDatabaseBatched(rows, { phase, runId, log } = {}) {
  const batchSize = Math.max(1, envInt("DB_BATCH_SIZE", 25));
  const out = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    existing: 0,
    versionsInserted: 0,
    changedFieldCounts: Object.create(null),
    changeSamples: []
  };
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await persistToDatabase(batch, { log });
      out.inserted += res.inserted;
      out.updated += res.updated;
      out.unchanged += res.unchanged;
      out.existing += res.existing;
      out.versionsInserted += res.versionsInserted;
      if (res.changedFieldCounts) {
        for (const [k, v] of Object.entries(res.changedFieldCounts)) {
          out.changedFieldCounts[k] = (out.changedFieldCounts[k] || 0) + (v || 0);
        }
      }
      if (Array.isArray(res.changeSamples) && res.changeSamples.length) {
        out.changeSamples.push(...res.changeSamples);
      }
    } catch (error) {
      if (phase && runId) {
        savePendingRows({ runId, phase, rows: rows.slice(i), error, log });
      }
      throw error;
    }
  }
  return out;
}

export async function persistDiscoveryInsertOnlyBatched(rows, { phase, runId, log } = {}) {
  const batchSize = Math.max(1, envInt("DB_BATCH_SIZE", 25));
  const out = { inserted: 0, updated: 0, unchanged: 0, existing: 0, versionsInserted: 0 };
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await persistDiscoveryInsertOnly(batch, { log });
      out.inserted += res.inserted;
      out.updated += res.updated;
      out.unchanged += res.unchanged;
      out.existing += res.existing;
      out.versionsInserted += res.versionsInserted;
    } catch (error) {
      if (phase && runId) {
        savePendingRows({ runId, phase, rows: rows.slice(i), error, log });
      }
      throw error;
    }
  }
  return out;
}

export async function persistDiscoveryNetworkUpdateBatched(rows, { phase, runId, log } = {}) {
  const batchSize = Math.max(1, envInt("DB_BATCH_SIZE", 25));
  const out = { updated: 0, skipped: 0 };
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await persistDiscoveryNetworkUpdate(batch, { log });
      out.updated += res.updated;
      out.skipped += res.skipped;
    } catch (error) {
      if (phase && runId) {
        savePendingRows({ runId, phase, rows: rows.slice(i), error, log });
      }
      throw error;
    }
  }
  return out;
}
