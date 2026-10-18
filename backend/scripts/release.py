"""Snapshot engine/vibepro-audit into a versioned engine/<version>/ release."""
from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "engine" / "vibepro-audit"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="new semantic version, for example 1.1.0")
    args = parser.parse_args()
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", args.version):
        parser.error("version must be semantic, such as 1.1.0")
    if not (SOURCE / "SKILL.md").is_file():
        parser.error(f"engine source not found: {SOURCE}")
    destination = ROOT / "engine" / args.version
    if destination.exists():
        parser.error(f"release already exists: {destination}")
    shutil.copytree(SOURCE, destination, symlinks=False)
    print(f"Created engine release {args.version} at {destination}")
    print("The backend resolves VERSION=latest to the highest semantic version automatically.")


if __name__ == "__main__":
    main()
