"""
Fetch a small sample of active 2025/26 players from Premier League clubs.

This script:
- reads teams.json (to find Premier League clubs)
- for each club retrieves players whose P54 (member of sports team) statement
  has qualifiers indicating the membership overlaps the 2025/26 season
  (i.e. either no end date or end >= 2025-07-01, and either no start or start <= 2026-06-30)
- uses the player_images module to resolve image metadata and download images
- stops after `limit_total_players` (default 5) so you can validate quickly

Place this file next to player_images.py and teams.json and run:
  python fetch_all_players.py

Outputs:
- player_images/EPL/<downloaded files>
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
HEADERS = {
    "Accept": "application/sparql-results+json",
    "User-Agent": "player-images-batch/1.0 (mzaharievtest-cmd)"
}

def _polite_sleep():
    time.sleep(random.uniform(0.08, 0.18))

def load_teams(path="teams.json"):
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"{p} not found. Place teams.json next to this script.")
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)

def premier_league_clubs(teams):
    """
    Return sorted list of club names that are in the Premier League.
    Accepts either league_code == 'EPL' or league name containing 'premier'.
    """
    clubs = set()
    for t in teams:
        code = (t.get("league_code") or "").upper()
        lname = (t.get("league") or t.get("league_name") or "").lower()
        name = t.get("team_name") or t.get("name")
        if not name:
            continue
        if code == "EPL" or "premier" in lname:
            clubs.add(name)
    return sorted(clubs)

def players_for_club_qid_active(club_qid, limit=50):
    """
    Query Wikidata SPARQL for players who have P54 = club_qid and whose membership
    qualifiers overlap the 2025/26 season.

    Logic (approximate):
      - include if no end qualifier (pq:P582) OR end >= 2025-07-01
      - include if no start qualifier (pq:P580) OR start <= 2026-06-30

    Returns list of dicts: [{'qid': 'Qxxx', 'label': 'Player Name'}, ...]
    """
    query = f"""
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>

SELECT ?player ?playerLabel ?start ?end WHERE {{
  ?player p:P54 ?stmt .
  ?stmt ps:P54 wd:{club_qid} .
  ?player wdt:P31 wd:Q5 .
  OPTIONAL {{ ?stmt pq:P580 ?start. }}
  OPTIONAL {{ ?stmt pq:P582 ?end. }}
  # include if membership covers (or overlaps) the 2025/26 season window:
  FILTER( !bound(?end) || ?end >= "2025-07-01T00:00:00Z"^^xsd:dateTime )
  FILTER( !bound(?start) || ?start <= "2026-06-30T23:59:59Z"^^xsd:dateTime )
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

def fetch_premier_active_sample(out_root="player_images", teams_path="teams.json", limit_total_players=5):
    """
    Fetch up to `limit_total_players` images for active (2025/26) players
    from Premier League clubs listed in teams.json.
    """
    teams = load_teams(teams_path)
    clubs = premier_league_clubs(teams)
    out_root = Path(out_root)
    out_root.mkdir(parents=True, exist_ok=True)
    all_records = []
    processed = 0

    print(f"Found {len(clubs)} Premier League clubs (using teams.json). Will process up to {limit_total_players} players.\n")

    for club in clubs:
        if processed >= limit_total_players:
            break
        print(f"-- Club: {club}")
        club_qid = wikidata_id_for(club)
        print("  club qid:", club_qid)
        if not club_qid:
            print("  -> club QID not found; skipping club.")
            continue

        try:
            players = players_for_club_qid_active(club_qid, limit=20)
        except Exception as e:
            print("  SPARQL error for club", club, e)
            continue

        print(f"  active players found (sample): {len(players)}")
        for p in players:
            if processed >= limit_total_players:
                break
            name = p["label"]
            print("    player:", name)
            # use the label from SPARQL; if you prefer exact QID resolution we can extend player_images with a qid-based function
            rec = player_image(name, width=800)
            rec['league_code'] = "EPL"
            rec['club'] = club
            print("      source:", rec.get("source"), "->", rec.get("image_url"))
            saved_path = save_player_image(rec, out_dir=str(out_root / "EPL"))
            print("      saved:", saved_path)
            rec['_saved_path'] = str(saved_path) if saved_path else ""
            all_records.append(rec)
            processed += 1
            _polite_sleep()

    csv_path = out_root / "attribution.csv"
    save_attributions(all_records, csv_path=str(csv_path))
    print("\nDone. Processed:", processed, "— attribution CSV written to:", csv_path)
    return all_records

if __name__ == "__main__":
    # Quick test: only 5 players in total from Premier League clubs
    fetch_premier_active_sample(out_root="player_images", teams_path="teams.json", limit_total_players=5)
