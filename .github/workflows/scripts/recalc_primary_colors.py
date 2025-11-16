import colorsys
from collections import Counter

def compute_dominant_color(image_path: Path) -> str | None:
    """
    Compute a 'team-like' dominant color of a logo image.

    Heuristics:
    - Ignore transparent / semi-transparent pixels
    - Ignore near-white background
    - Prefer highly saturated, reasonably bright colors
      (team accents) over dull, muddy ones.
    """

    if not image_path.is_file():
        print(f"[WARN] Logo not found: {image_path}", file=sys.stderr)
        return None

    try:
        img = Image.open(image_path).convert("RGBA")
    except Exception as e:
        print(f"[WARN] Failed to open {image_path}: {e}", file=sys.stderr)
        return None

    # Crop to non-transparent bounding box to remove big empty margins
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)

    img = img.resize((64, 64), Image.LANCZOS)

    # (r_q, g_q, b_q) -> { "count": int, "score": float }
    buckets: dict[tuple[int, int, int], dict[str, float]] = {}

    def add_pixel(r, g, b, a, strict_white=True):
        # transparency filter
        if a < 200:
            return
        # almost-white background filter
        if strict_white and is_near_white(r, g, b):
            return

        # quantize to reduce noise (step 8)
        rq, gq, bq = (r // 8 * 8, g // 8 * 8, b // 8 * 8)

        # HSV for scoring
        h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)

        # ignore very desaturated (greys) and very dark pixels
        if s < 0.25 or v < 0.20:
            return

        score = s * (0.6 + 0.4 * v)  # saturated & bright wins

        key = (rq, gq, bq)
        if key not in buckets:
            buckets[key] = {"count": 0, "score": 0.0}
        buckets[key]["count"] += 1
        buckets[key]["score"] += score

    # 1st pass: strict white filtering
    for (r, g, b, a) in img.getdata():
        add_pixel(r, g, b, a, strict_white=True)

    # if nothing survived (e.g. very white logo), relax white filter
    if not buckets:
        for (r, g, b, a) in img.getdata():
            add_pixel(r, g, b, a, strict_white=False)

    if not buckets:
        print(f"[WARN] No usable pixels found in {image_path}", file=sys.stderr)
        return None

    # pick color with highest "score"
    best_key = max(buckets.items(), key=lambda kv: kv[1]["score"])[0]
    return rgb_to_hex(best_key)
