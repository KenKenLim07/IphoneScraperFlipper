import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { ListingVersion, PrivateListing, PublicListing } from "@/lib/types";

function cleanText(value: unknown): string | null {
  const s = typeof value === "string" ? value : value == null ? "" : String(value);
  const cleaned = s.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function parseIntParam(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function publicTitleFromFeatures(feat: any, fallbackTitle: unknown): string {
  const modelFamily = typeof feat?.model_family === "string" ? feat.model_family : "";
  const variant = typeof feat?.variant === "string" ? feat.variant : "";
  const storageGb =
    typeof feat?.storage_gb === "number"
      ? feat.storage_gb
      : typeof feat?.storage_gb === "string"
        ? Number(feat.storage_gb)
        : null;

  const formatModel = (mf: string) => {
    const s = mf.toLowerCase();
    if (s === "iphone_xr") return "iPhone XR";
    if (s === "iphone_xs") return "iPhone XS";
    if (s === "iphone_x") return "iPhone X";
    if (s === "iphone_se") return "iPhone SE";
    if (s === "iphone_se_2") return "iPhone SE (2020)";
    if (s === "iphone_se_3") return "iPhone SE (2022)";
    const m = /^iphone_(\d{1,2})$/.exec(s);
    if (m) return `iPhone ${m[1]}`;
    return "";
  };

  const formatVariant = (v: string) => {
    const s = v.toLowerCase();
    if (s === "pro_max") return "Pro Max";
    if (s === "pro") return "Pro";
    if (s === "plus") return "Plus";
    if (s === "mini") return "Mini";
    if (s === "max") return "Max";
    return "";
  };

  const model = formatModel(modelFamily);
  const varText = formatVariant(variant);
  const storage = storageGb != null && Number.isFinite(storageGb) ? `${Math.round(storageGb)}GB` : "";
  const joined = [model, varText, storage].filter(Boolean).join(" ");
  if (joined) return joined;

  // Fallback: extract a minimal model from the original title without leaking extra phrases/prices.
  const t = cleanText(fallbackTitle) || "";
  const lowered = t.toLowerCase();
  const n = /\biphone\s*(\d{1,2})\b/i.exec(lowered);
  if (n) return `iPhone ${n[1]}`;
  if (/\biphone\s*xr\b/i.test(lowered)) return "iPhone XR";
  if (/\biphone\s*xs\b/i.test(lowered)) return "iPhone XS";
  if (/\biphone\s*x\b/i.test(lowered)) return "iPhone X";
  if (/\biphone\s*se\b/i.test(lowered)) return "iPhone SE";
  return "iPhone";
}

export type PublicListingsQuery = {
  query?: string | null;
  status?: string | null;
  sort?: "deals" | "latest";
  page?: number;
  pageSize?: number;
};

export async function fetchPublicListings(input: PublicListingsQuery) {
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.max(10, Math.min(100, input.pageSize || 50));

  const from = (page - 1) * pageSize;
  const to = from + pageSize; // inclusive -> pageSize+1 (for hasMore)

  const q = cleanText(input.query);
  const status = cleanText(input.status);
  const sort = input.sort === "latest" ? "latest" : "deals";

  const supabase = supabaseAdmin();
  const selectBase =
    "listing_id,title,price_php,price_raw,location_raw,status,posted_at,first_seen_at,last_seen_at,last_price_change_at,deal:deal_metrics(deal_score,below_market_pct,confidence,est_profit_php),feat:listing_features(model_family,variant,storage_gb,battery_health,openline,risk_flags)";
  const selectDeals =
    "listing_id,title,price_php,price_raw,location_raw,status,posted_at,first_seen_at,last_seen_at,last_price_change_at,deal:deal_metrics!inner(deal_score,below_market_pct,confidence,est_profit_php),feat:listing_features(model_family,variant,storage_gb,battery_health,openline,risk_flags)";

  let query = supabase
    .from("listings")
    .select(sort === "deals" ? selectDeals : selectBase, { count: "exact" });

  if (sort === "deals") {
    query = query
      .in("deal_metrics.deal_score", ["A", "B", "C"])
      .order("est_profit_php", { ascending: false, nullsFirst: false, referencedTable: "deal_metrics" })
      .order("deal_score", { ascending: true, nullsFirst: false, referencedTable: "deal_metrics" })
      .order("posted_at", { ascending: false, nullsFirst: false })
      .order("first_seen_at", { ascending: false, nullsFirst: false })
      .order("listing_id", { ascending: false, nullsFirst: false });
  } else {
    query = query
      .order("posted_at", { ascending: false, nullsFirst: false })
      .order("first_seen_at", { ascending: false, nullsFirst: false })
      .order("listing_id", { ascending: false, nullsFirst: false });
  }

  if (q) {
    query = query.ilike("title", `%${q}%`);
  }
  if (status) {
    query = query.eq("status", status);
  }

  const res = await query.range(from, to);
  if (res.error) throw new Error(res.error.message);
  const rows = (res.data || []) as unknown as any[];
  const total = typeof res.count === "number" ? res.count : null;
  const hasMore =
    sort === "deals" && typeof total === "number"
      ? total > page * pageSize
      : rows.length > pageSize;
  let items: PublicListing[] = rows.slice(0, pageSize).map((r) => {
    const deal = Array.isArray(r?.deal) ? r.deal[0] : r?.deal;
    const feat = Array.isArray(r?.feat) ? r.feat[0] : r?.feat;
    return {
      listing_id: String(r.listing_id),
      public_title: publicTitleFromFeatures(feat, r.title),
      price_php: r.price_php ?? null,
      price_raw: r.price_raw ?? null,
      location_raw: r.location_raw ?? null,
      status: r.status ?? "active",
      posted_at: r.posted_at ?? null,
      first_seen_at: r.first_seen_at ?? null,
      last_seen_at: r.last_seen_at ?? null,
      last_price_change_at: r.last_price_change_at ?? null,
      battery_health: feat?.battery_health ?? null,
      openline: feat?.openline ?? null,
      deal_score: deal?.deal_score ?? null,
      below_market_pct: deal?.below_market_pct ?? null,
      confidence: deal?.confidence ?? null,
      est_profit_php: deal?.est_profit_php ?? null,
      risk_flags: feat?.risk_flags ?? null
    };
  });

  if (sort === "deals") {
    const scoreRank = (score: unknown) => {
      const s = String(score || "").toUpperCase();
      if (s === "A") return 0;
      if (s === "B") return 1;
      if (s === "C") return 2;
      return 9;
    };
    const timeValue = (value: unknown) => {
      const parsed = value ? new Date(String(value)).getTime() : NaN;
      return Number.isFinite(parsed) ? parsed : 0;
    };
    items = [...items].sort((a, b) => {
      const profitA = typeof a.est_profit_php === "number" ? a.est_profit_php : -Infinity;
      const profitB = typeof b.est_profit_php === "number" ? b.est_profit_php : -Infinity;
      if (profitA !== profitB) return profitB - profitA;
      const rankDiff = scoreRank(a.deal_score) - scoreRank(b.deal_score);
      if (rankDiff !== 0) return rankDiff;
      const timeA = timeValue(a.posted_at || a.first_seen_at);
      const timeB = timeValue(b.posted_at || b.first_seen_at);
      if (timeA !== timeB) return timeB - timeA;
      return String(b.listing_id).localeCompare(String(a.listing_id));
    });
  }
  return {
    page,
    pageSize,
    total,
    hasMore,
    items
  };
}

export async function fetchPrivateListing(listingId: string) {
  const supabase = supabaseAdmin();
  const listingRes = await supabase
    .from("listings")
    .select(
      "id,listing_id,url,title,description,location_raw,condition_raw,price_raw,price_php,status,posted_at,first_seen_at,last_seen_at,last_price_change_at,updated_at,deal:deal_metrics(deal_score,below_market_pct,confidence,est_profit_php,comp_sample_size,comp_p25,comp_p50,comp_p75,reasons),feat:listing_features(model_family,variant,storage_gb,battery_health,openline,region_code,risk_flags)"
    )
    .eq("listing_id", listingId)
    .limit(1)
    .maybeSingle();

  if (listingRes.error) throw new Error(listingRes.error.message);
  const raw = listingRes.data as unknown as any | null;
  const deal = raw ? (Array.isArray(raw.deal) ? raw.deal[0] : raw.deal) : null;
  const feat = raw ? (Array.isArray(raw.feat) ? raw.feat[0] : raw.feat) : null;
  const listing: PrivateListing | null = raw
    ? {
        id: raw.id,
        listing_id: String(raw.listing_id),
        url: String(raw.url),
        public_title: publicTitleFromFeatures(feat, raw.title),
        title: raw.title ?? null,
        description: raw.description ?? null,
        location_raw: raw.location_raw ?? null,
        price_raw: raw.price_raw ?? null,
        price_php: raw.price_php ?? null,
        status: raw.status ?? "active",
        posted_at: raw.posted_at ?? null,
        first_seen_at: raw.first_seen_at ?? null,
        last_seen_at: raw.last_seen_at ?? null,
        last_price_change_at: raw.last_price_change_at ?? null,
        updated_at: raw.updated_at ?? null,
        deal_score: deal?.deal_score ?? null,
        below_market_pct: deal?.below_market_pct ?? null,
        confidence: deal?.confidence ?? null,
        est_profit_php: deal?.est_profit_php ?? null,
        comp_sample_size: deal?.comp_sample_size ?? null,
        comp_p25: deal?.comp_p25 ?? null,
        comp_p50: deal?.comp_p50 ?? null,
        comp_p75: deal?.comp_p75 ?? null,
        reasons: Array.isArray(deal?.reasons) ? deal.reasons.map((x: unknown) => String(x)) : null,

        model_family: feat?.model_family ?? null,
        variant: feat?.variant ?? null,
        storage_gb: feat?.storage_gb ?? null,
        battery_health: feat?.battery_health ?? null,
        openline: feat?.openline ?? null,
        condition_raw: raw.condition_raw ?? null,
        region_code: feat?.region_code ?? null,
        risk_flags: feat?.risk_flags ?? null
      }
    : null;
  if (!listing) return null;

  const versionsRes = await supabase
    .from("listing_versions")
    .select("snapshot_at,price_php,price_raw,status,title,description,changed_fields")
    .eq("listing_id", listing.id)
    .order("snapshot_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (versionsRes.error) throw new Error(versionsRes.error.message);
  const versions = (versionsRes.data || []) as unknown as ListingVersion[];

  return { listing, versions };
}

export function parsePublicQueryParams(params: URLSearchParams): PublicListingsQuery {
  const query = cleanText(params.get("query"));
  const status = cleanText(params.get("status"));
  const sortRaw = cleanText(params.get("sort"));
  const sort = sortRaw === "latest" ? "latest" : "deals";
  const page = parseIntParam(params.get("page"), 1);
  const pageSize = parseIntParam(params.get("pageSize"), 50);

  return {
    query,
    status,
    sort,
    page,
    pageSize
  };
}
