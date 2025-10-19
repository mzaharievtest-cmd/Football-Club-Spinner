#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_players_json.py

Fetch ONLY Premier League (competition=PL) players registered for the 2025/26
season from the official PulseLive API (premierleague.com backend), and write a
tidy JSON: [{name, club, number, pos, season}].

Key fix:
- Filter players by currentTeam.id ∈ {teams that belong to PL in compSeason 2025/26}.
  This prevents non-PL players sneaking in.

Usage:
  python3 scripts/generate_players_json.py --out data/players.json
"""

from __future__ import annotations

import json
import time
import random
import argparse
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Set

import requests


BASE = "https://footballapi.pulselive.com/football"
SEASON_LABEL = "2025/26"
COMPETITION_ID = 1        # Premier League
COMP_CODE = "EN_PR"       # Defensive; not strictly required but fine to send

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Origin": "https://www.premierleague.com",
    "Referer": "https://www.premierleague.com/",
    "Accept": "application/json",
}
SESSION = requests.Session()
SESSION.headers.update(HEADERS)


# ---------- helpers ----------

def jitter(min_ms=60, max_ms=140):
    time.sleep(random.uniform(min_ms/1000.0, max_ms/1000.0))


def get_json(url: str, params: Dict[str, Any] | None = None, max_retries: int = 4) -> Any:
    attempt = 0
    while True:
        try:
            r = SESSION.get(url, params=params, timeout=25)
            if r.status_code in (429, 502, 503, 504):
                attempt += 1
                if attempt > max_retries:
                    r.raise_for_status()
                time.sleep(min(1.5 ** attempt, 10.0))
                continue
            r.raise_for_status()
            return r.json()
        except requests.RequestException:
            attempt += 1
            if attempt > max_retries:
                raise
            time.sleep(0.8 * attempt + random.random() * 0.5)


def normalize_listish(data: Any, preferred_keys: Tuple[str, ...]) -> List[Dict[str, Any]]:
    """Return first list-of-dicts found under given keys or the value itself if it's already a list."""
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if isinstance(data, dict):
        for k in preferred_keys:
            v = data.get(k)
            if isinstance(v, list) and (not v or isinstance(v[0], (dict,))):
                return [x for x in v if isinstance(x, dict)]
        # fallback: first list-of-dicts anywhere
        for v in data.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return v
    return []


# ---------- season & teams ----------

def find_season_id(label_want: str = SEASON_LABEL) -> int:
    url = f"{BASE}/competitions/{COMPETITION_ID}/compseasons"
    data = get_json(url)
    items = normalize_listish(data, ("content", "compSeasons", "seasons", "data"))
    # exact match on label/name/abbr
    for s in items:
        lab = s.get("label") or s.get("name") or s.get("abbr")
        if lab == label_want:
            return int(s["id"])
    # nested detail fallback
    for s in items:
        details = s.get("compSeason") or s.get("season") or {}
        lab = (isinstance(details, dict) and (details.get("label") or details.get("name"))) or None
        if lab == label_want:
            return int(s.get("id") or details.get("id"))
    labels = []
    for s in items:
        labels.append(
            s.get("label") or s.get("name") or s.get("abbr")
            or ((s.get("compSeason") or {}).get("label"))
            or ((s.get("season") or {}).get("label"))
        )
    raise RuntimeError(f"Season '{label_want}' not found. Saw labels: {sorted(set([x for x in labels if x]))}")


def fetch_pl_team_map(season_id: int) -> Dict[int, str]:
    """
    Return {team_id: team_name} for clubs competing in PL for compSeason=season_id.
    API: /competitions/{id}/compseasons/{season_id}/teams
    """
    url = f"{BASE}/competitions/{COMPETITION_ID}/compseasons/{season_id}/teams"
    data = get_json(url)
    items = normalize_listish(data, ("content", "teams", "data"))
    team_map: Dict[int, str] = {}
    for t in items:
        try:
            tid = int(t.get("id") or t.get("team", {}).get("id"))
        except Exception:
            continue
        # name may be in multiple places
        name = (
            t.get("name")
            or (t.get("team") or {}).get("name")
            or (t.get("club") or {}).get("name")
            or (t.get("label"))
        )
        if isinstance(name, str) and name.strip():
            team_map[tid] = name.strip()
    if not team_map:
        raise RuntimeError("No PL teams resolved for this season; team endpoint shape may have changed.")
    return team_map


# ---------- field extraction ----------

def pos_to_code(label: Optional[str]) -> Optional[str]:
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
    for key in ("displayName", "name", "label"):
        v = p.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    try:
        return p["name"]["display"].strip()
    except Exception:
        pass
    first = (p.get("firstName") or "").strip()
    last = (p.get("lastName") or "").strip()
    combo = (first + " " + last).strip()
    return combo or "Unknown"


def extract_club_and_id(p: Dict[str, Any]) -> Tuple[Optional[int], Optional[str]]:
    ct = p.get("currentTeam") or p.get("team") or {}
    tid = None
    tname = None
    if isinstance(ct, dict):
        if "id" in ct:
            try:
                tid = int(ct["id"])
            except Exception:
                pass
        # sometimes nested
        if tid is None and isinstance(ct.get("club"), dict) and "id" in ct["club"]:
            try:
                tid = int(ct["club"]["id"])
            except Exception:
                pass
        # names
        for k in ("name", "club", "label"):
            v = ct.get(k)
            if isinstance(v, str) and v.strip():
                tname = v.strip()
                break
        if not tname and isinstance(ct.get("club"), dict):
            v = ct["club"].get("name") or ct["club"].get("label")
            if isinstance(v, str) and v.strip():
                tname = v.strip()
    return tid, tname


def extract_number(p: Dict[str, Any]) -> Optional[str]:
    for k in ("shirtNum", "shirtNumber", "number"):
        v = p.get(k)
        if v is not None:
            return str(v)
    info = p.get("info")
    if isinstance(info, dict):
        v = info.get("shirtNum") or info.get("number")
        if v is not None:
            return str(v)
    return None


def extract_position_label(p: Dict[str, Any]) -> Optional[str]:
    info = p.get("info")
    if isinstance(info, dict):
        pos = info.get("position")
        if isinstance(pos, dict):
            lab = pos.get("label") or pos.get("name")
            if isinstance(lab, str) and lab.strip():
                return lab.strip()
    pos = p.get("position")
    if isinstance(pos, dict):
        lab = pos.get("label") or pos.get("name")
        if isinstance(lab, str) and lab.strip():
            return lab.strip()
    if isinstance(pos, str) and pos.strip():
        return pos.strip()
    return None


# ---------- main fetch ----------

def fetch_players_for_season_filtered(season_id: int, allowed_team_ids: Set[int], team_name_map: Dict[int, str]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    page = 0
    page_size = 100
    total = None

    while True:
        params = {
            "page": page,
            "pageSize": page_size,
            "compSeasons": season_id,
            "compCode": COMP_CODE,
        }
        data = get_json(f"{BASE}/players", params=params)
        items = normalize_listish(data, ("content", "players", "data"))
        if not items:
            break

        for p in items:
            tid, tname = extract_club_and_id(p)
            # **Critical filter**: only keep if the player's current team is one of the PL teams for this season
            if tid is None or tid not in allowed_team_ids:
                continue

            # prefer canonical team name from the map
            club = team_name_map.get(tid, tname)

            rec = {
                "name": extract_name(p),
                "club": club,
                "number": extract_number(p),
                "pos": pos_to_code(extract_position_label(p)),
                "season": "2025–26 Premier League",
            }
            out.append(rec)

        page += 1
        jitter()
        if isinstance(data, dict):
            total = data.get("total") or data.get("count") or total
            if total is not None and len(out) >= int(total):
                # Still keep looping because we filtered; but stop once a page comes back empty
                pass

    # De-dup by (name, club, number)
    seen: Set[Tuple[str, Optional[str], Optional[str]]] = set()
    uniq: List[Dict[str, Any]] = []
    for r in out:
        key = (r["name"], r.get("club"), r.get("number"))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(r)
    return uniq


def main():
    ap = argparse.ArgumentParser(description="Generate 2025/26 Premier League players (PL teams only).")
    ap.add_argument("--out", default="data/players.json", help="Output JSON path")
    args = ap.parse_args()

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Resolving compSeason for '{SEASON_LABEL}'…")
    season_id = find_season_id(SEASON_LABEL)
    print("season_id:", season_id)

    print("Fetching Premier League teams for that season…")
    team_map = fetch_pl_team_map(season_id)   # {team_id: name}
    allowed_ids = set(team_map.keys())
    print(f"PL teams resolved: {len(allowed_ids)}")

    print("Fetching players and filtering by PL teams…")
    players = fetch_players_for_season_filtered(season_id, allowed_ids, team_map)
    print(f"Kept {len(players)} players after PL-team filter. Writing file…")

    # sort for stability: club, number (numeric where possible), name
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
