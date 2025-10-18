# scripts/generate_players_from_wikipedia.py
# Build data/players.json from Wikipedia "2025–26 {Club} F.C. season" pages.
# Uses the MediaWiki REST API to fetch page HTML and parses the "First-team squad" table(s).

import json, re, time, random, pathlib
import requests
from bs4 import BeautifulSoup

# Wikipedia REST HTML (official)
# Docs: https://en.wikipedia.org/w/rest.php/v1/page/{Title}/html  and https://api.wikimedia.org/core/v1/wikipedia/en/page/{Title}/html
REST_HTML = "https://en.wikipedia.org/w/rest.php/v1/page/{title}/html"
UA = {"User-Agent": "footballspinner/1.0 (first-team fetcher)"}

# 20 PL clubs (update if promoted/relegated change)
CLUB_TITLES = [
    # Title format must match enwiki page title
    "2025–26_Arsenal_F.C._season",
    "2025–26_Aston_Villa_F.C._season",
    "2025–26_Bournemouth_F.C._season",
    "2025–26_Brentford_F.C._season",
    "2025–26_Brighton_%26_Hove_Albion_F.C._season",
    "2025–26_Chelsea_F.C._season",
    "2025–26_Crystal_Palace_F.C._season",
    "2025–26_Everton_F.C._season",
    "2025–26_Fulham_F.C._season",
    "2025–26_Ipswich_Town_F.C._season",
    "2025–26_Leeds_United_F.C._season",
    "2025–26_Leicester_City_F.C._season",
    "2025–26_Liverpool_F.C._season",
    "2025–26_Manchester_City_F.C._season",
    "2025–26_Manchester_United_F.C._season",
    "2025–26_Newcastle_United_F.C._season",
    "2025–26_Nottingham_Forest_F.C._season",
    "2025–26_Southampton_F.C._season",
    "2025–26_Tottenham_Hotspur_F.C._season",
    "2025–26_Wolverhampton_Wanderers_F.C._season",
]

def _polite():
    time.sleep(random.uniform(0.15, 0.35))

def get_html(title: str) -> str | None:
    url = REST_HTML.format(title=title)
    r = requests.get(url, headers=UA, timeout=30)
    if r.status_code != 200:
        return None
    return r.text

def next_elements_until_section(start):
    """Yield siblings until the next H2/H3 section starts."""
    for sib in start.find_all_next():
        if sib.name in ("h2", "h3") and sib is not start:
            break
        yield sib

def extract_first_team(html: str) -> list[dict]:
    """Parse 'First-team squad' section; return list of players with fields."""
    soup = BeautifulSoup(html, "html.parser")
    players = []

    # Find heading that contains text like "First-team squad" (case-insensitive)
    heading = None
    for h in soup.find_all(["h2", "h3"]):
        txt = (h.get_text(" ", strip=True) or "").lower()
        if "first-team" in txt and "squad" in txt:
            heading = h
            break
        if "current squad" in txt:
            heading = h
            break
        if "first team squad" in txt:
            heading = h
            break
    if not heading:
        return players

    # Within this section, parse tables or lists that look like squad tables
    for el in next_elements_until_section(heading):
        # Stop early if we roamed too far
        if el.name in ("h2", "h3"):
            break
        # Prefer tables with headers including "No" and "Player"
        if el.name == "table":
            ths = [th.get_text(" ", strip=True).lower() for th in el.find_all("th")]
            if not ths:
                continue
            header_text = " ".join(ths)
            if ("no" in header_text or "number" in header_text) and "player" in header_text:
                # parse rows
                for tr in el.find_all("tr"):
                    tds = tr.find_all(["td","th"])
                    if len(tds) < 2:
                        continue
                    row_text = [td.get_text(" ", strip=True) for td in tds]
                    # heuristics to pick fields
                    shirt = None
                    pos = None
                    name = None

                    # try to find "Player" cell by link text
                    a = tr.find("a")
                    if a and a.get("href","").startswith("/wiki/"):
                        name = a.get_text(" ", strip=True)

                    # fallback: guess last significant cell as name
                    if not name:
                        # pick the longest cell text as name-ish
                        longest = max(row_text, key=len, default="")
                        name = longest

                    # shirt number: first numeric-ish cell
                    for cell in row_text:
                        if re.fullmatch(r"[0-9]{1,3}", cell):
                            shirt = cell
                            break

                    # position: look for typical position abbreviations
                    pos_guess = None
                    for cell in row_text:
                        c = cell.upper()
                        if re.fullmatch(r"(GK|DF|MF|FW|GKP|DEF|MID|FWD)", c):
                            pos_guess = c
                            break
                    pos = pos_guess

                    # basic sanity
                    if name and not any(kw in name.lower() for kw in ["player", "no.", "no "]):
                        players.append({"name": name, "number": shirt, "pos": pos})
        # Some club pages use bullet lists
        if el.name in ("ul","ol"):
            for li in el.find_all("li"):
                # expect something like '7 – Bukayo Saka (MF)'
                text = li.get_text(" ", strip=True)
                m = re.match(r"^\s*(\d{1,3})\s*[–-]\s*(.+?)\s*(\((GK|DF|MF|FW).*\))?\s*$", text, flags=re.I)
                if m:
                    players.append({"name": m.group(2), "number": m.group(1), "pos": (m.group(4) or None)})
                else:
                    # last resort: take first bolded link
                    a = li.find("a")
                    if a and a.get("href","").startswith("/wiki/"):
                        players.append({"name": a.get_text(" ", strip=True), "number": None, "pos": None})

    # de-duplicate by player name
    uniq = []
    seen = set()
    for p in players:
        key = p["name"].lower()
        if key in seen: continue
        seen.add(key)
        uniq.append(p)
    return uniq

def main():
    out_path = pathlib.Path("data/players.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    all_players = []
    total_clubs = 0

    for title in CLUB_TITLES:
        _polite()
        html = get_html(title)
        club_name = title.replace("2025–26_", "").replace("_F.C._season", "").replace("_", " ")
        if not html:
            print(f"[skip] {club_name}: page not found")
            continue

        squad = extract_first_team(html)
        if not squad:
            print(f"[warn] {club_name}: first-team squad not found yet")
            continue

        total_clubs += 1
        for p in squad:
            all_players.append({
                "name": p["name"],
                "club": club_name.replace("%26", "&"),
                "number": p.get("number"),
                "pos": p.get("pos"),
                "season": "2025–26 Premier League"
            })
        print(f"[ok] {club_name}: {len(squad)} players")

    out_path.write_text(json.dumps(all_players, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nClubs parsed: {total_clubs} • Players written: {len(all_players)} → {out_path}")

if __name__ == "__main__":
    main()
