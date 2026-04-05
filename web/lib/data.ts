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

export type PublicListingsQuery = {
  query?: string | null;
  min?: number | null;
  max?: number | null;
  status?: string | null;
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

  const min = input.min != null && Number.isFinite(input.min) ? input.min : null;
  const max = input.max != null && Number.isFinite(input.max) ? input.max : null;

  const supabase = supabaseAdmin();
  let query = supabase
    .from("listings")
    .select("listing_id,title,price_php,price_raw,location_raw,status,posted_at,first_seen_at,last_seen_at,last_price_change_at")
    .order("posted_at", { ascending: false, nullsFirst: false })
    .order("first_seen_at", { ascending: false, nullsFirst: false })
    .order("listing_id", { ascending: false, nullsFirst: false });

  if (q) {
    query = query.ilike("title", `%${q}%`);
  }
  if (status) {
    query = query.eq("status", status);
  }
  if (min != null) {
    query = query.gte("price_php", min);
  }
  if (max != null) {
    query = query.lte("price_php", max);
  }

  const res = await query.range(from, to);
  if (res.error) throw new Error(res.error.message);
  const rows = (res.data || []) as unknown as PublicListing[];
  const hasMore = rows.length > pageSize;
  return {
    page,
    pageSize,
    hasMore,
    items: rows.slice(0, pageSize)
  };
}

export async function fetchPrivateListing(listingId: string) {
  const supabase = supabaseAdmin();
  const listingRes = await supabase
    .from("listings")
    .select(
      "id,listing_id,url,title,description,location_raw,price_raw,price_php,status,first_seen_at,last_seen_at,last_price_change_at,updated_at"
    )
    .eq("listing_id", listingId)
    .limit(1)
    .maybeSingle();

  if (listingRes.error) throw new Error(listingRes.error.message);
  const listing = listingRes.data as unknown as PrivateListing | null;
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
  const min = parseIntParam(params.get("min"), NaN);
  const max = parseIntParam(params.get("max"), NaN);
  const page = parseIntParam(params.get("page"), 1);
  const pageSize = parseIntParam(params.get("pageSize"), 50);

  return {
    query,
    status,
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
    page,
    pageSize
  };
}
