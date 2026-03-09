from __future__ import annotations

import re


LISTING_ID_RE = re.compile(r"/marketplace/item/(\d+)")
PRICE_RE = re.compile(
    r"((?:\u20B1|PHP|\$)\s*\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s*(?:PHP))",
    re.IGNORECASE,
)
TITLE_NOISE_RE = re.compile(
    r"(?:\b\d+\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|wk|week|weeks|mo|month|months)\b|\bkm away\b|^sponsored$|^boosted$)",
    re.IGNORECASE,
)
LOCATION_LINE_RE = re.compile(r".+,\s*PH-\d{2}$", re.IGNORECASE)
DETAIL_STOP_RE = re.compile(
    r"(location is approximate|seller information|seller details|today's picks|similar items|message seller|send seller a message)",
    re.IGNORECASE,
)
DETAIL_NOISE_RE = re.compile(
    r"^(details|detail|save|share|message|send|listed .+ in .+|location)$",
    re.IGNORECASE,
)
LISTED_IN_RE = re.compile(r"listed .+ in (.+)$", re.IGNORECASE)

MARKETPLACE_ANCHOR_SELECTOR = "a[href*='/marketplace/item/']"

SUPABASE_TABLE = "iaase_raw_listings"
SUPABASE_RUNS_TABLE = "iaase_scrape_runs"
SUPABASE_LOCATIONS_TABLE = "iaase_locations"
SUPABASE_VERSIONS_TABLE = "iaase_listing_versions"

LISTING_STATUS_ACTIVE = "active"
LISTING_STATUS_SOLD = "sold"
LISTING_STATUS_UNAVAILABLE = "unavailable"
LISTING_STATUS_NOT_SEEN = "not_seen"

SOLD_MARKERS = (
    "this listing is sold",
    "seller marked this listing as sold",
    "already sold",
)
UNAVAILABLE_MARKERS = (
    "this listing isn't available",
    "this listing is no longer available",
    "this item is no longer available",
    "content isn't available",
)

