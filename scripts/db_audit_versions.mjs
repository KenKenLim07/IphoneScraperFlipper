import process from "node:process";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

function cleanText(value) {
  if (!value) return null;
  const cleaned = String(value).replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function requireEnv(name) {
  const value = cleanText(process.env[name]);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function makeClient() {
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function countTable(supabase, table) {
  const res = await supabase.from(table).select("*", { count: "exact", head: true });
  if (res.error) throw new Error(`Count failed for ${table}: ${res.error.message}`);
  return res.count ?? 0;
}

async function fetchAll(supabase, table, select, pageSize = 1000) {
  const out = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const res = await supabase.from(table).select(select).range(from, to);
    if (res.error) throw new Error(`Fetch failed for ${table}: ${res.error.message}`);
    const rows = res.data || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 250_000) throw new Error("Safety stop: too many rows (over 250k).");
  }
  return out;
}

function uniq(values) {
  return Array.from(new Set(values));
}

async function main() {
  const supabase = makeClient();

  const listingsCount = await countTable(supabase, "listings");
  const versionsCount = await countTable(supabase, "listing_versions");

  console.log(`[INFO] listings_count=${listingsCount}`);
  console.log(`[INFO] listing_versions_count=${versionsCount}`);

  const listings = await fetchAll(supabase, "listings", "id,listing_id,created_at,first_seen_at,last_seen_at");
  const versions = await fetchAll(supabase, "listing_versions", "id,listing_id,snapshot_at,changed_fields");

  const listingNumericIds = listings.map((r) => Number(r.id)).filter(Number.isFinite);
  const versionListingNumericIds = versions.map((r) => Number(r.listing_id)).filter(Number.isFinite);

  const listingIdSet = new Set(listingNumericIds);
  const versionFkSet = new Set(versionListingNumericIds);

  let missingVersionFk = 0;
  for (const id of listingIdSet) {
    if (!versionFkSet.has(id)) missingVersionFk += 1;
  }

  const uniqueFkCount = versionFkSet.size;
  const avgVersionsPerListing = uniqueFkCount ? (versions.length / uniqueFkCount).toFixed(2) : "0.00";

  console.log(`[INFO] listings_with_any_version=${uniqueFkCount}`);
  console.log(`[INFO] listings_missing_version=${missingVersionFk}`);
  console.log(`[INFO] avg_versions_per_listed_item=${avgVersionsPerListing}`);

  const newListingVersions = versions.filter((v) => Array.isArray(v.changed_fields) && v.changed_fields.includes("new_listing"));
  const newListingFkIds = new Set(
    newListingVersions.map((v) => Number(v.listing_id)).filter(Number.isFinite)
  );
  console.log(`[INFO] versions_marked_new_listing=${newListingVersions.length}`);
  console.log(`[INFO] listings_with_new_listing_version=${newListingFkIds.size}`);

  const missingSample = [];
  for (const row of listings) {
    const id = Number(row.id);
    if (!Number.isFinite(id)) continue;
    if (versionFkSet.has(id)) continue;
    missingSample.push(row);
    if (missingSample.length >= 15) break;
  }
  if (missingSample.length) {
    console.log("[SAMPLE] listings_missing_version (first 15):");
    for (const row of missingSample) {
      console.log(
        `- id=${row.id} listing_id=${row.listing_id} created_at=${row.created_at} first_seen_at=${row.first_seen_at} last_seen_at=${row.last_seen_at}`
      );
    }
  }

  const listingIdStrings = listings.map((r) => String(r.listing_id)).filter((v) => v && v !== "null" && v !== "undefined");
  const uniqueListingIdStrings = uniq(listingIdStrings);
  if (uniqueListingIdStrings.length !== listingIdStrings.length) {
    console.log(
      `[WARN] listings.listing_id is not unique in DB (unique=${uniqueListingIdStrings.length} total=${listingIdStrings.length})`
    );
  }
}

main().catch((error) => {
  console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

