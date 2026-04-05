from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class ListingRecord:
    listing_id: str
    url: str
    title: str | None
    description: str | None
    location_raw: str | None
    location_id: int | None
    price_raw: str | None
    listing_status: str
    content_hash: str | None
    scraped_at: str
    run_id: str
    first_seen_at: str | None
    last_seen_at: str | None
    last_seen_run_id: str | None
    last_changed_at: str | None
    sold_at: str | None
    missing_run_count: int
    is_active: bool
    source: str
    query_url: str

    def to_payload(self) -> dict[str, Any]:
        return asdict(self)

