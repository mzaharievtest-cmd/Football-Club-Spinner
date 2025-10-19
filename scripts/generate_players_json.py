#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_players_json.py

Fetch all registered players for the Premier League 2025/26 season directly
from the official PulseLive football API used by premierleague.com, and write
a tidy JSON with fields: name, club, number, pos, season.

Usage:
  python3 scripts/generate_players_json.py --out data/players.json

Notes:
- Requires: requests
- Works without scraping Wikipedia.
- Adds defensive handling for API payload shapes, pagination, and minor field
  inconsistencies (missing shirt numbers, missing currentTeam, etc.).
"""

from __future__ import annotations

import json
import time
import random
import argparse
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests


BASE = "https://footballapi.pulselive.com/football"
SEASON_LABEL = "2025/26"  # human label we search for
COMPETITION_ID = 1        # 1 = Premier League in PulseLive
COMP_CODE = "EN_PR"       # competition code for PL (defensive, but not strictly required)

# Headers are important; the API expects a browser-ish caller with PL origin.
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Origin": "https://www.premierleague.com",
    "Referer": "https://www.premierleague.com/",
    "Accept": "application/json",
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


# --------------- Utilities ---------------

def jitter(min_ms=60, max_ms=140):
    time.sleep(random.uniform(min_ms/1000.0, max_ms/1000.0))


def get_json(url: str, params: Dict[str, Any] | None = None, max_retries: int = 4) -> Any:
    """GET JSON with simple retry & polite delays (429/5xx)."""
    attempt = 0
    while True:
        try:
            r = SESSION.get(url, params=params, timeout=25)
            if r.status_code in (429, 502, 503, 504):
                attempt += 1
                if attempt > max_retries:
                    r.raise_for_status()
                backoff = min(1.5 ** attempt, 10.0)
                time.sleep(backoff)
                continue
            r.raise_for_status()
            return r.json()
        except requests.RequestException:
            attempt += 1
            if attempt > max_retries:
                raise
            time.sleep(0.8 * attempt + random.random() * 0.5)


def normalize_seasons_payload(data: Any) -> List[Dict[str, Any]]:
    """
    The /competitions/{id}/compseasons endpoint sometimes returns:
      - {"content": [ ... ]} OR {"compSeasons": [ ... ]} OR a raw list.
    Return a list of season dicts.
    """
    if isinstance(data, list):
        return [d for d in data if isinstance(d, dict)]
    if isinstance(data, dict):
        for key in ("content", "compSeasons", "seasons", "data"):
            val = data.get(key)
            if isinstance(val, list):
                return [d for d in val if isinstance(d, dict)]
        # fallback: maybe the dict itself is one season?
        return [data] if "id" in data else []
    return []


def find_season_id(label_want: str = SEASON_LABEL) -> int:
    """
    Resolve the numeric season ID for a human label like "2025/26".
    """
    url = f"{BASE}/competitions/{COMPETITION_ID}/compseasons"
    data = get_json(url)
    items = normalize_seasons_payload(data)
    if not items:
        raise RuntimeError(f"Unexpected season payload from {url}: type={type(data).__name__}")

    # Try exact label matches first
    for s in items:
        lab = s.get("label") or s.get("name") or s.get("abbr")
        if lab == label_want:
            return int(s["id"])

    # Fallback: try seasons that have a nested "label"
    for s in items:
        details = s.get("compSeason") or s.get("season") or {}
        lab = (isinstance(details, dict) and (details.get("label") or details.get("name"))) or None
        if lab == label_want:
            return int(s.get("id") or details.get("id"))

    # If nothing matched, show what we did have to help debug
    labels = []
    for s in items:
        labels.append(s.get("label") or s.get("name") or s.get("abbr") or
                      ((s.get("compSeason") or {}).get("label")) or
                      ((s.get("season") or {}).get("label")))
    raise RuntimeError(f"Season '{label_want}' not found. Available labels: {sorted(set([x for x in labels if x]))}")


def pos_to_code(label: Optional[str]) -> Optional[str]:
    """
    Map PulseLive position labels to GK/DF/MF/FW (or None).
    Common values observed: 'Goalkeeper', 'Defender', 'Midfielder', 'Forward'.
    """
    if not label:
        return None
    t = label.strip().lower()
    if "goalkeeper" in t or t == "gk":
        return "GK"
    if "defender" in t or t == "df" or "back" in t:
        return "DF"
    if "midfielder" in t or t == "mf" or "midfield" in t:
        return "MF"
    if "forward" in t or t == "fw" or "striker" in t or "winger" in t:
        return "FW"
    return None


def extract_name(p: Dict[str, Any]) -> str:
    """
    Prefer displayName; fallback to name fields.
    """
    for key in ("displayName", "name", "label", "altNames"):
        v = p.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, list) and v:
            return str(v[0]).strip()
    # Nested path used sometimes
    try:
        return p["name"]["display"].strip()
    except Exception:
        pass
    # Last resort: compose from first/last
    first = (p.get("firstName") or "").strip()
    last = (p.get("lastName") or "").strip()
    combo = (first + " " + last).strip()
    return combo or "Unknown"


def extract_club(p: Dict[str, Any]) -> Optional[str]:
    """
    Try currentTeam.name; fallback through plausible fields.
    """
    current = p.get("currentTeam") or p.get("team") or {}
    if isinstance(current, dict):
        for k in ("name", "club", "label"):
            v = current.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
        # Sometimes nested {club: {name: ...}}
        c2 = current.get("club")
        if isinstance(c2, dict):
            nm = c2.get("name") or c2.get("label")
            if isinstance(nm, str) and nm.strip():
                return nm.strip()
    # As a fallback, look at "teams" array and pick latest
    teams = p.get("teams")
    if isinstance(teams, list) and teams:
        latest = teams[0]
        nm = latest.get("name") if isinstance(latest, dict) else None
        if isinstance(nm, str) and nm.strip():
            return nm.strip()
    return None


def extract_number(p: Dict[str, Any]) -> Optional[str]:
    """
    Extract shirt number; keep as string to preserve formatting.
    """
    for k in ("shirtNum", "shirtNumber", "number", "altShirtNum"):
        v = p.get(k)
        if v is None:
            continue
        if isinstance(v, int):
            return str(v)
        if isinstance(v, str) and v.strip():
            return v.strip()
    # Sometimes number is nested under info
    info = p.get("info")
    if isinstance(info, dict):
        v = info.get("shirtNum") or info.get("number")
        if v is not None:
            return str(v)
    return None


def extract_position_label(p: Dict[str, Any]) -> Optional[str]:
    """
    Get human position label from various shapes: p['info']['position']['label'] etc.
    """
    # Common: p['info']['position']['label']
    info = p.get("info")
    if isinstance(info, dict):
        pos = info.get("position")
        if isinstance(pos, dict):
            lab = pos.get("label") or pos.get("name")
            if isinstance(lab, str) and lab.strip():
                return lab.strip()

    # Sometimes top-level 'position' is a string or dict
    pos = p.get("position")
    if isinstance(pos, dict):
        lab = pos.get("label") or pos.get("name")
        if isinstance(lab, str) and lab.strip():
            return lab.strip()
    if isinstance(pos, str) and pos.strip():
        return pos.strip()

    return None


def fetch_players_for_season(season_id: int) -> List[Dict[str, Any]]:
    """
    Use /football/players with compSeasons param and pagination.
    """
    out: List[Dict[str, Any]] = []
    page = 0
    page_size = 100  # PL API supports up to ~100 per page
    total = None

    while True:
        params = {
            "page": page,
            "pageSize": page_size,
            "compSeasons": season_id,
            "compCode": COMP_CODE,
        }
        data = get_json(f"{BASE}/players", params=params)
        # Normalize list of players
        items: List[Dict[str, Any]] = []
        if isinstance(data, dict):
            # observed shapes: {"content":[...], "pageInfo":{...}, "count":N, "total":M}
            if isinstance(data.get("content"), list):
                items = [x for x in data["content"] if isinstance(x, dict)]
                total = data.get("total") or data.get("count") or total
            elif isinstance(data.get("players"), list):
                items = [x for x in data["players"] if isinstance(x, dict)]
                total = data.get("total") or data.get("count") or total
            else:
                # Sometimes raw list inside other key; attempt to find first list of dicts
                for v in data.values():
                    if isinstance(v, list) and v and isinstance(v[0], dict):
                        items = v
                        break
        elif isinstance(data, list):
            items = [x for x in data if isinstance(x, dict)]

        if not items:
            break

        for p in items:
            name = extract_name(p)
            club = extract_club(p)
            number = extract_number(p)
            pos_label = extract_position_label(p)
            pos_code = pos_to_code(pos_label)
            out.append({
                "name": name,
                "club": club,
                "number": number,
                "pos": pos_code,
                "season": "2025–26 Premier League",
            })

        page += 1
        jitter()
        # Stop if we clearly paged past total (defensive)
        if total is not None and len(out) >= int(total):
            break

    # Deduplicate exact duplicates (same name+club+number) while keeping order
    seen: set[Tuple[str, Optional[str], Optional[str]]] = set()
    uniq: List[Dict[str, Any]] = []
    for r in out:
        key = (r["name"], r.get("club"), r.get("number"))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(r)
    return uniq


def main():
    ap = argparse.ArgumentParser(description="Generate Premier League 2025/26 players JSON from official API.")
    ap.add_argument("--out", default="data/players.json", help="Output JSON path (default: data/players.json)")
    args = ap.parse_args()

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print("Resolving season id for:", SEASON_LABEL)
    season_id = find_season_id(SEASON_LABEL)
    print("Season id:", season_id)

    print("Fetching players (this may take a few requests)…")
    players = fetch_players_for_season(season_id)
    print(f"Fetched {len(players)} players. Writing {out_path} …")

    # Sort for stable output: by club then number (as int if possible) then name
    def _num_key(v: Optional[str]) -> Tuple[int, str]:
        if v is None:
            return (9999, "")
        try:
            return (int(v), "")
        except Exception:
            return (9998, v)

    players.sort(key=lambda r: (
        (r.get("club") or "~~~"),
        _num_key(r.get("number")),
        (r.get("name") or "")
    ))

    out_path.write_text(json.dumps(players, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Done. Wrote {len(players)} players to {out_path}")


if __name__ == "__main__":
    main()
