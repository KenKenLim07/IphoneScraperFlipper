import process from "node:process";

import { createClient } from "@supabase/supabase-js";
import { loadDotenv } from "../env.mjs";

loadDotenv();

function requireEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseArgs(argv) {
  const out = { runId: null, limit: 10 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--run-id") {
      out.runId = argv[i + 1] || null;
      i += 1;
    } else if (arg.startsWith("--run-id=")) {
      out.runId = arg.split("=", 2)[1] || null;
    } else if (arg === "--limit") {
      out.limit = Number.parseInt(argv[i + 1], 10) || 10;
      i += 1;
    } else if (arg.startsWith("--limit=")) {
      out.limit = Number.parseInt(arg.split("=", 2)[1], 10) || 10;
    }
  }
  out.limit = Math.max(1, Math.min(out.limit, 50));
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let runQuery = supabase
    .from("iaase_scrape_runs")
    .select(
      "run_id,status,started_at,finished_at,rows_extracted,rows_enriched_description,rows_enriched_location,rows_changed"
    )
    .order("started_at", { ascending: false })
    .limit(1);
  if (args.runId) runQuery = runQuery.eq("run_id", args.runId).limit(1);
  const latestRunRes = await runQuery.maybeSingle();

  if (latestRunRes.error) throw new Error(`Failed to load latest run: ${latestRunRes.error.message}`);
  const latestRun = latestRunRes.data;
  if (!latestRun) {
    console.log(args.runId ? `[QA] Run not found: ${args.runId}` : "[QA] No scrape runs found.");
    return 0;
  }

  const runId = latestRun.run_id;

  const totalRes = await supabase
    .from("iaase_raw_listings")
    .select("listing_id", { count: "exact", head: true });
  if (totalRes.error) throw new Error(`Total listings count failed: ${totalRes.error.message}`);

  const nullDescRes = await supabase
    .from("iaase_raw_listings")
    .select("listing_id", { count: "exact", head: true })
    .is("description", null);
  if (nullDescRes.error) throw new Error(`Null description count failed: ${nullDescRes.error.message}`);

  const nullLocRes = await supabase
    .from("iaase_raw_listings")
    .select("listing_id", { count: "exact", head: true })
    .is("location_raw", null);
  if (nullLocRes.error) throw new Error(`Null location count failed: ${nullLocRes.error.message}`);

  const bothNullRes = await supabase
    .from("iaase_raw_listings")
    .select("listing_id", { count: "exact", head: true })
    .is("description", null)
    .is("location_raw", null);
  if (bothNullRes.error) throw new Error(`Both-null count failed: ${bothNullRes.error.message}`);

  const lastSeenRes = await supabase
    .from("iaase_raw_listings")
    .select("listing_id", { count: "exact", head: true })
    .eq("last_seen_run_id", runId);
  if (lastSeenRes.error) throw new Error(`Last-seen count failed: ${lastSeenRes.error.message}`);

  console.log("[QA] Latest run:");
  console.log(
    `  run_id=${runId} status=${latestRun.status} started_at=${latestRun.started_at} finished_at=${latestRun.finished_at}`
  );
  console.log(
    `  rows_extracted=${latestRun.rows_extracted} rows_enriched_description=${latestRun.rows_enriched_description} ` +
      `rows_enriched_location=${latestRun.rows_enriched_location} rows_changed=${latestRun.rows_changed}`
  );
  console.log("[QA] Listings coverage:");
  console.log(`  total_listings=${totalRes.count ?? 0}`);
  console.log(`  missing_description=${nullDescRes.count ?? 0}`);
  console.log(`  missing_location=${nullLocRes.count ?? 0}`);
  console.log(`  missing_both=${bothNullRes.count ?? 0}`);
  console.log(`  seen_in_latest_run=${lastSeenRes.count ?? 0}`);

  const deltaRes = await supabase
    .from("iaase_listing_versions")
    .select("listing_id,changed_fields,price_raw,title,location_raw,scraped_at")
    .eq("run_id", runId)
    .order("scraped_at", { ascending: false })
    .limit(args.limit);
  if (deltaRes.error) throw new Error(`Delta query failed: ${deltaRes.error.message}`);

  console.log(`[QA] Latest changes (up to ${args.limit}):`);
  if (!deltaRes.data || deltaRes.data.length === 0) {
    console.log("  none");
  } else {
    for (const row of deltaRes.data) {
      const fields = Array.isArray(row.changed_fields) ? row.changed_fields.join(",") : String(row.changed_fields);
      console.log(
        `  listing_id=${row.listing_id} changed=[${fields}] price=${row.price_raw || "n/a"} ` +
          `title=${row.title || "n/a"}`
      );
    }
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[QA] Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
