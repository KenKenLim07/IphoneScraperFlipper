from __future__ import annotations

import hashlib
import re
import sys
from dataclasses import replace
from pathlib import Path
from typing import Any

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError
from playwright_stealth import stealth_sync

from .constants import (
    DETAIL_NOISE_RE,
    DETAIL_STOP_RE,
    LISTED_IN_RE,
    LISTING_ID_RE,
    LISTING_STATUS_ACTIVE,
    LISTING_STATUS_SOLD,
    LISTING_STATUS_UNAVAILABLE,
    LOCATION_LINE_RE,
    MARKETPLACE_ANCHOR_SELECTOR,
    PRICE_RE,
    SOLD_MARKERS,
    TITLE_NOISE_RE,
    UNAVAILABLE_MARKERS,
)
from .helpers import clean_text, make_absolute_facebook_url, utc_now_iso
from .models import ListingRecord


def extract_price(text_blob: str | None) -> str | None:
    if not text_blob:
        return None
    match = PRICE_RE.search(text_blob)
    return clean_text(match.group(1)) if match else None


def extract_listing_id(url: str) -> str | None:
    match = LISTING_ID_RE.search(url)
    return match.group(1) if match else None


def is_price_only_text(value: str | None) -> bool:
    if not value:
        return False
    text = clean_text(value)
    if not text:
        return False
    return bool(PRICE_RE.fullmatch(text))


def infer_title_from_card_text(card_text: str | None) -> str | None:
    if not card_text:
        return None
    candidates: list[str] = []
    seen: set[str] = set()
    for raw_line in card_text.splitlines():
        line = clean_text(raw_line)
        if not line:
            continue
        lowered = line.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        candidates.append(line)

    filtered: list[str] = []
    for line in candidates:
        if is_price_only_text(line):
            continue
        if TITLE_NOISE_RE.search(line):
            continue
        filtered.append(line)

    for line in filtered:
        if re.search(r"[a-zA-Z]", line):
            return line

    return filtered[0] if filtered else None


def infer_description_from_card_text(
    card_text: str | None,
    title: str | None,
    price_raw: str | None,
) -> str | None:
    if not card_text:
        return None

    title_clean = clean_text(title)
    price_clean = clean_text(price_raw)
    description_lines: list[str] = []
    seen: set[str] = set()

    for raw_line in card_text.splitlines():
        line = clean_text(raw_line)
        if not line:
            continue
        lowered = line.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        if title_clean and lowered == title_clean.lower():
            continue
        if price_clean and lowered == price_clean.lower():
            continue
        if is_price_only_text(line):
            continue
        if TITLE_NOISE_RE.search(line):
            continue
        if len(line) < 3:
            continue
        description_lines.append(line)

    if not description_lines:
        return None

    snippet = " | ".join(description_lines[:2])
    return snippet[:280].strip() or None


def is_location_like_description(value: str | None) -> bool:
    if not value:
        return True
    cleaned = clean_text(value)
    if not cleaned:
        return True
    if LOCATION_LINE_RE.fullmatch(cleaned):
        return True
    return False


def normalize_location_key(location_raw: str) -> str:
    return re.sub(r"\s+", " ", location_raw.strip().lower())


def parse_location_components(location_raw: str) -> dict[str, str | None]:
    text = clean_text(location_raw) or ""
    parts = [part.strip() for part in text.split(",") if part.strip()]
    municipality = parts[0] if parts else None
    province = None
    region_code = None
    if len(parts) >= 2 and re.fullmatch(r"PH-\d{2}", parts[-1], re.IGNORECASE):
        region_code = parts[-1].upper()
        if len(parts) >= 3:
            province = parts[-2]
    elif len(parts) >= 2:
        province = parts[-1]
    return {
        "municipality": municipality,
        "province": province,
        "region_code": region_code,
    }


def infer_location_from_card_text(card_text: str | None) -> str | None:
    if not card_text:
        return None
    for raw_line in card_text.splitlines():
        line = clean_text(raw_line)
        if not line:
            continue
        listed_match = LISTED_IN_RE.search(line)
        if listed_match:
            possible = clean_text(listed_match.group(1))
            if possible:
                return possible
        if LOCATION_LINE_RE.fullmatch(line):
            return line
    return None


def infer_listing_status_from_text(text_blob: str | None) -> str:
    lowered = (text_blob or "").lower()
    if any(marker in lowered for marker in SOLD_MARKERS):
        return LISTING_STATUS_SOLD
    if any(marker in lowered for marker in UNAVAILABLE_MARKERS):
        return LISTING_STATUS_UNAVAILABLE
    return LISTING_STATUS_ACTIVE


def compute_content_hash(
    title: str | None,
    description: str | None,
    price_raw: str | None,
    location_raw: str | None,
    url: str,
    listing_status: str,
) -> str:
    parts = [
        clean_text(title) or "",
        clean_text(description) or "",
        clean_text(price_raw) or "",
        clean_text(location_raw) or "",
        clean_text(url) or "",
        clean_text(listing_status) or "",
    ]
    blob = "\x1f".join(parts).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def compute_changed_fields(current: ListingRecord, previous: dict[str, Any] | None) -> list[str]:
    if not previous:
        return ["new_listing"]
    changed: list[str] = []
    field_pairs = [
        ("title", current.title, previous.get("title")),
        ("description", current.description, previous.get("description")),
        ("price_raw", current.price_raw, previous.get("price_raw")),
        ("location_raw", current.location_raw, previous.get("location_raw")),
        ("url", current.url, previous.get("url")),
        ("listing_status", current.listing_status, previous.get("listing_status")),
    ]
    for field_name, curr, prev in field_pairs:
        if clean_text(str(curr) if curr is not None else None) != clean_text(
            str(prev) if prev is not None else None
        ):
            changed.append(field_name)
    return changed


def launch_context(playwright: Any, profile_dir: str, browser_channel: str, headless: bool):
    launch_kwargs: dict[str, Any] = {
        "user_data_dir": profile_dir,
        "headless": headless,
        "args": [
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
        ],
        "viewport": {"width": 1366, "height": 900},
    }
    if browser_channel != "chromium":
        launch_kwargs["channel"] = browser_channel
    return playwright.chromium.launch_persistent_context(**launch_kwargs)


def open_context(playwright: Any, profile_dir: str, browser_channel: str, headless: bool):
    try:
        return launch_context(
            playwright,
            profile_dir=profile_dir,
            browser_channel=browser_channel,
            headless=headless,
        )
    except Exception as exc:  # noqa: BLE001
        message = str(exc).lower()
        profile_lock_exists = Path(profile_dir, "SingletonLock").exists()
        if profile_lock_exists:
            raise RuntimeError(
                f"Browser profile is already in use: {profile_dir}. "
                "Close the other bootstrap/scraper window and retry."
            ) from exc
        if "target page, context or browser has been closed" in message:
            raise RuntimeError(
                f"Browser exited immediately while opening profile: {profile_dir}. "
                "If you switched browser channels, re-bootstrap login for this channel/profile."
            ) from exc
        raise


def maybe_apply_stealth(page: Page, use_stealth: bool, phase: str) -> None:
    if not use_stealth:
        return
    try:
        stealth_sync(page)
    except Exception as exc:  # noqa: BLE001
        print(f"[WARN] Stealth injection failed during {phase}: {exc}", file=sys.stderr)


def looks_like_login_or_block(page: Page) -> bool:
    current = page.url.lower()
    if "/login" in current or "checkpoint" in current:
        return True
    login_markers = ["Log in to Facebook", "Create new account", "Continue as"]
    content = page.content().lower()
    return any(marker.lower() in content for marker in login_markers)


def extract_visible_cards(page: Page, max_cards: int) -> list[dict[str, Any]]:
    script = """
    ([selector, limit]) => {
      const anchors = Array.from(document.querySelectorAll(selector));
      const out = [];
      for (const a of anchors) {
        if (out.length >= limit) break;
        if (!(a instanceof HTMLAnchorElement)) continue;
        const href = a.getAttribute('href') || '';
        if (!href.includes('/marketplace/item/')) continue;

        const rect = a.getBoundingClientRect();
        const visible = rect.bottom > 0 && rect.top < window.innerHeight;
        if (!visible) continue;

        const card =
          a.closest("div[role='article']") ||
          a.closest("div[data-testid*='marketplace_feed_item']") ||
          a.closest('div');
        const cardText = card ? (card.innerText || '') : '';
        const titleCandidates = [
          card?.querySelector("h2 span")?.textContent,
          card?.querySelector("span[dir='auto']")?.textContent,
          card?.querySelector("div[dir='auto']")?.textContent,
          a.textContent,
        ];
        let title = null;
        for (const candidate of titleCandidates) {
          if (candidate && candidate.trim().length > 0) {
            title = candidate.trim();
            break;
          }
        }

        out.push({
          href,
          anchorText: (a.textContent || '').trim(),
          cardText: (cardText || '').trim(),
          title: title,
        });
      }
      return out;
    }
    """
    return page.evaluate(script, [MARKETPLACE_ANCHOR_SELECTOR, max_cards])


def normalize_records(
    raw_rows: list[dict[str, Any]],
    query_url: str,
    run_id: str,
) -> tuple[list[ListingRecord], int]:
    cards_seen = len(raw_rows)
    by_id: dict[str, ListingRecord] = {}
    scraped_at = utc_now_iso()
    for row in raw_rows:
        url = make_absolute_facebook_url(str(row.get("href", "")))
        listing_id = extract_listing_id(url)
        if not listing_id:
            continue
        title = clean_text((row.get("title") or row.get("anchorText") or None))
        if is_price_only_text(title):
            title = infer_title_from_card_text(row.get("cardText"))
        price_raw = extract_price(row.get("cardText"))
        location_raw = infer_location_from_card_text(row.get("cardText"))
        description = infer_description_from_card_text(
            card_text=row.get("cardText"),
            title=title,
            price_raw=price_raw,
        )
        by_id[listing_id] = ListingRecord(
            listing_id=listing_id,
            url=url,
            title=title,
            description=description,
            location_raw=location_raw,
            location_id=None,
            price_raw=price_raw,
            listing_status=LISTING_STATUS_ACTIVE,
            content_hash=None,
            scraped_at=scraped_at,
            run_id=run_id,
            first_seen_at=None,
            last_seen_at=scraped_at,
            last_seen_run_id=run_id,
            last_changed_at=None,
            sold_at=None,
            missing_run_count=0,
            is_active=True,
            source="facebook_marketplace",
            query_url=query_url,
        )
    return list(by_id.values()), cards_seen


def extract_detail_fields(page: Page, record: ListingRecord) -> tuple[str | None, str | None, str]:
    page.goto(record.url, wait_until="domcontentloaded", timeout=90000)
    try:
        page.wait_for_load_state("networkidle", timeout=12000)
    except PlaywrightTimeoutError:
        pass

    result = page.evaluate(
        """
        () => {
          const texts = Array.from(document.querySelectorAll("span[dir='auto'], div[dir='auto']"))
            .map(el => (el.innerText || '').replace(/\\s+/g, ' ').trim())
            .filter(Boolean);
          const lowered = texts.map(t => t.toLowerCase());
          let detailsIndex = lowered.findIndex(t => t === 'details' || t === 'detail');
          if (detailsIndex < 0) detailsIndex = 0;
          return {
            allTexts: texts,
            detailTexts: texts.slice(detailsIndex, detailsIndex + 80),
          };
        }
        """
    )
    body_text = ""
    try:
        body_text = page.inner_text("body", timeout=5000)
    except Exception:
        body_text = ""

    if not isinstance(result, dict):
        return None, None, infer_listing_status_from_text(body_text)
    all_texts = result.get("allTexts")
    detail_texts = result.get("detailTexts")
    if not isinstance(all_texts, list):
        all_texts = []
    if not isinstance(detail_texts, list):
        detail_texts = []

    title_clean = (record.title or "").strip().lower()
    price_clean = (record.price_raw or "").strip().lower()
    detail_location: str | None = None
    output_lines: list[str] = []
    seen: set[str] = set()

    status_text_parts = [body_text]
    status_text_parts.extend(str(item) for item in all_texts)

    # Location can appear outside the "Details" block, so scan the full text first.
    for raw in all_texts:
        line = clean_text(str(raw))
        if not line:
            continue
        listed_match = LISTED_IN_RE.search(line)
        if listed_match:
            possible = clean_text(listed_match.group(1))
            if possible:
                detail_location = possible
                break
        if LOCATION_LINE_RE.fullmatch(line):
            detail_location = line
            break
        embedded_match = re.search(r"([A-Za-z][A-Za-z0-9 .,'-]+,\s*PH-\d{2})", line, re.IGNORECASE)
        if embedded_match:
            possible = clean_text(embedded_match.group(1))
            if possible:
                detail_location = possible
                break

    for raw in detail_texts:
        line = clean_text(str(raw))
        if not line:
            continue
        lowered = line.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        listed_match = LISTED_IN_RE.search(line)
        if listed_match:
            possible = clean_text(listed_match.group(1))
            if possible and not detail_location:
                detail_location = possible
        if LOCATION_LINE_RE.fullmatch(line) and not detail_location:
            detail_location = line
        if DETAIL_STOP_RE.search(line):
            break
        if DETAIL_NOISE_RE.search(line):
            continue
        if title_clean and lowered == title_clean:
            continue
        if price_clean and lowered == price_clean:
            continue
        if is_price_only_text(line):
            continue
        if LOCATION_LINE_RE.fullmatch(line):
            continue
        if len(line) < 4:
            continue
        output_lines.append(line)
        if len(output_lines) >= 3:
            break

    detail_description = " | ".join(output_lines)[:420] if output_lines else None
    detail_status = infer_listing_status_from_text(" ".join(status_text_parts))
    return detail_description, detail_location, detail_status


def enrich_descriptions_from_details(
    context: Any,
    records: list[ListingRecord],
    max_pages: int = 10,
) -> tuple[list[ListingRecord], int, int, int, int]:
    updated = records[:]
    desc_enriched_count = 0
    location_enriched_count = 0
    sold_count = 0
    unavailable_count = 0
    inspected = 0
    for idx, record in enumerate(updated):
        if inspected >= max_pages:
            break
        inspected += 1
        page = context.new_page()
        try:
            detail_desc, detail_location, detail_status = extract_detail_fields(page, record)
            next_record = record
            if detail_desc and is_location_like_description(record.description):
                next_record = replace(next_record, description=detail_desc)
                desc_enriched_count += 1
            if detail_location and not record.location_raw:
                next_record = replace(next_record, location_raw=detail_location)
                location_enriched_count += 1
            if detail_status != next_record.listing_status:
                next_record = replace(
                    next_record,
                    listing_status=detail_status,
                    is_active=(detail_status == LISTING_STATUS_ACTIVE),
                )
            if detail_status == LISTING_STATUS_SOLD:
                sold_count += 1
            elif detail_status == LISTING_STATUS_UNAVAILABLE:
                unavailable_count += 1
            updated[idx] = next_record
        except Exception as exc:  # noqa: BLE001
            print(f"[WARN] Detail description fetch failed for {record.listing_id}: {exc}", file=sys.stderr)
        finally:
            page.close()
    return updated, desc_enriched_count, location_enriched_count, sold_count, unavailable_count


def run_bootstrap_login(profile_dir: str, browser_channel: str) -> int:
    from playwright.sync_api import sync_playwright

    print("[INFO] Bootstrap login started.")
    print(f"[INFO] Browser channel: {browser_channel}")
    print("[INFO] A browser window will open to Facebook login. Sign in, then press Enter here.")
    with sync_playwright() as p:
        context = open_context(
            p,
            profile_dir=profile_dir,
            browser_channel=browser_channel,
            headless=False,
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(
            "https://www.facebook.com/login",
            wait_until="domcontentloaded",
            timeout=90000,
        )
        input("Press Enter after login is complete and Marketplace loads in this profile...")
        context.close()
    print("[INFO] Profile session saved.")
    return 0
