from __future__ import annotations

import argparse
import os
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="IAASE Phase 1 sniffer")
    parser.add_argument(
        "--bootstrap-login",
        action="store_true",
        help="Open Facebook in persistent profile and wait for manual login.",
    )
    parser.add_argument(
        "--max-cards",
        type=int,
        default=50,
        help="Maximum number of visible listing anchors to parse.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Extract and print rows without writing to Supabase.",
    )
    parser.add_argument(
        "--browser-channel",
        choices=["chromium", "chrome", "msedge"],
        default=None,
        help="Browser channel for Playwright persistent context (overrides env).",
    )
    parser.add_argument(
        "--use-stealth",
        action="store_true",
        help="Enable playwright-stealth injections (off by default for login stability).",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run scraping in headless mode (ignored for bootstrap login).",
    )
    return parser.parse_args()


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"Missing required environment variable: {name}")
    return value


def resolve_browser_channel(arg_value: str | None) -> str:
    if arg_value:
        return arg_value
    env_value = os.environ.get("PLAYWRIGHT_BROWSER_CHANNEL", "").strip().lower()
    if env_value in {"chromium", "chrome", "msedge"}:
        return env_value
    return "chrome"


def resolve_use_stealth(arg_enabled: bool) -> bool:
    if arg_enabled:
        return True
    env_value = os.environ.get("PLAYWRIGHT_USE_STEALTH", "").strip().lower()
    return env_value in {"1", "true", "yes", "on"}


def resolve_headless(arg_enabled: bool) -> bool:
    if arg_enabled:
        return True
    env_value = os.environ.get("PLAYWRIGHT_HEADLESS", "").strip().lower()
    return env_value in {"1", "true", "yes", "on"}


def resolve_detail_description_enabled() -> bool:
    env_value = os.environ.get("PLAYWRIGHT_DETAIL_DESCRIPTION_ENABLED", "true").strip().lower()
    return env_value in {"1", "true", "yes", "on"}


def resolve_detail_description_max_pages() -> int:
    raw = os.environ.get("PLAYWRIGHT_DETAIL_DESCRIPTION_MAX_PAGES", "8").strip()
    try:
        value = int(raw)
    except ValueError:
        return 8
    return max(0, min(value, 30))


def resolve_not_seen_deactivate_runs() -> int:
    raw = os.environ.get("PLAYWRIGHT_NOT_SEEN_DEACTIVATE_RUNS", "3").strip()
    try:
        value = int(raw)
    except ValueError:
        return 3
    return max(1, min(value, 20))


def resolve_watchlist_recheck_limit() -> int:
    raw = os.environ.get("PLAYWRIGHT_WATCHLIST_RECHECK_LIMIT", "8").strip()
    try:
        value = int(raw)
    except ValueError:
        return 8
    return max(0, min(value, 100))


def resolve_profile_dir(base_profile_dir: str, browser_channel: str) -> str:
    isolate_env = os.environ.get("PLAYWRIGHT_PROFILE_ISOLATE_BY_CHANNEL", "true").strip().lower()
    isolate_by_channel = isolate_env in {"1", "true", "yes", "on"}
    base_path = Path(base_profile_dir)
    if not isolate_by_channel:
        return str(base_path)
    if base_path.name.lower() == browser_channel:
        return str(base_path)
    return str(base_path / browser_channel)

