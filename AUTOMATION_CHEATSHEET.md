# Automation Cheat Sheet (Systemd + Scraper)

## One‑time setup

### 1) Bootstrap login (Playwright session)
```bash
cd ~/Desktop/Projects/IphoneflipperScrapper/scraper
npm run sniffer:playwright-extra:discover -- --bootstrap-login --browser-channel chromium --no-headless
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
```

## Paths to watch

- Logs: `scraper/logs/`
- systemd units: `~/.config/systemd/user/`
- Service templates: `infra/systemd/`

systemctl --user status iaase-monitor.timer