#!/usr/bin/env python3
import json
import os
from collections import Counter
from PIL import Image

TEAMS_JSON = "teams.json"  # path to your teams.json
LOGO_ROOT = "logos1/vendor"       # folder where "logos1/..." lives

# Optional manual overrides for special clubs (like Juventus, etc.)
OVERRIDES = {
    ("SA", "Juventus FC"): "#000000",
    ("EPL", "Chelsea FC"): "#034694",
    # add more tuples: (league_code, team_name): "#RRGGBB"
}


def hex_from_rgb(rgb):
    r, g, b = rgb
    return "#{:02X}{:02X}{:02X}".format(r, g, b)


def get_dominant_color(image_path):
    """
    Dominant, non-white, non-gray color from the logo.
    Returns "#RRGGBB" or None on failure.
    """
    try:
        img = Image.open(image_path).convert("RGBA")
    except Exception as e:
        print(f"[WARN] Cannot open {image_path}: {e}")
        return None

    # Shrink image → fewer pixels to analyze
    img = img.resize((64, 64), Image.LANCZOS)

    pixels = list(img.getdata())
    filtered = []

    for r, g, b, a in pixels:
        if a < 20:
            # Transparent → background, skip
            continue

        # Skip almost-white and almost-black
        if max(r, g, b) > 245:
            continue
        if max(r, g, b) < 15:
            continue

        # Skip “boring” grays (low saturation)
        if abs(r - g) < 10 and abs(g - b) < 10:
            continue

        filtered.append((r, g, b))

    if not filtered:
        # Fallback: just use all opaque pixels
        filtered = [(r, g, b) for r, g, b, a in pixels if a >= 20]
        if not filtered:
            return None

    counter = Counter(filtered)
    (r, g, b), _ = counter.most_common(1)[0]
    return hex_from_rgb((r, g, b))


def main():
    # Load teams
    with open(TEAMS_JSON, "r", encoding="utf-8") as f:
        teams = json.load(f)

    updated = 0
    skipped = 0

    for team in teams:
        league = team.get("league_code")
        name = team.get("team_name")
        key = (league, name)

        # 1) Manual override if we defined it
        if key in OVERRIDES:
            team["primary_color"] = OVERRIDES[key]
            print(f"[OVERRIDE] {league} {name} → {team['primary_color']}")
            updated += 1
            continue

        logo_rel = team.get("logo_url")
        if not logo_rel:
            print(f"[SKIP] No logo for {league} {name}")
            skipped += 1
            continue

        logo_path = os.path.join(LOGO_ROOT, logo_rel)

        if not os.path.exists(logo_path):
            print(f"[SKIP] Logo not found: {logo_path}")
            skipped += 1
            continue

        color = get_dominant_color(logo_path)
        if color is None:
            print(f"[SKIP] Could not detect color for {league} {name}")
            skipped += 1
            continue

        old = team.get("primary_color")
        team["primary_color"] = color
        print(f"[OK] {league} {name}: {old} → {color}")
        updated += 1

    print(f"\nDone. Updated: {updated}, skipped: {skipped}")

    # Write to a new file first (safety)
    out_path = "teams.recolored.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(teams, f, indent=2, ensure_ascii=False)

    print(f"Written updated data to: {out_path}")
    print("If everything looks fine, replace teams.json with this file.")


if __name__ == "__main__":
    main()
