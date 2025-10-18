"""
Fetch active 2025/26 Premier League players' images (QID-based lookup).

This is the corrected version: the SPARQL now binds the statement rank with
'?stmt wikibase:rank ?rank .' and filters by that bound variable (avoids the
invalid FILTER(wikibase:rank(?stmt) ...) usage).

Drop this file next to your player_images.py and teams.json and run:
  python fetch_all_players.py --per-club 1 --max-total 5

Defaults are conservative for testing; change CLI args to expand the run.
"""
import argparse
import json
import time
import random
from pathlib import Path
import requests

from player_images import (
    wikidata_id_for,
    player_image_by_qid,
    save_player_image,
    save_attributions,
)

SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
HEADERS = {
    "Accept": "application/sparql-results+json",
    "User-Agent": "player-images-batch/1.0 (footballspinner.com)"
}

def _polite(): time.sleep(random.uniform(0.08, 0.18))

def load_teams(path="teams.json"):
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"{p} not found.")
    return json.loads(p.read_text(encoding="utf-8"))

def epl_clubs(teams):
    clubs = []
    for t in teams:
        name = t.get("team_name") or t.get("name")
        code = (t.get("league_code") or "").upper()
        league = (t.get("league") or t.get("league_name") or "").lower()
        if name and (code == "EPL" or "premier" in league):
            clubs.append(name)
    return sorted(set(clubs))

def players_active_2025_26(club_qid, limit=200):
    """
    SPARQL: select players with P54 statements for the club where the statement
    has rank != DeprecatedRank and membership qualifiers overlap the 2025/26 window.
    """
    q = f"""
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX wikibase: <http://wikiba.se/ontology#>

SELECT ?player ?playerLabel ?start ?end ?rank WHERE {{
  ?player p:P54 ?stmt .
  ?stmt ps:P54 wd:{club_qid} .
  ?stmt wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)
  ?player wdt:P31 wd:Q5 .
  OPTIONAL {{ ?stmt pq:P580 ?start. }}
  OPTIONAL {{ ?stmt pq:P582 ?end. }}
  # membership must overlap 2025/07/01 .. 2026/06/30
  FILTER( !BOUND(?end)   || ?end  >= "2025-07-01T00:00:00Z"^^xsd:dateTime )
  FILTER( !BOUND(?start) || ?start <= "2026-06-30T23:59:59Z"^^xsd:dateTime )
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
LIMIT {limit}
"""
    _polite()
    r = requests.get(SPARQL_ENDPOINT, params={"query": q}, headers=HEADERS, timeout=90)
    r.raise_for_status()
    res = []
    for b in r.json().get("results", {}).get("bindings", []):
        uri = b["player"]["value"]
        label = b.get("playerLabel", {}).get("value")
        res.append({"qid": uri.rsplit("/", 1)[-1], "label": label})
    return res

def fetch_sample(out_dir="player_images/EPL", teams_path="teams.json", per_club=5, max_total=None):
    teams = load_teams(teams_path)
    clubs = epl_clubs(teams)
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    all_rows = []
    total = 0

    print(f"Premier League clubs: {len(clubs)}. target per club: {per_club}, max total: {max_total}\n")
    for club in clubs:
        if max_total and total >= max_total:
            break
        club_qid = wikidata_id_for(club)
        print(f"== {club} :: {club_qid} ==")
        if not club_qid:
            print("  (no QID)"); continue

        try:
            players = players_active_2025_26(club_qid, limit=200)
        except Exception as e:
            print("  SPARQL error for club", club, e)
            continue

        print(f"  candidates: {len(players)}")
        n = 0
        for p in players:
            if per_club is not None and n >= per_club:
                break
            if max_total and total >= max_total:
                break
            qid = p["qid"]; label = p.get("label") or qid
            rec = player_image_by_qid(qid, width=800)
            rec["club"] = club
            rec["league_code"] = "EPL"
            print(f"  - {label} [{rec['source']}] -> {rec['image_url']}")
            path = save_player_image(rec, out_dir=str(out))
            rec["_saved_path"] = str(path) if path else ""
            all_rows.append(rec)
            n += 1; total += 1
            _polite()

    csv_path = Path(out_dir).parent / "attribution.csv"
    save_attributions(all_rows, csv_path=str(csv_path))
    print(f"\nDone. Players: {total}. Images in {out}. CSV: {csv_path}")
    return all_rows

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch active 2025/26 EPL players' images")
    parser.add_argument("--out", default="player_images/EPL", help="output directory")
    parser.add_argument("--teams", default="teams.json", help="teams.json path")
    parser.add_argument("--per-club", type=int, default=5, help="max players per club (set 0 or omit for all)")
    parser.add_argument("--max-total", type=int, default=None, help="max total players across all clubs")
    args = parser.parse_args()

    per_club = args.per_club if args.per_club and args.per_club > 0 else None
    fetch_sample(out_dir=args.out, teams_path=args.teams, per_club=per_club, max_total=args.max_total)
