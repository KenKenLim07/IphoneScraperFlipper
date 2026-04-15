# Automation Cheat Sheet (Systemd + Scraper)

## One‑time setup

### 1) Bootstrap login (Playwright session)
```bash
cd ~/Desktop/Projects/IphoneflipperScrapper/scraper
bash scripts/run_discover.sh -- --bootstrap-login --browser-channel chromium --no-headless
```

#### Optional: two accounts (discover vs monitor)
Set two different persistent profile dirs (each dir = one Facebook login session), then bootstrap each once:

```bash
cd ~/Desktop/Projects/IphoneflipperScrapper/scraper

# Account A (used by discovery)
export PLAYWRIGHT_PROFILE_DIR_DISCOVER=".playwright_profile/fb_account_a"
bash scripts/run_discover.sh -- --bootstrap-login --browser-channel chromium --no-headless

# Account B (used by monitor)
export PLAYWRIGHT_PROFILE_DIR_MONITOR=".playwright_profile/fb_account_b"
bash scripts/run_monitor.sh -- --bootstrap-login --browser-channel chromium --no-headless
```

### 2) Install systemd user units
```bash
mkdir -p ~/.config/systemd/user
cp infra/systemd/iaase-*.service infra/systemd/iaase-*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
```

### 3) Enable + start timers
```bash
systemctl --user enable --now iaase-discover.timer
systemctl --user enable --now iaase-monitor.timer
systemctl --user list-timers --all | grep iaase || true
```

## Common operations

### Re-login (session expired / blocked)
When the scraper detects a logged-out/blocked session, it writes a marker file:
- `scraper/.tmp/login_required.json`

Refresh the session for the right job/profile:
```bash
cd ~/Desktop/Projects/IphoneflipperScrapper/scraper
bash scripts/bootstrap_login.sh discover
bash scripts/bootstrap_login.sh monitor
```

### Restart runs (blocking)
```bash
systemctl --user restart iaase-discover.service
systemctl --user restart iaase-monitor.service
```

### Restart runs (non‑blocking)
```bash
systemctl --user restart --no-block iaase-discover.service
systemctl --user restart --no-block iaase-monitor.service
```

### Restart timers (schedule only)
```bash
systemctl --user restart iaase-discover.timer
systemctl --user restart iaase-monitor.timer
```

### Check status
```bash
systemctl --user status iaase-discover.service
systemctl --user status iaase-monitor.service
systemctl --user list-timers --all | grep iaase || true
```

### View logs
```bash
journalctl --user -u iaase-discover.service -n 200 --no-pager
journalctl --user -u iaase-monitor.service -n 200 --no-pager
journalctl --user -u iaase-discover.service -f
```

### Disable automation
```bash
systemctl --user disable --now iaase-discover.timer
systemctl --user disable --now iaase-monitor.timer
```

## Tuning schedule

Edit the timers (then reload):
```bash
nano ~/.config/systemd/user/iaase-discover.timer
nano ~/.config/systemd/user/iaase-monitor.timer
systemctl --user daemon-reload
```

Example values:
- Discover: `OnUnitActiveSec=30min`
- Monitor: `OnUnitActiveSec=60min`

## Manual runs (no systemd)

```bash
cd ~/Desktop/Projects/IphoneflipperScrapper/scraper
bash scripts/run_discover.sh
bash scripts/run_monitor.sh
bash scripts/run_compute_deals.sh
```

## Pending DB failures (replay)

```bash
node scraper/scripts/replay_pending.mjs
# or specify a file:
node scraper/scripts/replay_pending.mjs scraper/logs/pending-monitor-<run_id>.json
```

## .env knobs (common)

```env
DB_RETRY_COUNT=5
DB_RETRY_BASE_MS=2000
DISCOVER_MAX_CARDS=50
MONITOR_LIMIT=50

# Optional: reduce pattern + hammering
SCRAPE_RUN_JITTER_MAX_S=60
SCRAPE_MONITOR_START_DELAY_S=15
SCRAPE_GLOBAL_LOCK_WAIT_S=7200
LOGIN_REQUIRED_COOLDOWN_MINUTES=180
```

### Global lock (avoid overlap)
Discovery and monitor share a global lock file so they won't run at the same time (useful on slow networks and reduces FB automation spikes).

- Lock file: `scraper/.tmp/scrape-global.lock`
- Wait time: `SCRAPE_GLOBAL_LOCK_WAIT_S` (default `7200` seconds = 2 hours)
- Priority: monitor waits `SCRAPE_MONITOR_START_DELAY_S` (default `15` seconds) before trying to take the global lock, so discovery usually wins if both fire together (common after restarting timers).

## Telegram alerts (login required)

When the scraper detects a logged-out/blocked session it writes:
- `scraper/.tmp/login_required.json` (latest)
- `scraper/.tmp/login_required-discovery.json` / `scraper/.tmp/login_required-monitor.json`

To get Telegram alerts, set these in `scraper/.env`:
```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

Alerts are sent automatically by:
- `scraper/scripts/run_discover.sh`
- `scraper/scripts/run_monitor.sh`

## Paths to watch

- Logs: `scraper/logs/`
- systemd units: `~/.config/systemd/user/`
- Service templates: `infra/systemd/`
