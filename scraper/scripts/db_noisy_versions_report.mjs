import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { loadDotenv } from "../scraper/env.mjs";

loadDotenv();

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

function groupBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function isNullish(value) {
  return value == null || cleanText(value) == null;
}

async function main() {
  const supabase = makeClient();

  const listings = await fetchAll(
    supabase,
    "listings",
    "id,listing_id,title,description,price_php,price_raw,status,last_seen_at,updated_at"
  );
  const versions = await fetchAll(
    supabase,
    "listing_versions",
    "id,listing_id,snapshot_at,changed_fields,description,price_php,status,title"
  );

  const versionsByFk = groupBy(versions, (v) => String(v.listing_id));

  const rows = listings
    .map((l) => {
      const fk = String(l.id);
      const vs = versionsByFk.get(fk) || [];
      const nullDescCount = vs.filter((v) => isNullish(v.description)).length;
      return {
        fk,
        listing_id: String(l.listing_id),
        title: cleanText(l.title) || "n/a",
        versions: vs.length,
        null_desc_versions: nullDescCount
      };
    })
    .sort((a, b) => b.versions - a.versions);

  console.log(`[INFO] listings=${listings.length} listing_versions=${versions.length}`);
  console.log("[INFO] per-listing version counts (top 20):");
  for (const r of rows.slice(0, 20)) {
    console.log(
      `- listings.id=${r.fk} listing_id=${r.listing_id} versions=${r.versions} null_desc_versions=${r.null_desc_versions} title="${r.title.slice(0, 70)}"`
    );
  }

  const noisy = rows.filter((r) => r.versions >= 3 || r.null_desc_versions > 0).slice(0, 10);
  if (!noisy.length) return;

  console.log("");
  console.log("[DETAIL] sample histories (up to 5 versions each):");
  for (const r of noisy) {
    const vs = (versionsByFk.get(String(r.fk)) || [])
      .slice()
      .sort((a, b) => String(b.snapshot_at).localeCompare(String(a.snapshot_at)))
      .slice(0, 5);
    console.log(`listing_id=${r.listing_id} listings.id=${r.fk} title="${r.title.slice(0, 70)}"`);
    for (const v of vs) {
      const fields = Array.isArray(v.changed_fields) ? v.changed_fields.join(",") : String(v.changed_fields);
      const desc = cleanText(v.description);
      console.log(
        `  - v.id=${v.id} at=${v.snapshot_at} fields=[${fields}] desc=${desc ? "yes" : "NO"} price_php=${v.price_php ?? "null"} status=${v.status || "n/a"}`
      );
    }
  }
}

main().catch((error) => {
  console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
