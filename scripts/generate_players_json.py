# scripts/generate_players_json.py
import requests, json, pathlib

SPARQL = """
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX wikibase: <http://wikiba.se/ontology#>

SELECT ?player ?playerLabel ?team ?teamLabel ?start ?end WHERE {
  VALUES ?season { wd:Q132674557 }     # 2025–26 Premier League
  ?season wdt:P1923 ?team .            # participating team

  ?player p:P54 ?stmt .
  ?stmt ps:P54 ?team ;
        wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)

  OPTIONAL { ?stmt pq:P580 ?start. }   # start time
  OPTIONAL { ?stmt pq:P582 ?end. }     # end time

  # membership overlaps the 2025/26 window:
  FILTER( !BOUND(?end)   || ?end  >= "2025-07-01T00:00:00Z"^^xsd:dateTime )
  FILTER( !BOUND(?start) || ?start <= "2026-06-30T23:59:59Z"^^xsd:dateTime )

  ?player wdt:P31 wd:Q5 .              # human
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
"""

ENDPOINT = "https://query.wikidata.org/sparql"
UA = {"User-Agent": "footballspinner-fetch/1.0 (players.json generator)"}

def main():
    r = requests.get(ENDPOINT, params={"query": SPARQL, "format": "json"}, headers=UA, timeout=90)
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
    print(f"Wrote {len(players)} players to {out}")

if __name__ == "__main__":
    main()
