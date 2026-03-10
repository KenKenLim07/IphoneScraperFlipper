from __future__ import annotations

from dataclasses import replace
from typing import Any
from urllib.parse import urlparse

from supabase import Client

from .constants import (
    LISTING_STATUS_ACTIVE,
    LISTING_STATUS_NOT_SEEN,
    LISTING_STATUS_SOLD,
    LISTING_STATUS_UNAVAILABLE,
    SUPABASE_LOCATIONS_TABLE,
    SUPABASE_RUNS_TABLE,
    SUPABASE_TABLE,
    SUPABASE_VERSIONS_TABLE,
)
from .extraction import (
    compute_changed_fields,
    compute_content_hash,
    normalize_location_key,
    parse_location_components,
)
from .helpers import canonicalize_facebook_marketplace_item_url, clean_text
from .models import ListingRecord


def ensure_marketplace_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("FB_MARKETPLACE_ILOILO_URL must be a full http(s) URL.")
    if "facebook.com" not in parsed.netloc.lower():
        raise ValueError("FB_MARKETPLACE_ILOILO_URL must point to facebook.com.")
    return url


def upsert_locations(client: Client, records: list[ListingRecord]) -> tuple[dict[str, int], int]:
    by_key: dict[str, str] = {}
    for record in records:
        raw = clean_text(record.location_raw)
        if not raw:
            continue
        key = normalize_location_key(raw)
        by_key.setdefault(key, raw)

    if not by_key:
        return {}, 0

    payload: list[dict[str, Any]] = []
    for key, raw in by_key.items():
        parsed = parse_location_components(raw)
        payload.append(
            {
                "location_key": key,
                "location_raw": raw,
                "municipality": parsed.get("municipality"),
                "province": parsed.get("province"),
                "region_code": parsed.get("region_code"),
            }
        )

    client.table(SUPABASE_LOCATIONS_TABLE).upsert(payload, on_conflict="location_key").execute()
    found = (
        client.table(SUPABASE_LOCATIONS_TABLE)
        .select("id,location_key")
        .in_("location_key", list(by_key.keys()))
        .execute()
    )
    key_to_id: dict[str, int] = {}
    for row in found.data or []:
        try:
            key_to_id[str(row["location_key"])] = int(row["id"])
        except Exception:
            continue
    return key_to_id, len(by_key)


def fetch_existing_records(client: Client, listing_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not listing_ids:
        return {}
    response = (
        client.table(SUPABASE_TABLE)
        .select(
            "listing_id,title,description,price_raw,location_raw,url,listing_status,"
            "content_hash,first_seen_at,last_seen_at,last_seen_run_id,last_changed_at,"
            "sold_at,missing_run_count,is_active,location_id"
        )
        .in_("listing_id", listing_ids)
        .execute()
    )
    rows = response.data or []
    return {str(row["listing_id"]): row for row in rows if row.get("listing_id")}


def listing_from_db_row(row: dict[str, Any], run_id: str, scraped_at: str, query_url: str) -> ListingRecord | None:
    listing_id = str(row.get("listing_id") or "").strip()
    url = str(row.get("url") or "").strip()
    if not listing_id or not url:
        return None
    canonical_url = canonicalize_facebook_marketplace_item_url(url, listing_id=listing_id)
    return ListingRecord(
        listing_id=listing_id,
        url=canonical_url,
        title=row.get("title"),
        description=row.get("description"),
        location_raw=row.get("location_raw"),
        location_id=row.get("location_id"),
        price_raw=row.get("price_raw"),
        listing_status=str(row.get("listing_status") or LISTING_STATUS_ACTIVE),
        content_hash=str(row.get("content_hash") or "") or None,
        scraped_at=scraped_at,
        run_id=run_id,
        first_seen_at=str(row.get("first_seen_at")) if row.get("first_seen_at") else None,
        last_seen_at=scraped_at,
        last_seen_run_id=run_id,
        last_changed_at=str(row.get("last_changed_at")) if row.get("last_changed_at") else None,
        sold_at=str(row.get("sold_at")) if row.get("sold_at") else None,
        missing_run_count=0,
        is_active=True,
        source="facebook_marketplace",
        query_url=query_url,
    )


def fetch_watchlist_candidates(
    client: Client,
    query_url: str,
    exclude_listing_ids: set[str],
    limit: int,
) -> list[dict[str, Any]]:
    if limit <= 0:
        return []

    select_cols = (
        "listing_id,url,title,description,location_raw,location_id,price_raw,listing_status,"
        "content_hash,first_seen_at,last_seen_at,last_seen_run_id,last_changed_at,sold_at,"
        "missing_run_count,is_active,query_url"
    )

    def filter_rows(rows: list[dict[str, Any]], out: list[dict[str, Any]], seen: set[str]) -> None:
        for row in rows:
            listing_id = str(row.get("listing_id") or "")
            if not listing_id or listing_id in exclude_listing_ids or listing_id in seen:
                continue
            status = str(row.get("listing_status") or LISTING_STATUS_ACTIVE)
            if status not in {LISTING_STATUS_ACTIVE, LISTING_STATUS_NOT_SEEN}:
                continue
            out.append(row)
            seen.add(listing_id)
            if len(out) >= limit:
                return

    filtered: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    # Prioritize rows that still have missing location to accelerate backfill.
    null_loc_response = (
        client.table(SUPABASE_TABLE)
        .select(select_cols)
        .eq("query_url", query_url)
        .is_("location_raw", "null")
        .order("last_seen_at")
        .limit(max(limit * 2, limit))
        .execute()
    )
    filter_rows(null_loc_response.data or [], filtered, seen_ids)
    if len(filtered) >= limit:
        return filtered

    remaining = limit - len(filtered)
    response = (
        client.table(SUPABASE_TABLE)
        .select(select_cols)
        .eq("query_url", query_url)
        .order("last_seen_at")
        .limit(max(remaining * 3, remaining))
        .execute()
    )
    filter_rows(response.data or [], filtered, seen_ids)
    return filtered


def apply_state_and_build_versions(
    records: list[ListingRecord],
    existing_by_id: dict[str, dict[str, Any]],
    run_id: str,
    scraped_at: str,
) -> tuple[list[ListingRecord], list[dict[str, Any]], int]:
    updated_records: list[ListingRecord] = []
    versions: list[dict[str, Any]] = []
    changed_count = 0

    for record in records:
        previous = existing_by_id.get(record.listing_id)
        content_hash = compute_content_hash(
            title=record.title,
            description=record.description,
            price_raw=record.price_raw,
            location_raw=record.location_raw,
            url=record.url,
            listing_status=record.listing_status,
        )
        changed_fields = compute_changed_fields(record, previous)
        is_changed = bool(changed_fields)
        if is_changed:
            changed_count += 1

        first_seen_at = str(previous.get("first_seen_at")) if previous and previous.get("first_seen_at") else scraped_at
        last_changed_at = (
            scraped_at
            if is_changed
            else (
                str(previous.get("last_changed_at"))
                if previous and previous.get("last_changed_at")
                else scraped_at
            )
        )
        previous_sold_at = str(previous.get("sold_at")) if previous and previous.get("sold_at") else None
        sold_at = previous_sold_at
        if record.listing_status == LISTING_STATUS_SOLD and not sold_at:
            sold_at = scraped_at

        with_state = replace(
            record,
            content_hash=content_hash,
            first_seen_at=first_seen_at,
            last_seen_at=scraped_at,
            last_seen_run_id=run_id,
            last_changed_at=last_changed_at,
            sold_at=sold_at,
            missing_run_count=0,
            is_active=(record.listing_status == LISTING_STATUS_ACTIVE),
        )
        updated_records.append(with_state)

        if is_changed:
            versions.append(
                {
                    "listing_id": with_state.listing_id,
                    "run_id": run_id,
                    "scraped_at": scraped_at,
                    "content_hash": content_hash,
                    "listing_status": with_state.listing_status,
                    "title": with_state.title,
                    "description": with_state.description,
                    "price_raw": with_state.price_raw,
                    "location_raw": with_state.location_raw,
                    "location_id": with_state.location_id,
                    "url": with_state.url,
                    "changed_fields": changed_fields,
                }
            )
    return updated_records, versions, changed_count


def insert_versions(client: Client, versions: list[dict[str, Any]]) -> int:
    if not versions:
        return 0
    client.table(SUPABASE_VERSIONS_TABLE).insert(versions).execute()
    return len(versions)


def mark_missing_listings(
    client: Client,
    query_url: str,
    seen_listing_ids: set[str],
    now_iso: str,
    deactivate_runs: int,
    run_id: str,
) -> tuple[int, int, list[dict[str, Any]]]:
    response = (
        client.table(SUPABASE_TABLE)
        .select(
            "listing_id,title,description,price_raw,location_raw,url,listing_status,content_hash,"
            "missing_run_count,is_active,last_changed_at,first_seen_at,last_seen_at,last_seen_run_id,sold_at"
        )
        .eq("query_url", query_url)
        .execute()
    )
    rows = response.data or []
    to_update: list[dict[str, Any]] = []
    versions: list[dict[str, Any]] = []
    missing_count = 0
    deactivated_count = 0
    for row in rows:
        listing_id = str(row.get("listing_id") or "")
        if not listing_id or listing_id in seen_listing_ids:
            continue
        previous_status = str(row.get("listing_status") or LISTING_STATUS_ACTIVE)
        if previous_status in {LISTING_STATUS_SOLD, LISTING_STATUS_UNAVAILABLE}:
            continue
        missing_count += 1
        current_missing = int(row.get("missing_run_count") or 0)
        next_missing = current_missing + 1
        next_status = previous_status
        next_active = bool(row.get("is_active")) if row.get("is_active") is not None else True
        last_changed_at = str(row.get("last_changed_at")) if row.get("last_changed_at") else now_iso
        changed_fields: list[str] = []

        if next_missing >= deactivate_runs and previous_status == LISTING_STATUS_ACTIVE:
            next_status = LISTING_STATUS_NOT_SEEN
            next_active = False
            last_changed_at = now_iso
            changed_fields.append("listing_status")
            changed_fields.append("is_active")
            deactivated_count += 1

        next_hash = str(row.get("content_hash") or "")
        if next_status != previous_status:
            next_hash = compute_content_hash(
                title=row.get("title"),
                description=row.get("description"),
                price_raw=row.get("price_raw"),
                location_raw=row.get("location_raw"),
                url=str(row.get("url") or ""),
                listing_status=next_status,
            )

        payload = {
            "listing_id": listing_id,
            "missing_run_count": next_missing,
            "listing_status": next_status,
            "is_active": next_active,
            "content_hash": next_hash,
            "last_changed_at": last_changed_at,
        }
        to_update.append(payload)

        if changed_fields:
            versions.append(
                {
                    "listing_id": listing_id,
                    "run_id": run_id,
                    "scraped_at": now_iso,
                    "content_hash": next_hash,
                    "listing_status": next_status,
                    "title": row.get("title"),
                    "description": row.get("description"),
                    "price_raw": row.get("price_raw"),
                    "location_raw": row.get("location_raw"),
                    "location_id": None,
                    "url": row.get("url"),
                    "changed_fields": changed_fields,
                }
            )

    if to_update:
        # Use targeted updates for existing rows to avoid accidental inserts with partial payload.
        for payload in to_update:
            listing_id = str(payload.get("listing_id") or "")
            if not listing_id:
                continue
            update_payload = {k: v for k, v in payload.items() if k != "listing_id"}
            client.table(SUPABASE_TABLE).update(update_payload).eq("listing_id", listing_id).execute()
    return missing_count, deactivated_count, versions


def upsert_records(client: Client, records: list[ListingRecord]) -> tuple[int, int, list[dict[str, str]]]:
    upserted = 0
    failed = 0
    failures: list[dict[str, str]] = []
    table = client.table(SUPABASE_TABLE)
    for record in records:
        try:
            table.upsert(record.to_payload(), on_conflict="listing_id").execute()
            upserted += 1
        except Exception as exc:  # noqa: BLE001
            failed += 1
            error_text = str(exc)
            print(f"[WARN] Failed upsert listing_id={record.listing_id}: {error_text}")
            failures.append({"listing_id": record.listing_id, "error": error_text[:400]})
    return upserted, failed, failures


def write_run_log(client: Client, payload: dict[str, Any]) -> None:
    client.table(SUPABASE_RUNS_TABLE).insert(payload).execute()
