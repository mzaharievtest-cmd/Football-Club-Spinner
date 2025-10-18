"""
Fetch a small sample of players' images for testing.

This is a trimmed version of the full pipeline that stops after
`limit_total_players` images have been processed (default: 5) so you can
verify the flow quickly.

Place this script next to player_images.py and teams.json, then run:
  python fetch_all_players.py

Outputs:
- player_images/<league_code>/<player image files>
- player_images/attribution.csv
"""
import json
import time
import random
from pathlib import Path
import requests

from player_images import (
    wikidata_id_for,
    player_image,
    save_player_image,
    save_attributions,
)

SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
HEADERS = {"Accept": "application/sparql-results+json", "User-Agent": "player-images-batch/1.0 (mzaharievtest-cmd)"}

def _polite_sleep():
    time.sleep(random.uniform(0.08, 0.18))

def load_teams(path="teams.json"):
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"{p} not found. Place teams.json next to this script.")
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)

def clubs_by_league(teams):
    by = {}
    for t in teams:
        code = t.get("league_code") or t.get("league") or "UNKNOWN"
        name = t.get("team_name") or t.get("name")
        if not name:
            continue
        by.setdefault(code, set()).add(name)
    return by

def players_for_club_qid(club_qid, limit=50):
    query = f"""
    SELECT ?player ?playerLabel WHERE {{
      ?player wdt:P54 wd:{club_qid} .
      ?player wdt:P31 wd:Q5 .
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }}
    LIMIT {limit}
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

def fetch_sample(out_root="player_images", teams_path="teams.json", limit_total_players=5):
    teams = load_teams(teams_path)
    by_league = clubs_by_league(teams)
    out_root = Path(out_root)
    out_root.mkdir(parents=True, exist_ok=True)
    all_records = []
    processed = 0

    for league_code, clubs in sorted(by_league.items()):
        if processed >= limit_total_players:
            break
        print(f"\n=== League {league_code}: {len(clubs)} clubs ===")
        league_dir = out_root / league_code
        league_dir.mkdir(parents=True, exist_ok=True)

        for club in sorted(clubs):
            if processed >= limit_total_players:
                break
            print(f"\n-- Club: {club}")
            club_qid = wikidata_id_for(club)
            print("  club qid:", club_qid)
            if not club_qid:
                print("  -> club QID not found; skipping club.")
                continue

            try:
                players = players_for_club_qid(club_qid, limit=20)
            except Exception as e:
                print("  SPARQL error for club", club, e)
                continue

            print(f"  players found (sample): {len(players)}")
            for p in players:
                if processed >= limit_total_players:
                    break
                name = p["label"]
                print("    player:", name)
                rec = player_image(name, width=800)
                rec['league_code'] = league_code
                rec['club'] = club
                print("      source:", rec.get("source"), "->", rec.get("image_url"))
                saved_path = save_player_image(rec, out_dir=str(out_root / league_code))
                print("      saved:", saved_path)
                rec['_saved_path'] = str(saved_path) if saved_path else ""
                all_records.append(rec)
                processed += 1
                _polite_sleep()

    csv_path = out_root / "attribution.csv"
    save_attributions(all_records, csv_path=str(csv_path))
    print("\nDone. Processed:", processed, "attributions written to:", csv_path)
    return all_records

if __name__ == "__main__":
    # Quick test: only 5 players in total
    fetch_sample(out_root="player_images", teams_path="teams.json", limit_total_players=5)
