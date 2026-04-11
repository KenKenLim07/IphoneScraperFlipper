# Discovery Newest-First Sorting (Posted-at with Scraped-at Fallback)

## Summary
Add a newest-first sort step to discovery results before applying the existing `max_cards` cap. Sorting uses `posted_at` (descending) and falls back to `scraped_at` (descending) when `posted_at` is missing. No other extraction, filtering, or cap behavior changes.

## Goals
- Prefer the newest listings within the existing `max_cards` cap.
- Preserve current extraction and filtering behavior.
- Avoid adding new dependencies or schema changes.

## Non-Goals
- No change to discovery filters (price, keyword, model, swap, buyer).
- No change to overfetching/cap behavior.
- No change to enrichment logic.

## Proposed Behavior
1. Extract discovery rows as usual (network/DOM as currently configured).
2. Compute a sort key per row:
   - Use `posted_at` if present and parseable.
   - Otherwise use `scraped_at`.
3. Sort rows by this key in descending order (newest first).
4. Apply the existing `max_cards` cap and proceed with the current filter + insert flow.

## Data Sources and Fields
- `posted_at`: from extraction (when available).
- `scraped_at`: already present on extracted rows.

## API / Interface Changes
None.

## Testing / Validation
- Case A: Rows with `posted_at` should sort above rows without it (assuming timestamps are newer).
- Case B: Rows missing `posted_at` should sort by `scraped_at` in descending order.
- Case C: If no rows have `posted_at`, order should be by `scraped_at` only.
- Ensure output count and filters remain unchanged from current behavior.

## Risks
- If `posted_at` is malformed for some rows, fallback to `scraped_at` avoids errors.
- Sorting in memory is negligible at expected row counts.

## Assumptions
- `scraped_at` is present for all extracted rows.
- `posted_at` may be missing or null for some rows.
