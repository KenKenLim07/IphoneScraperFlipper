# Discovery Seller Blocklist (Design)

## Summary
Add a hardcoded seller-ID blocklist in discovery extraction so listings from known spam sellers are skipped before downstream processing.

## Goals
- Skip discovery listings whose `listing_seller_id` matches a known spam seller.
- Keep the change discovery-only (no monitor/backfill changes).

## Non-Goals
- No Supabase cleanup in this change (handled separately).
- No environment variable configuration (hardcoded list).

## Behavior
- Add a constant `DISCOVERY_SELLER_BLOCKLIST` in `scraper/scraper/playwright_extra/extract_feed.mjs`.
- If a normalized listing’s `listing_seller_id` is in the blocklist, skip it.

## Initial Blocklist
- `100037405695171`
- `100094736079558`

## Placement
Apply the filter immediately after `normalizeNetworkListing()` returns a listing, before it is added to the map.

## Testing
- Add a small unit test or inline assertion in `extract_feed.mjs` if test infra exists; otherwise rely on log verification when running discovery.

## Rollout
- Discovery only. Monitoring and backfill remain unchanged.
