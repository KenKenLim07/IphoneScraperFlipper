# Linux automation (systemd user timers)

This repo includes ready-made `systemd --user` units for running discovery + monitor on a schedule.

## 1) One-time: bootstrap login

Run once (headful) so the persistent profile in `PLAYWRIGHT_PROFILE_DIR` contains a valid Facebook session:

```bash
cd ~/Desktop/Projects/IphoneflipperScrapper/scraper
npm run sniffer:playwright-extra:discover -- --bootstrap-login --browser-channel chromium --no-headless
```

## 2) Install units

Copy units to your user systemd directory:

```bash
mkdir -p ~/.config/systemd/user
cp infra/systemd/iaase-*.service infra/systemd/iaase-*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
```

If your repo path is not `~/Desktop/Projects/IphoneflipperScrapper`, edit the `WorkingDirectory=` and `ExecStart=` lines in:

- `~/.config/systemd/user/iaase-discover.service`
- `~/.config/systemd/user/iaase-monitor.service`

## 3) Enable + start timers

```bash
systemctl --user enable --now iaase-discover.timer
systemctl --user enable --now iaase-monitor.timer
systemctl --user list-timers --all | grep iaase || true
```

## 4) Logs

Use journald:

```bash
journalctl --user -u iaase-discover.service -n 200 --no-pager
journalctl --user -u iaase-monitor.service -n 200 --no-pager
```

The scraper also writes JSON artifacts under `logs/` (for example `logs/discovery-<run_id>.json`).

## 5) Tuning

- Discover frequency: edit `infra/systemd/iaase-discover.timer` (`OnUnitActiveSec=...`)
- Monitor frequency: edit `infra/systemd/iaase-monitor.timer`
- Per-run limits:
  - Discovery: set `DISCOVER_MAX_CARDS` in `.env` (or edit `scripts/run_discover.sh`)
  - Monitor: set `MONITOR_LIMIT` in `.env` (or edit `scripts/run_monitor.sh`)

Notes:
- Units assume the scraper working directory is `~/Desktop/Projects/IphoneflipperScrapper/scraper` (update if different).
- Logs, profile, and other runtime folders live under `scraper/` when running via these units.
