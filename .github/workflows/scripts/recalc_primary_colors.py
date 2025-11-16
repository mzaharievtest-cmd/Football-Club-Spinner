#!/usr/bin/env python3
"""
Recalculate team primary_color values in teams.json using logo images.

Heuristics:
- Load each team's logo (logo_url)
- Crop away transparent borders AND an extra 15% margin to avoid outer rings
- Ignore transparent and near-white pixels
- Ignore low-saturation / very dark pixels (greys / blacks)
- Quantize colors to reduce noise
- Score each color by: score = count * saturation * brightness
- Pick the color with the highest score as primary_color
"""

from __future__ import annotations

import json
import sys
import colorsys
from pathlib import Path
from typing import Any

from PIL import Image

# ---------- Paths ----------

SCRIPT_DIR = Path(__file__).resolve().parent
# .github/workflows/scripts -> repo root is parents[3]
REPO_ROOT = SCRIPT_DIR.parents[3]

TEAMS_JSON = REPO_ROOT / "teams.json"


def find_logo_path(logo_url: str) -> Path:
    """
    Try a couple of common layouts:

    - <repo>/<logo_url>
    - <repo>/public/<logo_url>
    """
    cand1 = REPO_ROOT / logo_url
    cand2 = REPO_ROOT / "public" / logo_url

    if cand1.is_file():
        return cand1
    if cand2.is_file():
        return cand2

    # Fallback (will be reported as missing)
    return cand2


# ---------- Color helpers ----------

def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    r, g, b = rgb
    return "#{:02X}{:02X}{:02X}".format(r, g, b)


def is_near_white(r: int, g: int, b: int, threshold: int = 245) -> bool:
    return r >= threshold and g >= threshold and b >= threshold


def compute_dominant_color(image_path: Path) -> str | None:
    """
    Compute a 'team-like' dominant color of a logo image.

    Strategy:
    - Load RGBA, crop to non-transparent bounding box
    - Then crop away an extra ~15% border on all sides
      (to avoid outer rings / frames dominating)
    - Downscale to 64x64
    - Ignore:
        * transparent pixels
        * nearly white pixels (background)
        * low-saturation / very dark pixels
    - Bucket colors (quantized) and score each by:
          total_score = sum_over_pixels( saturation * (0.6 + 0.4 * value) )
      so saturated & bright colors win.
    """

    if not image_path.is_file():
        print(f"[WARN] Logo not found: {image_path}", file=sys.stderr)
        return None

    try:
        img = Image.open(image_path).convert("RGBA")
    except Exception as e:
        print(f"[WARN] Failed to open {image_path}: {e}", file=sys.stderr)
        return None

    # Crop to non-transparent content (if logo has alpha padding)
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)

    # Then crop away an extra margin to remove frames / outer rings
    w, h = img.size
    margin = int(min(w, h) * 0.15)  # 15% of min dimension
    if margin > 0 and (w - 2 * margin) > 0 and (h - 2 * margin) > 0:
        img = img.crop((margin, margin, w - margin, h - margin))

    # Downscale for speed & noise reduction
    img = img.resize((64, 64), Image.LANCZOS)

    buckets: dict[tuple[int, int, int], dict[str, float]] = {}

    def add_pixel(r: int, g: int, b: int, a: int, strict_white: bool) -> None:
        # transparency filter
        if a < 200:
            return
        # background white
        if strict_white and is_near_white(r, g, b):
            return

        # HSV for scoring
        h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)

        # Throw away greys / very dark
        if s < 0.25 or v < 0.20:
            return

        # Quantize to reduce noise (step 8)
        rq, gq, bq = (r // 8 * 8, g // 8 * 8, b // 8 * 8)

        # Score: saturated & bright colors win
        score = s * (0.6 + 0.4 * v)

        key = (rq, gq, bq)
        bucket = buckets.setdefault(key, {"count": 0, "score": 0.0})
        bucket["count"] += 1
        bucket["score"] += score

    # First pass: strict white exclusion
    for (r, g, b, a) in img.getdata():
        add_pixel(r, g, b, a, strict_white=True)

    # If we have nothing (e.g. very pale logo), relax white filter
    if not buckets:
        for (r, g, b, a) in img.getdata():
            add_pixel(r, g, b, a, strict_white=False)

    if not buckets:
        print(f"[WARN] No usable pixels found in {image_path}", file=sys.stderr)
        return None

    # Pick color with highest accumulated score
    best_key = max(buckets.items(), key=lambda kv: kv[1]["score"])[0]
    return rgb_to_hex(best_key)


# ---------- Main logic ----------

def load_teams() -> list[dict[str, Any]]:
    if not TEAMS_JSON.is_file():
        print(f"[ERROR] teams.json not found at: {TEAMS_JSON}", file=sys.stderr)
        sys.exit(1)

    with open(TEAMS_JSON, "r", encoding="utf-8") as f:
        return json.load(f)


def save_teams(teams: list[dict[str, Any]]) -> None:
    # Pretty print with stable key ordering
    with open(TEAMS_JSON, "w", encoding="utf-8") as f:
        json.dump(teams, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main() -> None:
    print(f"[INFO] Repo root: {REPO_ROOT}")
    print(f"[INFO] Loading teams from: {TEAMS_JSON}")

    teams = load_teams()
    updated = 0
    skipped = 0

    for team in teams:
        logo_url = team.get("logo_url")
        if not logo_url:
            skipped += 1
            continue

        logo_path = find_logo_path(logo_url)
        color = compute_dominant_color(logo_path)

        if color is None:
            skipped += 1
            continue

        old = team.get("primary_color")
        team["primary_color"] = color

        if old != color:
            updated += 1
            print(f"[UPDATE] {team.get('team_name')} ({team.get('league_code')}): {old} -> {color}")

    save_teams(teams)

    print(f"[DONE] Teams processed: {len(teams)}")
    print(f"[DONE] Colors updated: {updated}, skipped: {skipped}")


if __name__ == "__main__":
    main()
