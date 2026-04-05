export type ListingStatus = "active" | "sold" | "unavailable" | string;

export type PublicListing = {
  listing_id: string;
  title: string | null;
  price_php: number | null;
  price_raw: string | null;
  location_raw: string | null;
  status: ListingStatus;
  posted_at: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_price_change_at: string | null;
};

export type PrivateListing = PublicListing & {
  id: number;
  url: string;
  description: string | null;
  first_seen_at: string | null;
  updated_at: string | null;
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
