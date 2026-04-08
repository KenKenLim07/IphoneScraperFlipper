# GraphQL Listings Cleanup Plan (Post‑Stability)

This is **optional** cleanup after we confirm the GraphQL feed is stable and complete.  
Goal: remove redundant fields and simplify storage once we trust the network data.

## Preconditions (do not skip)
- **At least 7–14 days** of runs with GraphQL network parsing enabled.
- **Coverage:** ≥95% of listings in discovery have `listing_price_amount` populated.
- **Mismatch rate:** `<2%` where `price_php` differs from `listing_price_amount`.
- **No regressions** in UI or compute jobs (public list, detail view, deal compute).

## Candidate columns to drop (only if preconditions pass)

### 1) Price duplication
- **`price_raw`** (listings): only used for fallback parsing in DOM.  
  Drop if GraphQL price is consistently present and correct.
- **`listing_price_formatted`** (listings): redundant if we always format `listing_price_amount`.

### 2) Location duplication
- **`location_raw`** (listings): keep if you still rely on DOM scrape.  
  Drop only if GraphQL `listing_location_city/state` are always present and preferred.

## Recommended minimal set to keep
- `listing_price_amount` (authoritative numeric price)
- `listing_strikethrough_price` (historical/was price)
- `listing_is_live`, `listing_is_sold`, `listing_is_pending`, `listing_is_hidden`
- `listing_seller_id`
- `listing_location_city`, `listing_location_state`
- `price_php` (still used across compute/UI)

## Cleanup steps (when ready)
1) **Code cleanup**
   - Stop reading removed columns in `web/lib/data.ts`.
   - Stop writing removed columns in `scraper/scraper/playwright_extra/db.mjs`.
   - Update types in `web/lib/types.ts` and `web/lib/database.types.ts`.
2) **DB migration**
   - Create a new SQL file to drop columns (see sample below).
3) **Deploy + verify**
   - Run discovery once and verify no missing prices or locations.
   - Validate UI, deal compute, and detail page.

## Example SQL (drop only what you choose)
```sql
alter table if exists public.listings
  drop column if exists price_raw,
  drop column if exists listing_price_formatted,
  drop column if exists location_raw;
```

## Notes
- If GraphQL coverage dips (FB changes), keep the DOM fallbacks.
- `price_php` is still needed even if you drop `price_raw`.
- We can also keep `location_raw` for a safety net and just stop using it in UI.
