export type ListingStatus = "active" | "sold" | "unavailable" | string;
export type DealScore = "A" | "B" | "C" | "D" | "NA" | string;
export type DealConfidence = "low" | "med" | "high" | string;

export type PublicListing = {
  listing_id: string;
  public_title: string;
  price_php: number | null;
  price_raw: string | null;
  location_raw: string | null;
  status: ListingStatus;
  posted_at: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_price_change_at: string | null;
  battery_health?: number | null;
  openline?: boolean | null;

  deal_score?: DealScore | null;
  below_market_pct?: number | null;
  confidence?: DealConfidence | null;
  est_profit_php?: number | null;
  risk_flags?: unknown;
};

export type PrivateListing = PublicListing & {
  id: number;
  url: string;
  title: string | null;
  description: string | null;
  first_seen_at: string | null;
  updated_at: string | null;

  comp_sample_size?: number | null;
  comp_p25?: number | null;
  comp_p50?: number | null;
  comp_p75?: number | null;
  reasons?: string[] | null;

  model_family?: string | null;
  variant?: string | null;
  storage_gb?: number | null;
  battery_health?: number | null;
  openline?: boolean | null;
  condition_text?: string | null;
  region_code?: string | null;
  risk_flags?: unknown;
};

export type ListingVersion = {
  snapshot_at: string;
  price_php: number | null;
  price_raw: string | null;
  status: string | null;
  title: string | null;
  description: string | null;
  changed_fields: unknown;
};
