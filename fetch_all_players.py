#!/usr/bin/env python3
"""
Fetch / enrich player images.

Modes:
- File mode (--input-json): read players from that JSON file (list of objects),
  resolve images (by wikidata_id or name), download images to --out, write CSV to --csv
  and enriched players JSON to --json.

- Clubs/SPARQL mode (no --input-json): read teams.json, find EPL clubs and
  fetch players active in 2025/26 via SPARQL, resolve images by QID and save.

Example (file mode):
python3 fetch_all_players.py \
  --input-json /path/to/players.json \
  --out /path/to/out/dir \
  --width 800 \
  --csv /path/to/attribution.csv \
  --json /path/to/players_with_images.json \
  --max-total 40

Example (clubs mode):
python3 fetch_all_players.py --out player_images/EPL --per-club 2 --max-total 40
"""
from pathlib import Path
import argparse
import json
import time
import random
import requests

from player_images import (
    wikidata_id_for,
    player_image,
    player_image_by_qid,
    save_player_image,
    save_attributions,
)

SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
HEADERS = {"Accept": "application/sparql-results+json", "User-Agent": "player-images-batch/1.0 (footballspinner.com)"}

def _polite():
    time.sleep(random.uniform(0.08, 0.18))

def load_json(path):
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"{p} not found.")
    return json.loads(p.read_text(encoding="utf-8"))

def write_json(obj, path):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")

# SPARQL helpers
def players_active_2025_26_for_club(club_qid, limit=200):
    q = f"""
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX wikibase: <http://wikiba.se/ontology#>

SELECT ?player ?playerLabel WHERE {{
  ?player p:P54 ?stmt .
  ?stmt ps:P54 wd:{club_qid} .
  ?stmt wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)
  ?player wdt:P31 wd:Q5 .
  OPTIONAL {{ ?stmt pq:P580 ?start. }}
  OPTIONAL {{ ?stmt pq:P582 ?end. }}
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

def epl_clubs_from_teams(teams):
    clubs = []
    for t in teams:
        name = t.get("team_name") or t.get("name")
        code = (t.get("league_code") or "").upper()
        league = (t.get("league") or t.get("league_name") or "").lower()
        if name and (code == "EPL" or "premier" in league):
            clubs.append(name)
    return sorted(set(clubs))

# --- File-mode enrichment ---
def enrich_players_from_file(input_json, out_dir, width, csv_path=None, out_players_json=None, max_total=None):
    players = load_json(input_json)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    saved_records = []
    processed = 0

    print(f"Loaded {len(players)} player entries from {input_json}")

    for rec in players:
        if max_total and processed >= max_total:
            break
        name = rec.get("name") or rec.get("full_name") or rec.get("player_name")
        qid = rec.get("wikidata_id") or rec.get("qid")
        try:
            if qid:
                record = player_image_by_qid(qid, width=width)
            else:
                qid_search = wikidata_id_for(name) if name else None
                if qid_search:
                    record = player_image_by_qid(qid_search, width=width)
                else:
                    record = player_image(name, width=width)
        except Exception as e:
            print("Error resolving image for", name, ":", e)
            record = {"name": name, "qid": qid, "image_url": "/img/silhouette-player.png", "source": "fallback"}

        # download
        saved = save_player_image(record, out_dir=str(out_dir))
        record["_saved_path"] = str(saved) if saved else ""
        # merge into original rec for output JSON
        rec.update({
            "image_filename": record.get("filename"),
            "image_url": record.get("image_url"),
            "file_page": record.get("file_page"),
            "author": record.get("author"),
            "license": record.get("license"),
            "image_source": record.get("source"),
            "_saved_path": record.get("_saved_path")
        })
        saved_records.append({
            "name": record.get("name"),
            "qid": record.get("qid"),
            "filename": record.get("filename"),
            "file_page": record.get("file_page"),
            "author": record.get("author"),
            "license": record.get("license"),
            "source": record.get("source"),
            "image_url": record.get("image_url"),
            "_saved_path": record.get("_saved_path")
        })
        processed += 1
        if processed % 10 == 0:
            print(f"Processed {processed} players...")
        _polite()

    # write outputs
    if out_players_json:
        write_json(players, out_players_json)
        print("Wrote enriched players JSON to", out_players_json)
    if csv_path:
        save_attributions(saved_records, csv_path)
        print("Wrote attribution CSV to", csv_path)
    print("Done. Processed:", processed)
    return saved_records

# --- Clubs/SPARQL mode ---
def fetch_via_teams_and_sparql(teams_json, out_dir, width, csv_path=None, max_total=None, per_club=None):
    teams = load_json(teams_json)
    clubs = epl_clubs_from_teams(teams)
    out_dir = Path(out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    all_rows = []; total = 0
    print(f"Found {len(clubs)} EPL clubs in teams.json")

    for club in clubs:
        if max_total and total >= max_total:
            break
        qid = wikidata_id_for(club)
        if not qid:
            print("No QID for club", club); continue
        candidates = players_active_2025_26_for_club(qid, limit=200)
        n = 0
        for p in candidates:
            if per_club is not None and n >= per_club:
                break
            if max_total and total >= max_total:
                break
            player_qid = p["qid"]
            rec = player_image_by_qid(player_qid, width=width)
            rec["club"] = club; rec["league_code"] = "EPL"
            saved = save_player_image(rec, out_dir=str(out_dir))
            rec["_saved_path"] = str(saved) if saved else ""
            all_rows.append(rec)
            n += 1; total += 1
            _polite()
        print(f"Club {club}: saved {n} players")
    if csv_path:
        save_attributions(all_rows, csv_path)
    print("Done. total saved:", total)
    return all_rows

def main():
    parser = argparse.ArgumentParser(description="Fetch player images (file mode or clubs mode)")
    parser.add_argument("--input-json", help="Path to players.json to enrich (file mode)")
    parser.add_argument("--teams-json", default="teams.json", help="Path to teams.json (clubs mode)")
    parser.add_argument("--out", required=True, help="Output images directory")
    parser.add_argument("--width", type=int, default=800, help="Image width when requesting from Commons")
    parser.add_argument("--csv", help="Path to attribution CSV to write")
    parser.add_argument("--json", dest="out_json", help="Path to write enriched players JSON (only in file mode)")
    parser.add_argument("--per-club", type=int, default=5, help="Max players per club in clubs mode (use 0 or omit for all)")
    parser.add_argument("--max-total", type=int, default=None, help="Max total players to process")
    args = parser.parse_args()

    per_club = args.per_club if args.per_club and args.per_club > 0 else None

    if args.input_json:
        print("Running in file mode (enrich players.json)...")
        records = enrich_players_from_file(args.input_json, args.out, args.width, args.csv, args.out_json, max_total=args.max_total)  # call function directly
    else:
        print("Running in clubs/SPARQL mode (Premier League clubs from teams.json)...")
        records = fetch_via_teams_and_sparql(args.teams_json, args.out, args.width, args.csv, max_total=args.max_total, per_club=per_club)

if __name__ == "__main__":
    main()
