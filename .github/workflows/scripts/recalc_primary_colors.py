#!/usr/bin/env python3
"""
Recalculate primary_color for each team in teams.json by sampling its logo.

Usage:
    python3 .github/workflows/scripts/recalc_primary_colors.py
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Tuple, Optional

from PIL import Image


# project root = two levels above this script: .github/workflows/scripts/...
ROOT = Path(__file__).resolve().parents[2]
TEAMS_JSON = ROOT / "teams.json"


def rgb_to_hex(rgb: Tuple[int, int, int]) -> str:
    r, g, b = rgb
    return "#{:02X}{:02X}{:02X}".format(r, g, b)


def is_near_white(r: int, g: int, b: int) -> bool:
    # Treat very bright pixels as white-ish (badge backgrounds)
    return r > 240 and g > 240 and b > 240


def is_transparent(a: int) -> bool:
    return a < 10


def load_logo(path: Path) -> Optional[Image.Image]:
    if not path.is_file():
        print(f"[WARN] Logo not found: {path}")
        return None
    try:
        img = Image.open(path).convert("RGBA")
        # small, but enough for statistics
        img.thumbnail((256, 256), Image.LANCZOS)
        return img
    except Exception as e:
        print(f"[WARN] Failed to load {path}: {e}")
        return None


def dominant_color_from_logo(path: Path) -> Optional[str]:
    img = load_logo(path)
    if img is None:
        return None

    w, h = img.size
    cx, cy = w / 2, h / 2
    radius = min(w, h) * 0.48  # ignore corners/edges

    pixels = img.load()
    counts: Counter[Tuple[int, int, int]] = Counter()

    # sample every second pixel to keep it fast
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            dx = x - cx
            dy = y - cy
            if dx * dx + dy * dy > radius * radius:
                continue  # outside central circle

            r, g, b, a = pixels[x, y]
            if is_transparent(a) or is_near_white(r, g, b):
                continue

            counts[(r, g, b)] += 1

    if not counts:
        return None

    # Most common non-white RGB
    (r, g, b), _ = counts.most_common(1)[0]
    return rgb_to_hex((r, g, b))


def process_teams() -> int:
    if not TEAMS_JSON.is_file():
        print(f"[ERROR] teams.json not found at: {TEAMS_JSON}")
        return 0

    print(f"[INFO] Loading teams from {TEAMS_JSON}")
    with TEAMS_JSON.open("r", encoding="utf-8") as f:
        teams = json.load(f)

    updated = 0

    for team in teams:
        logo_rel = team.get("logo_url")
        if not logo_rel:
            continue

        logo_path = ROOT / logo_rel
        old = team.get("primary_color") or "#000000"
        new_color = dominant_color_from_logo(logo_path)

        if not new_color:
            # keep old value if we couldn't calculate
            print(f"[SKIP] {team.get('team_name')}: unable to compute, keeping {old}")
            continue

        if new_color.upper() != old.upper():
            print(f"[OK] {team.get('team_name')}: {old} -> {new_color}")
            team["primary_color"] = new_color
            updated += 1
        else:
            # still nice to see progress when script is run
            print(f"[=] {team.get('team_name')}: unchanged {old}")

    with TEAMS_JSON.open("w", encoding="utf-8") as f:
        json.dump(teams, f, ensure_ascii=False, indent=2)

    print(f"\n[DONE] Updated {updated} teams")
    print(f"[INFO] Written back to {TEAMS_JSON}")
    return updated


def main() -> None:
    process_teams()


if __name__ == "__main__":
    main()
