"""
Fetch all players' images for clubs listed in teams.json using Wikidata + Commons.

Requirements:
- Python 3.8+
- requests
- player_images.py present in same folder (the module you already added)

Usage:
  python fetch_all_players.py

Outputs:
- player_images/<league_code>/<player_image files>
- player_images/attribution.csv
"""
import json
import time
import random
from pathlib import Path
import requests

# import the module you already installed in the repo
from player_images import (
    wikidata_id_for,
    player_image,
    save_player_image,
    save_attributions,
)

SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
HEADERS = {"Accept": "application/sparql-results+json", "User-Agent": "player-images-batch/1.0 (mzaharievtest-cmd)"}

# polite delay between external requests (additional to player_images' own delays)
def _polite_sleep():
    time.sleep(random.uniform(0.08, 0.25))

def load_teams(path="teams.json"):
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"{p} not found. Place teams.json next to this script.")
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)

def clubs_by_league(teams):
    """
    Expect teams to be a list of objects with fields including 'team_name' and 'league_code'.
    Returns dict: league_code -> set(club_names)
    """
    by = {}
    for t in teams:
        code = t.get("league_code") or t.get("league") or "UNKNOWN"
        name = t.get("team_name") or t.get("name")
        if not name: continue
        by.setdefault(code, set()).add(name)
    return by

def players_for_club_qid(club_qid):
    """
    Query Wikidata SPARQL for players who have P54 = club_qid.
    Returns list of dicts: [{'qid': 'Qxxx', 'label': 'Player Name'}, ...]
    Note: this returns all members (could include historical players). We don't filter by current only.
    """
    query = f"""
    SELECT ?player ?playerLabel WHERE {{
      ?player wdt:P54 wd:{club_qid} .
      ?player wdt:P31 wd:Q5 .
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }}
    """
    _polite_sleep()
    r = requests.get(SPARQL_ENDPOINT, params={"query": query}, headers=HEADERS, timeout=60)
    r.raise_for_status()
    data = r.json()
    results = []
    for binding in data.get("results", {}).get("bindings", []):
        player_uri = binding.get("player", {}).get("value")
        label = binding.get("playerLabel", {}).get("value")
        if not player_uri or not label:
            continue
        qid = player_uri.rsplit("/", 1)[-1]
        results.append({"qid": qid, "label": label})
    return results

def fetch_all_leagues(out_root="player_images", teams_path="teams.json", limit_players_per_club=None):
    teams = load_teams(teams_path)
    by_league = clubs_by_league(teams)
    out_root = Path(out_root)
    all_records = []

    for league_code, clubs in sorted(by_league.items()):
        print(f"\n=== League {league_code}: {len(clubs)} clubs ===")
        league_dir = out_root / league_code
        league_dir.mkdir(parents=True, exist_ok=True)

        for club in sorted(clubs):
            print(f"\n-- Club: {club}")
            # 1) find club QID
            club_qid = wikidata_id_for(club)
            print("  club qid:", club_qid)
            if not club_qid:
                print("  -> club QID not found; falling back to searching players by name is impractical. Skipping club.")
                continue

            # 2) get players via SPARQL
            try:
                players = players_for_club_qid(club_qid)
            except Exception as e:
                print("  SPARQL error for club", club, e)
                continue

            print(f"  players found: {len(players)}")
            if limit_players_per_club:
                players = players[:limit_players_per_club]

            for p in players:
                name = p["label"]
                print("    player:", name)
                # 3) resolve image record (this does the wikidata->commons lookup and metadata)
                rec = player_image(name, width=800)
                rec['league_code'] = league_code
                rec['club'] = club
                print("      source:", rec.get("source"), "->", rec.get("image_url"))
                # 4) save image under league folder
                saved_path = save_player_image(rec, out_dir=str(out_root / league_code))
                print("      saved:", saved_path)
                # attach path for attribution if needed
                rec['_saved_path'] = str(saved_path) if saved_path else ""
                all_records.append(rec)
                # be polite between player fetches
                _polite_sleep()

    # Save all attributions CSV
    csv_path = out_root / "attribution.csv"
    save_attributions(all_records, csv_path=str(csv_path))
    print("\nDone. Attribution CSV:", csv_path)
    return all_records

if __name__ == "__main__":
    # Example: run with a limit to test; set limit_players_per_club=None to fetch all
    records = fetch_all_leagues(out_root="player_images", teams_path="teams.json", limit_players_per_club=10)
    print(f"Total records: {len(records)}")
