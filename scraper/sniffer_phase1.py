#!/usr/bin/env python3
"""IAASE Phase 1 entrypoint."""

from __future__ import annotations

import sys

from iaase_sniffer.runner import main


if __name__ == "__main__":
    sys.exit(main())

