# scripts/generate_players_json.py
import requests, json, pathlib

SEASON_QID = "Q132674557"  # 2025–26 Premier League
ENDPOINT = "https://query.wikidata.org/sparql"
UA = {"User-Agent": "footballspinner-fetch/1.0 (players.json generator)"}

SPARQL = f"""
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX wikibase: <http://wikiba.se/ontology#>

# 1) Collect teams for the season by TWO possible models:
#    A) season -> P1923 -> team         (participants listed on the season)
#    B) team   -> P1344 -> season       (team states it participates in the season)

WITH {{
  SELECT DISTINCT ?team WHERE {{
    VALUES ?season {{ wd:{SEASON_QID} }}
    {{
      ?season wdt:P1923 ?team .
    }} UNION {{
      ?team wdt:P1344 ?season .
    }}
  }}
}} AS %Teams

# 2) For those teams, fetch players whose membership overlaps the 2025/26 window.
SELECT ?player ?playerLabel ?team ?teamLabel ?start ?end WHERE {{
  INCLUDE %Teams

  ?player p:P54 ?stmt .
  ?stmt ps:P54 ?team ;
        wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)

  OPTIONAL {{ ?stmt pq:P580 ?start. }}   # start time
  OPTIONAL {{ ?stmt pq:P582 ?end. }}     # end time

  # membership overlaps the 2025/26 window (inclusive bounds)
  FILTER( !BOUND(?end)   || ?end  >= "2025-07-01T00:00:00Z"^^xsd:dateTime )
  FILTER( !BOUND(?start) || ?start <= "2026-06-30T23:59:59Z"^^xsd:dateTime )

  ?player wdt:P31 wd:Q5 .                # human
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
"""

def main():
    # First, show how many teams the season returns (debug aid)
    teams_q = f"""
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
SELECT (COUNT(DISTINCT ?team) AS ?count) WHERE {{
  VALUES ?season {{ wd:{SEASON_QID} }}
  {{
    ?season wdt:P1923 ?team .
  }} UNION {{
    ?team wdt:P1344 ?season .
  }}
}}
"""
    t = requests.get(ENDPOINT, params={"query": teams_q, "format": "json"}, headers=UA, timeout=90)
    t.raise_for_status()
    teams_count = int(t.json()["results"]["bindings"][0]["count"]["value"])

    r = requests.get(ENDPOINT, params={"query": SPARQL, "format": "json"}, headers=UA, timeout=180)
    r.raise_for_status()
    rows = r.json()["results"]["bindings"]

    def val(b, k): return b.get(k, {}).get("value")

    players = []
    seen = set()
    for b in rows:
        qid  = val(b, "player").rsplit("/", 1)[-1]
        name = val(b, "playerLabel")
        team = val(b, "teamLabel")
        key = (qid, team)
        if key in seen:
            continue
        seen.add(key)
        players.append({
            "qid": qid,
            "name": name,
            "club": team,
            "season": "2025–26 Premier League"
        })

    out = pathlib.Path("data/players.json").resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(players, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Teams detected: {teams_count} • Wrote {len(players)} players to {out}")

if __name__ == "__main__":
    main()
