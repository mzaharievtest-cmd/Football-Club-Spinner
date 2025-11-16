#!/usr/bin/env python3
"""
Recalculate primary_color for all teams in teams.json based on their logo image.

- teams.json je v rootu repozitorija
- logo_url pot je relativna do public/ ali do root-a (npr. 'logos1/vendor/...')

Uporaba (iz root folderja projekta):
    python3 .github/workflows/scripts/recalc_primary_colors.py
"""

import json
from pathlib import Path
from collections import Counter

from PIL import Image


# -------------------------------------------------
# Poti
# -------------------------------------------------

# Root repozitorija: .../footballspinner
REPO_ROOT = Path(__file__).resolve().parents[2]

# teams.json je v rootu
TEAMS_JSON = REPO_ROOT / "teams.json"

# glavni kandidati za statične slike
PUBLIC_DIR = REPO_ROOT / "public"


# -------------------------------------------------
# Helperji
# -------------------------------------------------

def resolve_logo_path(logo_url: str) -> Path | None:
    """
    Poskusi najti datoteko loga na disku na nekaj tipičnih lokacijah.
    Vrne Path ali None, če ni najdeno.
    """
    candidates = [
        PUBLIC_DIR / logo_url,        # public/logos1/...
        REPO_ROOT / logo_url,        # logos1/... v rootu
    ]

    for p in candidates:
        if p.exists():
            return p

    print(f"[WARN] Logo file not found for '{logo_url}'")
    return None


def dominant_color(image: Image.Image) -> tuple[int, int, int] | None:
    """
    Zelo enostaven izračun dominantne barve:
    - resize na 64x64
    - ignoriramo popolnoma bele in skoraj prozorne pixle
    - vzamemo najpogostejšo (R,G,B) kombinacijo
    """
    # convert to RGBA (da imamo alpha channel)
    img = image.convert("RGBA")
    img = img.resize((64, 64))

    pixels = list(img.getdata())
    counter = Counter()

    for r, g, b, a in pixels:
        # ignoriraj zelo prozorne pixle
        if a < 10:
            continue
        # ignoriraj skoraj bele pixle (background)
        if r > 245 and g > 245 and b > 245:
            continue
        counter[(r, g, b)] += 1

    if not counter:
        return None

    (r, g, b), _ = counter.most_common(1)[0]
    return (r, g, b)


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    """(R,G,B) -> '#RRGGBB'"""
    r, g, b = rgb
    return f"#{r:02X}{g:02X}{b:02X}"


# -------------------------------------------------
# Glavni workflow
# -------------------------------------------------

def main():
    if not TEAMS_JSON.exists():
        raise SystemExit(f"[ERROR] teams.json not found at: {TEAMS_JSON}")

    print(f"[INFO] Loading teams from {TEAMS_JSON}")
    with open(TEAMS_JSON, "r", encoding="utf-8") as f:
        teams = json.load(f)

    updated = 0
    skipped = 0

    for team in teams:
        name = team.get("team_name", "UNKNOWN")
        logo_url = team.get("logo_url")

        if not logo_url:
            print(f"[WARN] {name}: no logo_url, skipping")
            skipped += 1
            continue

        logo_path = resolve_logo_path(logo_url)
        if logo_path is None:
            skipped += 1
            continue

        try:
            with Image.open(logo_path) as img:
                dom = dominant_color(img)
        except Exception as e:
            print(f"[ERROR] {name}: failed to process '{logo_path}': {e}")
            skipped += 1
            continue

        if dom is None:
            print(f"[WARN] {name}: no dominant color found, skipping")
            skipped += 1
            continue

        hex_color = rgb_to_hex(dom)
        old_color = team.get("primary_color")
        team["primary_color"] = hex_color

        print(f"[OK] {name}: {old_color} -> {hex_color}")
        updated += 1

    # overwrite teams.json z novimi barvami
    with open(TEAMS_JSON, "w", encoding="utf-8") as f:
        json.dump(teams, f, ensure_ascii=False, indent=2)

    print()
    print(f"[DONE] Updated {updated} teams, skipped {skipped}")
    print(f"[INFO] Written back to {TEAMS_JSON}")


if __name__ == "__main__":
    main()
