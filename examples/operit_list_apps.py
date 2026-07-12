"""Minimal smoke script for the Operit Android Runtime adapter.

Usage:
    OPERIT_URL=http://127.0.0.1:8094 OPERIT_TOKEN=... python examples/operit_list_apps.py
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from corecoder.tools.android_remote import AndroidRemoteTool


def main():
    url = os.environ.get("OPERIT_URL")
    token = os.environ.get("OPERIT_TOKEN")
    if not url or not token:
        raise SystemExit("Set OPERIT_URL and OPERIT_TOKEN first.")

    tool = AndroidRemoteTool(base_url=url, bearer_token=token)
    print(tool.execute())


if __name__ == "__main__":
    main()
