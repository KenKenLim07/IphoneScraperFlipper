# IAASE (Iloilo iPhone Arbitrage & Automated Sourcing Engine)

Repo structure:

- `scraper/` — Facebook Marketplace sniffer (discovery + monitoring) that writes to Supabase (`listings`, `listing_versions`).
- `web/` — Next.js dashboard (public list, gated details + “Open on Facebook”).
- `infra/systemd/` — Linux `systemd --user` timers for scheduling scraper runs.
- `design-system/` — UI design system artifacts (generated via `ui-ux-pro-max`).

## Scraper

Setup:

```bash
cd scraper
cp .env.example .env
npm install
```

Bootstrap login (one-time, headful):

```bash
cd scraper
npm run sniffer:playwright-extra:discover -- --bootstrap-login --browser-channel chromium --no-headless
```

Run:

```bash
cd scraper
npm run sniffer:playwright-extra:discover -- --max-cards 50 --browser-channel chromium --headless
npm run sniffer:playwright-extra:monitor  -- --limit 50 --browser-channel chromium --headless

cd ~/Desktop/Projects/IphoneflipperScrapper
npm --prefix scraper run -s sniffer:playwright-extra:discover -- --max-cards 100 --browser-channel chromium --headless

```

### Deal intelligence (comps + score)

1) Run the SQL migration in Supabase:

- `scraper/sql/add_deal_intelligence_tables.sql`

2) Compute deal metrics:

```bash
cd scraper
npm run deals:compute
```

## Web dashboard

See `web/README.md`.

## Scheduling (Linux)

See `infra/systemd/README.md`.
