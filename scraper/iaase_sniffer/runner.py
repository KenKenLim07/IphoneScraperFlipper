from __future__ import annotations

import json
import sys
import time
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright
from supabase import Client, create_client

from .config import (
    parse_args,
    require_env,
    resolve_browser_channel,
    resolve_detail_description_enabled,
    resolve_detail_description_max_pages,
    resolve_headless,
    resolve_not_seen_deactivate_runs,
    resolve_profile_dir,
    resolve_use_stealth,
    resolve_watchlist_recheck_limit,
)
from .constants import MARKETPLACE_ANCHOR_SELECTOR
from .extraction import (
    enrich_descriptions_from_details,
    extract_visible_cards,
    maybe_apply_stealth,
    normalize_location_key,
    normalize_records,
    open_context,
    run_bootstrap_login,
)
from .helpers import TeeStream, utc_now_iso
from .storage import (
    apply_state_and_build_versions,
    ensure_marketplace_url,
    fetch_existing_records,
    fetch_watchlist_candidates,
    insert_versions,
    listing_from_db_row,
    mark_missing_listings,
    upsert_locations,
    upsert_records,
    write_run_log,
)


def main() -> int:
    load_dotenv()
    args = parse_args()
    browser_channel = resolve_browser_channel(args.browser_channel)
    use_stealth = resolve_use_stealth(args.use_stealth)
    headless = resolve_headless(args.headless)
    detail_desc_enabled = resolve_detail_description_enabled()
    detail_desc_max_pages = resolve_detail_description_max_pages()
    not_seen_deactivate_runs = resolve_not_seen_deactivate_runs()
    watchlist_recheck_limit = resolve_watchlist_recheck_limit()

    run_id = str(uuid4())
    started_at = utc_now_iso()
    started = time.perf_counter()

    original_stdout = sys.stdout
    original_stderr = sys.stderr
    log_file_handle = None

    logs_dir = Path("logs")
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_path = logs_dir / f"sniffer-{started_at.replace(':', '').replace('-', '')}-{run_id[:8]}.log"
    log_file_handle = log_path.open("a", encoding="utf-8")
    sys.stdout = TeeStream(original_stdout, log_file_handle)
    sys.stderr = TeeStream(original_stderr, log_file_handle)
    print(f"[INFO] Local run log: {log_path}")

    def finish(code: int) -> int:
        nonlocal log_file_handle
        if log_file_handle is not None:
            log_file_handle.flush()
            sys.stdout = original_stdout
            sys.stderr = original_stderr
            log_file_handle.close()
            log_file_handle = None
        return code

    try:
        base_profile_dir = require_env("PLAYWRIGHT_PROFILE_DIR")
    except ValueError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return finish(2)

    profile_dir = resolve_profile_dir(base_profile_dir, browser_channel=browser_channel)
    Path(profile_dir).mkdir(parents=True, exist_ok=True)
    print(f"[INFO] Using profile dir: {profile_dir}")
    print(
        f"[INFO] detail_description_enabled={detail_desc_enabled} "
        f"detail_description_max_pages={detail_desc_max_pages}"
    )
    print(
        f"[INFO] not_seen_deactivate_runs={not_seen_deactivate_runs} "
        f"watchlist_recheck_limit={watchlist_recheck_limit}"
    )

    if args.bootstrap_login:
        if use_stealth:
            print(
                "[WARN] Stealth is ignored during --bootstrap-login to prevent Facebook login JS breakage.",
                file=sys.stderr,
            )
        if headless:
            print("[WARN] Headless is ignored during --bootstrap-login.", file=sys.stderr)
        return finish(run_bootstrap_login(profile_dir=profile_dir, browser_channel=browser_channel))

    try:
        query_url = ensure_marketplace_url(require_env("FB_MARKETPLACE_ILOILO_URL"))
    except ValueError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return finish(2)

    use_supabase = not args.dry_run
    supabase_client: Client | None = None
    if use_supabase:
        try:
            supabase_url = require_env("SUPABASE_URL")
            service_role_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
            supabase_client = create_client(supabase_url, service_role_key)
        except Exception as exc:  # noqa: BLE001
            print(f"[ERROR] Supabase initialization failed: {exc}", file=sys.stderr)
            return finish(4)

    cards_seen = 0
    rows_extracted = 0
    rows_upserted = 0
    rows_failed = 0
    rows_enriched_description = 0
    rows_enriched_location = 0
    rows_detected_sold = 0
    rows_detected_unavailable = 0
    locations_upserted = 0
    versions_inserted = 0
    rows_changed = 0
    rows_missing_seen = 0
    rows_marked_not_seen = 0
    rows_watchlist_rechecked = 0
    run_errors: list[dict[str, str]] = []
    status = "success"
    exit_code = 0

    records = []

    try:
        with sync_playwright() as p:
            context = open_context(
                p,
                profile_dir=profile_dir,
                browser_channel=browser_channel,
                headless=headless,
            )
            page = context.pages[0] if context.pages else context.new_page()
            maybe_apply_stealth(page, use_stealth=use_stealth, phase="scrape")
            page.goto(query_url, wait_until="domcontentloaded", timeout=90000)

            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except PlaywrightTimeoutError:
                pass

            page.wait_for_selector(MARKETPLACE_ANCHOR_SELECTOR, state="attached", timeout=30000)
            raw_rows = extract_visible_cards(page, max_cards=max(1, args.max_cards))
            records, cards_seen = normalize_records(raw_rows, query_url=query_url, run_id=run_id)
            rows_extracted = len(records)

            if detail_desc_enabled and rows_extracted > 0 and detail_desc_max_pages > 0:
                (
                    records,
                    rows_enriched_description,
                    rows_enriched_location,
                    rows_detected_sold,
                    rows_detected_unavailable,
                ) = enrich_descriptions_from_details(
                    context,
                    records=records,
                    max_pages=detail_desc_max_pages,
                )

            if supabase_client is not None and watchlist_recheck_limit > 0:
                watch_rows = fetch_watchlist_candidates(
                    client=supabase_client,
                    query_url=query_url,
                    exclude_listing_ids={record.listing_id for record in records},
                    limit=watchlist_recheck_limit,
                )
                watch_records = []
                for row in watch_rows:
                    rec = listing_from_db_row(
                        row=row,
                        run_id=run_id,
                        scraped_at=utc_now_iso(),
                        query_url=query_url,
                    )
                    if rec:
                        watch_records.append(rec)
                if watch_records:
                    (
                        rechecked,
                        re_desc,
                        re_loc,
                        re_sold,
                        re_unavail,
                    ) = enrich_descriptions_from_details(
                        context,
                        records=watch_records,
                        max_pages=watchlist_recheck_limit,
                    )
                    rows_watchlist_rechecked = len(rechecked)
                    rows_enriched_description += re_desc
                    rows_enriched_location += re_loc
                    rows_detected_sold += re_sold
                    rows_detected_unavailable += re_unavail
                    records_by_id = {record.listing_id: record for record in records}
                    for rec in rechecked:
                        records_by_id[rec.listing_id] = rec
                    records = list(records_by_id.values())

            context.close()

    except PlaywrightTimeoutError as exc:
        print(f"[ERROR] Navigation or selector timeout: {exc}", file=sys.stderr)
        status = "failed"
        exit_code = 3
        run_errors.append({"stage": "navigation", "error": str(exc)[:400]})
    except RuntimeError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        status = "failed"
        exit_code = 3
        run_errors.append({"stage": "runtime", "error": str(exc)[:400]})
    except Exception as exc:  # noqa: BLE001
        print(f"[ERROR] Unexpected scrape failure: {exc}", file=sys.stderr)
        status = "failed"
        exit_code = 3
        run_errors.append({"stage": "scrape", "error": str(exc)[:400]})

    if exit_code == 0 and not records:
        print(
            "[ERROR] No listings extracted. Check profile login state, selectors, and URL filters.",
            file=sys.stderr,
        )
        status = "failed"
        exit_code = 3
        run_errors.append({"stage": "extract", "error": "No listings extracted."})

    if exit_code == 0 and args.dry_run:
        print("[INFO] Dry-run mode enabled, skipping Supabase write.")
        for record in records:
            print(json.dumps(record.to_payload(), ensure_ascii=True))
    elif exit_code == 0:
        assert supabase_client is not None
        try:
            key_to_id, locations_upserted = upsert_locations(supabase_client, records)
            if key_to_id:
                records = [
                    record
                    if not record.location_raw
                    else replace(
                        record,
                        location_id=key_to_id.get(normalize_location_key(record.location_raw)),
                    )
                    for record in records
                ]
        except Exception as exc:  # noqa: BLE001
            error_text = str(exc)
            run_errors.append({"stage": "location", "error": error_text[:400]})
            print(f"[WARN] Location upsert/link failed: {error_text}", file=sys.stderr)

        try:
            existing_by_id = fetch_existing_records(
                supabase_client,
                [record.listing_id for record in records],
            )
            records, version_rows, rows_changed = apply_state_and_build_versions(
                records=records,
                existing_by_id=existing_by_id,
                run_id=run_id,
                scraped_at=utc_now_iso(),
            )
        except Exception as exc:  # noqa: BLE001
            error_text = str(exc)
            run_errors.append({"stage": "state", "error": error_text[:400]})
            print(f"[WARN] State/change preparation failed: {error_text}", file=sys.stderr)
            version_rows = []
            rows_changed = 0

        rows_upserted, rows_failed, upsert_failures = upsert_records(supabase_client, records)
        run_errors.extend(upsert_failures)
        if rows_upserted == 0 and rows_failed > 0:
            print("[ERROR] Supabase writes failed for all records.", file=sys.stderr)
            status = "failed"
            exit_code = 4
        else:
            try:
                versions_inserted += insert_versions(supabase_client, version_rows)
            except Exception as exc:  # noqa: BLE001
                error_text = str(exc)
                run_errors.append({"stage": "versions", "error": error_text[:400]})
                print(f"[WARN] Version insert failed: {error_text}", file=sys.stderr)

            try:
                rows_missing_seen, rows_marked_not_seen, missing_versions = mark_missing_listings(
                    client=supabase_client,
                    query_url=query_url,
                    seen_listing_ids={record.listing_id for record in records},
                    now_iso=utc_now_iso(),
                    deactivate_runs=not_seen_deactivate_runs,
                    run_id=run_id,
                )
                if missing_versions:
                    versions_inserted += insert_versions(supabase_client, missing_versions)
            except Exception as exc:  # noqa: BLE001
                error_text = str(exc)
                run_errors.append({"stage": "missing", "error": error_text[:400]})
                print(f"[WARN] Missing-listing status update failed: {error_text}", file=sys.stderr)

    if exit_code != 0 and status != "failed":
        status = "failed"

    elapsed = time.perf_counter() - started
    if not args.dry_run and supabase_client is not None:
        run_payload = {
            "run_id": run_id,
            "started_at": started_at,
            "finished_at": utc_now_iso(),
            "status": status,
            "query_url": query_url,
            "browser_channel": browser_channel,
            "headless": headless,
            "use_stealth": use_stealth,
            "dry_run": args.dry_run,
            "max_cards": max(1, args.max_cards),
            "cards_seen": cards_seen,
            "rows_extracted": len(records),
            "rows_upserted": rows_upserted,
            "rows_failed": rows_failed,
            "rows_enriched_description": rows_enriched_description,
            "rows_enriched_location": rows_enriched_location,
            "rows_detected_sold": rows_detected_sold,
            "rows_detected_unavailable": rows_detected_unavailable,
            "locations_upserted": locations_upserted,
            "rows_changed": rows_changed,
            "versions_inserted": versions_inserted,
            "rows_missing_seen": rows_missing_seen,
            "rows_marked_not_seen": rows_marked_not_seen,
            "error_count": len(run_errors),
            "error_details": run_errors[:50],
        }
        try:
            write_run_log(supabase_client, run_payload)
        except Exception as exc:  # noqa: BLE001
            print(f"[WARN] Failed to write run log: {exc}", file=sys.stderr)

    print(
        f"[SUMMARY] run_id={run_id} status={status} cards_seen={cards_seen} "
        f"rows_extracted={len(records)} rows_upserted={rows_upserted} "
        f"rows_failed={rows_failed} rows_enriched_description={rows_enriched_description} "
        f"rows_enriched_location={rows_enriched_location} rows_detected_sold={rows_detected_sold} "
        f"rows_detected_unavailable={rows_detected_unavailable} "
        f"rows_watchlist_rechecked={rows_watchlist_rechecked} "
        f"locations_upserted={locations_upserted} rows_changed={rows_changed} "
        f"versions_inserted={versions_inserted} rows_missing_seen={rows_missing_seen} "
        f"rows_marked_not_seen={rows_marked_not_seen} elapsed_seconds={elapsed:.2f}"
    )
    return finish(exit_code)
