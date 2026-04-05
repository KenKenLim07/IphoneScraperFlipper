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

async function checkSelect(supabase, table, columns) {
  const { data, error } = await supabase.from(table).select(columns).limit(1);
  if (error) {
    return { ok: false, table, error: error.message };
  }
  return { ok: true, table, sample: (data && data[0]) || null };
}

async function main() {
  const supabase = makeClient();

  const checks = [
    ["listings", "id,listing_id,url,status,first_seen_at,last_seen_at,last_price_change_at,created_at,updated_at"],
    ["listing_versions", "id,listing_id,snapshot_at,changed_fields,price_php,status,title,description"]
  ];

  let failed = 0;
  for (const [table, columns] of checks) {
    const res = await checkSelect(supabase, table, columns);
    if (!res.ok) {
      failed += 1;
      console.error(`[FAIL] table=${table} error=${res.error}`);
      continue;
    }
    console.log(`[OK] table=${table} select=${columns}`);
  }

  if (failed) {
    process.exitCode = 2;
    console.log("[HINT] If you recently renamed tables, update the scraper table names (listings/listing_versions).");
  } else {
    console.log("[DONE] DB connectivity + basic schema check passed.");
  }
}

main().catch((error) => {
  console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
