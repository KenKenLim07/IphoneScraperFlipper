# Scraper Commands

## Deals

Run deals compute:

```bash
npm --prefix scraper run -s deals:compute
```

Run deal text tests:

```bash
npm --prefix scraper run -s deals:test
```

## Discovery

Run discovery (Playwright extra):

```bash
npm --prefix scraper run -s sniffer:playwright-extra:discover
```

Example with max cards:

```bash
npm --prefix scraper run -s sniffer:playwright-extra:discover -- --max-cards 50
```

## Monitor

Run monitor (Playwright extra):

```bash
npm --prefix scraper run -s sniffer:playwright-extra:monitor
```

Example with smaller recheck limit:

```bash
npm --prefix scraper run -s sniffer:playwright-extra:monitor -- --recheck-limit 50
```

## Full Sniffer

Run combined sniffer:

```bash
npm --prefix scraper run -s sniffer:playwright-extra
```

## Environment Audit

```bash
npm --prefix scraper run -s env:audit
```
node scraper/scripts/replay_pending.mjs scraper/logs/pending-monitor-e101b299-a847-4873-b3f9-88e9c69e3907.json

node scraper/scripts/replay_pending.mjs
