# scripts/fetch_pl_players_official.py
import json, time, math, os
import requests
from pathlib import Path

BASE = "https://footballapi.pulselive.com/football"
HEADERS = {
    # These headers matter; the API rejects "generic" clients without Origin/Referer.
    "User-Agent": "Mozilla/5.0",
    "Origin": "https://www.premierleague.com",
    "Referer": "https://www.premierleague.com/",
    "Accept": "application/json",
}

OUT = Path("data/players.json")
OUT.parent.mkdir(parents=True, exist_ok=True)

def get_json(url, params=None):
    r = requests.get(url, params=params or {}, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()

def find_season_id(label_want="2025/26"):
    # competition 1 = Premier League
    data = get_json(f"{BASE}/competitions/1/compseasons")
    for s in data:
        lab = s.get("label") or s.get("name")
        if lab == label_want:
            return s["id"]
    raise RuntimeError(f"Season '{label_want}' not found. Got: {[s.get('label') for s in data]}")

def team_lookup(comp_season_id: int):
    # Build a map teamId -> teamName for the season
    # Large pageSize to avoid pagination
    params = {"compSeasons": comp_season_id, "comps": 1, "pageSize": 200}
    data = get_json(f"{BASE}/teams", params=params)
    teams = {}
    for t in data.get("content", []):
        teams[t["id"]] = t["name"]
    return teams

def fetch_all_players(comp_season_id: int):
    # The players endpoint is paginated
    page_size = 100
    params = {
        "pageSize": page_size,
        "compSeasons": comp_season_id,
        "comps": 1,            # Premier League
        "altIds": "true",
        "page": 0,
    }
    first = get_json(f"{BASE}/players", params=params)
    total = first.get("pageInfo", {}).get("numEntries", len(first.get("content", [])))
    pages = math.ceil(total / page_size)
    all_rows = first.get("content", [])
    for p in range(1, pages):
        params["page"] = p
        time.sleep(0.15)
        data = get_json(f"{BASE}/players", params=params)
        all_rows.extend(data.get("content", []))
    return all_rows

def normalize(players, team_by_id):
    out = []
    for p in players:
        info = p.get("info", {})
        name = " ".join([info.get("firstName",""), info.get("lastName","")]).strip() or p.get("name", "").strip()
        pos  = (info.get("position") or {}).get("label") or info.get("positionInfo")
        shirt = info.get("shirtNum")
        # current team can be on "currentTeam" or "team" field depending on endpoint version
        team_obj = p.get("currentTeam") or p.get("team") or {}
        team_id = team_obj.get("id")
        club = team_by_id.get(team_id) if team_id else team_obj.get("name")

        if not name:
            continue

        out.append({
            "name": name,
            "club": club,
            "number": str(shirt) if shirt is not None else None,
            "pos": pos,
            "season": "2025–26 Premier League"
        })
    # Filter obvious empties & duplicates
    seen = set()
    deduped = []
    for r in out:
        key = (r["name"], r.get("club"))
        if key in seen: 
            continue
        seen.add(key)
        deduped.append(r)
    return deduped

def main():
    season_id = find_season_id("2025/26")
    teams = team_lookup(season_id)
    players = fetch_all_players(season_id)
    result = normalize(players, teams)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(result)} players to {OUT} (season id {season_id})")

if __name__ == "__main__":
    main()
