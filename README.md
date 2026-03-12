# Iloilo iPhone Arbitrage & Automated Sourcing Engine (IAASE) - Phase 1

Phase 1 implements a Facebook Marketplace sniffer with two jobs:
- **Discovery**: extract listing cards from the feed, then (optionally) visit the detail pages for *new* items to capture `description`.
- **Monitoring**: recheck saved listing URLs from the DB to capture changes (title/price/description/status).

## 1) Setup

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m playwright install chromium
```

Copy `.env.example` to `.env` and set real values:

- `FB_MARKETPLACE_ILOILO_URL` (must include `sortBy=creation_time_descend`)
- `PLAYWRIGHT_PROFILE_DIR`
- `PLAYWRIGHT_PROFILE_ISOLATE_BY_CHANNEL` (`true` recommended)
- `PLAYWRIGHT_BROWSER_CHANNEL` (`chromium` for headless scheduled runs)
- `PLAYWRIGHT_EXTRA_USE_STEALTH` (`true` by default; disable if unstable in your environment)
- `PLAYWRIGHT_HEADLESS` (`true` for scheduled scraping)

## 2) Database schema (for monitoring & history)

The scraper upserts into `listings` (current state) and appends to `listing_versions` on changes:

```sql
create table listings (
  id                   bigserial primary key,
  listing_id           text not null unique,
  url                  text not null,
  title                text,
  description          text,
  location_raw         text,
  price_raw            text,
  price_php            numeric(12,2),
  status               text not null default 'active',
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  last_price_change_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table listing_versions (
  id            bigserial primary key,
  listing_id    bigint not null references listings(id) on delete cascade,
  snapshot_at   timestamptz not null default now(),
  price_raw     text,
  price_php     numeric(12,2),
  status        text,
  title         text,
  description   text,
  changed_fields jsonb not null default '[]'::jsonb
);
```

- `listings` holds the **current view** of each Marketplace item.
- `listing_versions` stores a **snapshot row** every time important fields change (price, status, title, description).

Notes:
- `listings` is always the latest known values per `listing_id`.
- `listing_versions` grows over time (history); it is append-only.

## 3) Bootstrap login (one-time)

```bash
npm.cmd install
npm.cmd run sniffer:playwright-extra -- --bootstrap-login --browser-channel chromium --no-headless
```

What happens:
- A persistent browser profile is opened.
- It opens `https://www.facebook.com/login` first (not Marketplace) to avoid the blue-F loading loop.
- You log in manually to Facebook.
- Press Enter in terminal to save the session.
- Profile paths are isolated by browser channel (for example `.../facebook_personal/chromium`) to avoid Chrome/Chromium conflicts.

If Facebook gets stuck loading, force Chrome channel:

```bash
npm.cmd run sniffer:playwright-extra -- --bootstrap-login --browser-channel chrome --no-headless
```

Stealth note:
- Bootstrap login intentionally runs without stealth injection.
- To test stealth on scraping only, use `--use-stealth` or set `PLAYWRIGHT_USE_STEALTH=true`.
- Bootstrap is always headful even if `PLAYWRIGHT_HEADLESS=true`.

## 4) Run scraper

Puppeteer (experimental A/B test path):

```bash
npm.cmd install
npm.cmd run sniffer:puppeteer -- --dry-run --max-cards 20 --browser-channel chromium
```

Playwright-extra combined (discovery + monitoring):

```bash
npm.cmd install
npm.cmd run sniffer:playwright-extra -- --max-cards 20 --browser-channel chromium --headless
```

Split entrypoints (recommended for scheduling):

```bash
npm.cmd run sniffer:playwright-extra:discover -- --max-cards 20 --browser-channel chromium --headless
npm.cmd run sniffer:playwright-extra:monitor -- --browser-channel chromium --headless
```

Puppeteer bootstrap login (same persistent profile/channel model):

```bash
npm.cmd run sniffer:puppeteer -- --bootstrap-login --browser-channel chromium --no-headless
```

Playwright-extra bootstrap login:

```bash
npm.cmd run sniffer:playwright-extra -- --bootstrap-login --browser-channel chromium --no-headless
```

## 4.1) Post-run QA check (legacy / optional)

```bash
npm.cmd run qa
```

This prints the latest run summary and counts of listings missing `description` or `location_raw`.

You can target a specific run and show a small change delta:

```bash
npm.cmd run qa -- --run-id <uuid> --limit 10
```

## 4.2) Backfill missing descriptions (legacy / optional)

Backfill the latest listings missing descriptions (default 10):

```bash
npm.cmd run backfill -- --limit 10
```

Or target specific listing ids:

```bash
npm.cmd run backfill -- --listing-id 698856889982758 --listing-id 910402055047554
```

Notes for Puppeteer mode:
- Uses `puppeteer-extra` + `puppeteer-extra-plugin-stealth`.
- Reuses `PLAYWRIGHT_PROFILE_DIR` and `PLAYWRIGHT_PROFILE_ISOLATE_BY_CHANNEL`.
- Reads `PUPPETEER_USE_STEALTH` (default true).
- Uses Playwright-installed Chromium by default for `--browser-channel chromium`.
- Canonicalizes listing URLs to `https://www.facebook.com/marketplace/item/<id>/` before save.
- Writes `iaase_raw_listings`, `iaase_listing_versions`, and `iaase_scrape_runs` (non-dry runs).
- Reuses `PLAYWRIGHT_DETAIL_DESCRIPTION_MAX_PAGES` for detail-page description/location enrichment.

Notes for Playwright-extra mode:
- Uses `playwright-extra` + `puppeteer-extra-plugin-stealth`.
- Reuses `PLAYWRIGHT_PROFILE_DIR` and `PLAYWRIGHT_PROFILE_ISOLATE_BY_CHANNEL`.
- Reads `PLAYWRIGHT_EXTRA_USE_STEALTH` (default true).
- Mirrors Puppeteer data writes and enrichment.

Legacy Python runner:
- `scraper/legacy/sniffer_phase1.py` is kept for reference/debugging.
- Python modules are archived at `scraper/legacy/iaase_sniffer/`.
- Current primary runs are Node entrypoints (`npm.cmd run sniffer`).

Pacing controls (optional):
- `SCRAPE_DELAY_MIN_MS`, `SCRAPE_DELAY_MAX_MS` for per-page jitter.
- `SCRAPE_COOLDOWN_EVERY_N`, `SCRAPE_COOLDOWN_MIN_MS`, `SCRAPE_COOLDOWN_MAX_MS` for periodic cool-down.
- `SCRAPE_GOTO_RETRY_COUNT` for navigation retries.
- `SCRAPE_USE_NETWORK` to prefer network JSON (GraphQL) over DOM when discovering cards.
- `SCRAPE_NETWORK_SAVE_RAW` to save raw response JSON to `logs/network-<run_id>.json`.
- `SCRAPE_NETWORK_DEBUG` to log GraphQL response URLs (debug).
- `SCRAPE_LOG_PROGRESS` to print network/DOM selection info.
- `SCRAPE_SCROLL_PAGES` to scroll the feed N times before extracting more cards.
- `SCRAPE_SCROLL_DELAY_MS` delay between scrolls.

## 5) Output contract

Each discovered row contains:

- `listing_id`
- `url`
- `title`
- `description`
- `location_raw`
- `listing_status` (`active`)
- `price_raw`
- `price_php` (numeric PHP price, cleaned from `price_raw`)
- `scraped_at` (UTC ISO-8601)
- `run_id` (UUID of current scrape run)

Run summary prints (combined mode):

- `run_id`
- `status`
- `cards_seen`
- `rows_extracted`
- `inserted` / `skipped_existing`
- `monitor_rechecked` / `monitor_versions`
- `elapsed_seconds`

Each run writes:
- a local log file to `logs/`
- a JSON export of discoveries to `logs/discovery-<run_id>.json`

## 6) Scheduling (Windows Task Scheduler)

Register hourly run with 0-30 minute jitter (effective cadence ~1:00 to 1:30):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register_scraper_task.ps1 -TaskName "IAASE-Discovery" -IntervalMinutes 60 -MaxRandomDelayMinutes 30 -Mode discover -MaxCards 100
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register_scraper_task.ps1 -TaskName "IAASE-Monitor" -IntervalMinutes 180 -MaxRandomDelayMinutes 30 -Mode monitor
```

Run immediately for testing:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_scraper.ps1 -Mode discover -Headless
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_scraper.ps1 -Mode monitor -Headless
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_discover_and_monitor.ps1 -Headless -MaxCards 100
```

Remove task:

```powershell
Unregister-ScheduledTask -TaskName "IAASE-Discovery" -Confirm:$false
```

## Notes

- Discovery and monitoring can run together (combined mode) or as separate scheduled tasks.
- Monitoring rechecks listing detail URLs from the DB (not by scrolling).
- Playwright-extra code is modularized under `scraper/playwright_extra/`.
  - `runner.py` (orchestration)
- If session expires, rerun with `--bootstrap-login`.
- If selectors break due to Facebook DOM changes, update extraction selectors in `scraper/sniffer_phase1.py`.
- If login is stuck on loading, delete `.playwright_profile/facebook_personal` and run bootstrap again with Chrome channel.
