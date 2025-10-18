# scripts/generate_players_json.py
# Build data/players.json with all players active in the 2025/26 Premier League.
# Strategy:
#   1) Try season item Q132674557 to collect teams (via P1923 and P1344).
#   2) If none found, fall back to teams.json (your EPL club names) and resolve QIDs.
#   3) For each team QID, select players with P54 membership overlapping 2025-07-01 .. 2026-06-30.
# Output: data/players.json  (array of { qid, name, club, season })

from __future__ import annotations
import argparse, json, pathlib, time, random
from typing import List, Dict, Any, Tuple

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

SEASON_QID = "Q132674557"  # 2025–26 Premier League (Wikidata)
ENDPOINT = "https://query.wikidata.org/sparql"
UA = "footballspinner-fetch/1.0 (players.json generator)"

# ------- HTTP session with retries -------
retry = Retry(
    total=3,
    backoff_factor=0.4,
    status_forcelist=[429, 500, 502, 503, 504],
    respect_retry_after_header=True,
)
session = requests.Session()
session.headers.update({"User-Agent": UA})
session.mount("https://", HTTPAdapter(max_retries=retry))
session.mount("http://", HTTPAdapter(max_retries=retry))

def _polite() -> None:
    time.sleep(random.uniform(0.08, 0.18))

def write_json(path: pathlib.Path, rows: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

# ------- Step 1: Teams from season (two modeling patterns) -------
def season_team_qids() -> List[str]:
    """
    Return team QIDs participating in the 2025–26 EPL season by either:
      - season (Q132674557) -> P1923 -> team
      - team -> P1344 -> season (Q132674557)
    """
    q = f"""
PREFIX wd:  <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
SELECT DISTINCT ?team WHERE {{
  {{ VALUES ?season {{ wd:{SEASON_QID} }} ?season wdt:P1923 ?team. }}
  UNION
  {{ VALUES ?season {{ wd:{SEASON_QID} }} ?team wdt:P1344 ?season. }}
}}
"""
    _polite()
    r = session.get(ENDPOINT, params={"query": q, "format": "json"}, timeout=90)
    r.raise_for_status()
    return [b["team"]["value"].rsplit("/", 1)[-1] for b in r.json()["results"]["bindings"]]

def labels_for_qids(qids: List[str]) -> Dict[str, str]:
    if not qids:
        return {}
    # Chunk to avoid very long VALUES
    out: Dict[str, str] = {}
    for i in range(0, len(qids), 40):
        chunk = qids[i : i + 40]
        q = f"""
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX wd:   <http://www.wikidata.org/entity/>
SELECT ?item ?label WHERE {{
  VALUES ?item {{ {' '.join('wd:'+q for q in chunk)} }}
  ?item rdfs:label ?label .
  FILTER(LANG(?label)='en')
}}
"""
        _polite()
        r = session.get(ENDPOINT, params={"query": q, "format": "json"}, timeout=90)
        r.raise_for_status()
        for b in r.json()["results"]["bindings"]:
            out[b["item"]["value"].rsplit("/", 1)[-1]] = b["label"]["value"]
    return out

# ------- Step 2 (fallback): Read clubs from teams.json and resolve QIDs -------
def teams_from_file(path: pathlib.Path) -> List[str]:
    if not path.exists():
        return []
    teams = json.loads(path.read_text(encoding="utf-8"))
    out: List[str] = []
    for t in teams:
        name = t.get("team_name") or t.get("name")
        code = (t.get("league_code") or "").upper()
        league = (t.get("league") or t.get("league_name") or "").lower()
        if name and (code == "EPL" or "premier" in league):
            out.append(name)
    return sorted(set(out))

def wbsearch_qid(label: str) -> str | None:
    """Resolve a human-readable club label to QID using Wikidata wbsearchentities."""
    _polite()
    r = session.get(
        "https://www.wikidata.org/w/api.php",
        params={
            "action": "wbsearchentities",
            "format": "json",
            "language": "en",
            "type": "item",
            "limit": 1,
            "search": label,
        },
        timeout=20,
    )
    r.raise_for_status()
    js = r.json()
    return js["search"][0]["id"] if js.get("search") else None

def resolve_club_qids_from_labels(labels: List[str]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for lbl in labels:
        qid = wbsearch_qid(lbl)
        if qid:
            out[qid] = lbl
    return out

# ------- Step 3: Players with P54 overlapping 2025/26 -------
def players_active_2025_26_for_club(club_qid: str, limit: int = 500) -> List[Tuple[str, str]]:
    """
    Return list of (player_qid, player_label) for people whose membership at club_qid
    overlaps 2025-07-01 .. 2026-06-30. Excludes deprecated statements.
    """
    q = f"""
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX wd:  <http://www.wikidata.org/entity/>
PREFIX p:   <http://www.wikidata.org/prop/>
PREFIX ps:  <http://www.wikidata.org/prop/statement/>
PREFIX pq:  <http://www.wikidata.org/prop/qualifier/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>

SELECT ?player ?playerLabel ?start ?end WHERE {{
  ?player p:P54 ?stmt .
  ?stmt ps:P54 wd:{club_qid} ;
        wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)

  OPTIONAL {{ ?stmt pq:P580 ?start. }}   # start time
  OPTIONAL {{ ?stmt pq:P582 ?end. }}     # end time

  FILTER( !BOUND(?end)   || ?end  >= "2025-07-01T00:00:00Z"^^xsd:dateTime )
  FILTER( !BOUND(?start) || ?start <= "2026-06-30T23:59:59Z"^^xsd:dateTime )

  ?player wdt:P31 wd:Q5 .                # human
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
LIMIT {limit}
"""
    _polite()
    r = session.get(ENDPOINT, params={"query": q, "format": "json"}, timeout=120)
    r.raise_for_status()
    rows = r.json()["results"]["bindings"]
    out: List[Tuple[str, str]] = []
    for b in rows:
        uri = b["player"]["value"]
        label = b.get("playerLabel", {}).get("value", "")
        out.append((uri.rsplit("/", 1)[-1], label))
    return out

# ------- Orchestration -------
def build_players_json(teams_json_path: pathlib.Path, out_path: pathlib.Path) -> Tuple[int, int]:
    # Try season first
    team_qids = season_team_qids()
    clubs_by_qid: Dict[str, str] = {}

    if team_qids:
        clubs_by_qid = labels_for_qids(team_qids)

    # Fallback if season has no teams yet
    if not clubs_by_qid:
        labels = teams_from_file(teams_json_path)
        if labels:
            clubs_by_qid = resolve_club_qids_from_labels(labels)

    players: List[Dict[str, Any]] = []
    seen: set[Tuple[str, str]] = set()

    for club_qid, club_label in clubs_by_qid.items():
        try:
            people = players_active_2025_26_for_club(club_qid)
        except Exception as e:
            print("SPARQL error for club", club_label, club_qid, e)
            continue
        for player_qid, player_label in people:
            key = (player_qid, club_qid)
            if key in seen:
                continue
            seen.add(key)
            players.append({
                "qid": player_qid,
                "name": player_label or player_qid,
                "club": club_label,
                "season": "2025–26 Premier League",
            })

    write_json(out_path, players)
    return (len(clubs_by_qid), len(players))

def main():
    ap = argparse.ArgumentParser(description="Generate data/players.json for 2025/26 Premier League")
    ap.add_argument("--teams", default="teams.json", help="Path to teams.json (fallback list of EPL clubs)")
    ap.add_argument("--out", default="data/players.json", help="Output JSON path")
    args = ap.parse_args()

    repo_root = pathlib.Path.cwd()
    teams_json = (repo_root / args.teams).resolve()
    out_path = (repo_root / args.out).resolve()

    clubs, players = build_players_json(teams_json, out_path)
    print(f"Teams considered: {clubs} • Wrote {players} players to {out_path}")

if __name__ == "__main__":
    main()
