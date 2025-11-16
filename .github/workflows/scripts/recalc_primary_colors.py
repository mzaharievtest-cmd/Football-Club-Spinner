#!/usr/bin/env python3
"""
Recalculate `primary_color` for every entry in teams.json
based on the dominant color of its logo image.

Usage (from repo root):

    python3 .github/workflows/scripts/recalc_primary_colors.py

Assumptions:
- This file lives at: .github/workflows/scripts/recalc_primary_colors.py
- Repo layout:
    .
    ├── teams.json
    ├── public/
    │   └── logos1/...
    └── .github/
        └── workflows/scripts/recalc_primary_colors.py

If your logos are NOT under public/, change LOGO_ROOT below.
"""

import json
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[2]  # ../../ from scripts/ -> workflows/ -> .github/ -> root

TEAMS_JSON = REPO_ROOT / "teams.json"

# Logos in teams.json are like "logos1/vendor/England - Premier League/Arsenal FC.png"
# In the repo they usually live under public/logos1/...
# If in your project they're directly in the root, change this to REPO_ROOT.
LOGO_ROOT = REPO_ROOT / "public"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def rgb_to_hex(rgb):
    r, g, b = rgb
    return f"#{r:02X}{g:02X}{b:02X}"


def is_near_white(r, g, b, threshold=245):
    """Treat almost-white as background to avoid white borders."""
    return r >= threshold and g >= threshold and b >= threshold


def is_near_grey(r, g, b, tolerance=8):
    """Check if color is roughly grey (all channels similar)."""
    return max(r, g, b) - min(r, g, b) <= tolerance


def compute_dominant_color(image_path: Path) -> str | None:
    """
    Compute dominant color of a logo image, ignoring:
    - fully or mostly transparent pixels
    - almost-white background
    Returns hex string like "#RRGGBB" or None on failure.
    """
    if not image_path.is_file():
        print(f"[WARN] Logo not found: {image_path}", file=sys.stderr)
        return None

    try:
        img = Image.open(image_path).convert("RGBA")
    except Exception as e:
        print(f"[WARN] Failed to open {image_path}: {e}", file=sys.stderr)
        return None

    # Auto-crop to non-transparent bounding box to get rid of large empty borders
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)

    # Resize to reduce noise and speed up
    img = img.resize((64, 64), Image.LANCZOS)

    pixels = []
    for (r, g, b, a) in img.getdata():
        # Ignore transparent / semi-transparent pixels
        if a < 200:
            continue
        # Ignore almost-white (background)
        if is_near_white(r, g, b):
            continue
        pixels.append((r, g, b))

    # If everything got filtered (e.g. mostly white logo), relax filters a bit
    if not pixels:
        for (r, g, b, a) in img.getdata():
            if a < 128:
                continue
            pixels.append((r, g, b))

    if not pixels:
        print(f"[WARN] No usable pixels found in {image_path}", file=sys.stderr)
        return None

    counter = Counter(pixels)
    # Most common color overall
    dominant_rgb, _ = counter.most_common(1)[0]

    return rgb_to_hex(dominant_rgb)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    print(f"[INFO] Repo root: {REPO_ROOT}")
    print(f"[INFO] Loading teams from: {TEAMS_JSON}")

    if not TEAMS_JSON.is_file():
        print(f"[ERROR] teams.json not found at: {TEAMS_JSON}", file=sys.stderr)
        sys.exit(1)

    with TEAMS_JSON.open("r", encoding="utf-8") as f:
        try:
            teams = json.load(f)
        except json.JSONDecodeError as e:
            print(f"[ERROR] Failed to parse teams.json: {e}", file=sys.stderr)
            sys.exit(1)

    updated = 0
    skipped_missing_logo = 0
    skipped_error = 0

    for entry in teams:
        logo_rel = entry.get("logo_url")
        if not logo_rel:
            skipped_missing_logo += 1
            continue

        # Try under LOGO_ROOT first (e.g. public/logos1/...)
        path1 = LOGO_ROOT / logo_rel
        # Also allow path relative to repo root in case structure differs
        path2 = REPO_ROOT / logo_rel

        if path1.is_file():
            logo_path = path1
        elif path2.is_file():
            logo_path = path2
        else:
            print(f"[WARN] Logo file not found for team '{entry.get('team_name')}' at "
                  f"{path1} or {path2}", file=sys.stderr)
            skipped_missing_logo += 1
            continue

        new_color = compute_dominant_color(logo_path)
        if not new_color:
            skipped_error += 1
            continue

        old_color = entry.get("primary_color")
        if old_color != new_color:
            print(
                f"[UPDATE] {entry.get('league_code')} - {entry.get('team_name')}: "
                f"{old_color} -> {new_color}"
            )
            entry["primary_color"] = new_color
            updated += 1

    # Write back teams.json (pretty-printed, with final newline)
    with TEAMS_JSON.open("w", encoding="utf-8") as f:
        json.dump(teams, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(
        f"[DONE] Updated colors for {updated} teams. "
        f"Skipped (no logo): {skipped_missing_logo}, "
        f"Skipped (errors): {skipped_error}"
    )


if __name__ == "__main__":
    main()
