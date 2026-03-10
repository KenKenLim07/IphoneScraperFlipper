from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class TeeStream:
    def __init__(self, *streams: Any):
        self.streams = streams

    def write(self, data: str) -> int:
        for stream in self.streams:
            stream.write(data)
        return len(data)

    def flush(self) -> None:
        for stream in self.streams:
            stream.flush()


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.split()).strip()
    return cleaned or None


def make_absolute_facebook_url(raw_href: str) -> str:
    href = (raw_href or "").strip()
    if not href:
        return ""
    if href.startswith("http://") or href.startswith("https://"):
        return href
    if href.startswith("/"):
        return f"https://www.facebook.com{href}"
    return f"https://www.facebook.com/{href.lstrip('/')}"


def canonicalize_facebook_marketplace_item_url(raw_url: str, listing_id: str | None = None) -> str:
    if listing_id is None:
        match = re.search(r"/marketplace/item/(\d+)", raw_url or "")
        listing_id = match.group(1) if match else None
    if listing_id:
        return f"https://www.facebook.com/marketplace/item/{listing_id}/"
    return make_absolute_facebook_url(raw_url)
