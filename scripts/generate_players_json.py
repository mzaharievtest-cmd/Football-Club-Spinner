# scripts/generate_players_from_wikipedia.py
# Build data/players.json by scraping Wikipedia for each club (season page -> fallback to club page).
# Requires: pip install beautifulsoup4 lxml requests

import json, re, time, random, pathlib, urllib.parse
import requests
from bs4 import BeautifulSoup

REST_HTML = "https://en.wikipedia.org/w/rest.php/v1/page/{title}/html"
UA = {"User-Agent": "footballspinner/1.0 (first-team fetcher)"}

# 20 PL clubs (adjust if needed)
SEASON_TITLES = {
    "Arsenal": "2025–26_Arsenal_F.C._season",
    "Aston Villa": "2025–26_Aston_Villa_F.C._season",
    # Bournemouth season titles use A.F.C. and dots in Wikipedia
    "AFC Bournemouth": "2025–26_A.F.C._Bournemouth_season",
    "Brentford": "2025–26_Brentford_F.C._season",
    "Brighton & Hove Albion": "2025–26_Brighton_%26_Hove_Albion_F.C._season",
    "Chelsea": "2025–26_Chelsea_F.C._season",
    "Crystal Palace": "2025–26_Crystal_Palace_F.C._season",
    "Everton": "2025–26_Everton_F.C._season",
    "Fulham": "2025–26_Fulham_F.C._season",
    "Ipswich Town": "2025–26_Ipswich_Town_F.C._season",
    "Leeds United": "2025–26_Leeds_United_F.C._season",
    "Leicester City": "2025–26_Leicester_City_F.C._season",
    "Liverpool": "2025–26_Liverpool_F.C._season",
    "Manchester City": "2025–26_Manchester_City_F.C._season",
    "Manchester United": "2025–26_Manchester_United_F.C._season",
    "Newcastle United": "2025–26_Newcastle_United_F.C._season",
    "Nottingham Forest": "2025–26_Nottingham_Forest_F.C._season",
    "Southampton": "2025–26_Southampton_F.C._season",
    "Tottenham Hotspur": "2025–26_Tottenham_Hotspur_F.C._season",
    "Wolverhampton Wanderers": "2025–26_Wolverhampton_Wanderers_F.C._season",
}

# base club pages (fallback)
CLUB_TITLES = {
    "Arsenal": "Arsenal_F.C.",
    "Aston Villa": "Aston_Villa_F.C.",
    "AFC Bournemouth": "AFC_Bournemouth",
    "Brentford": "Brentford_F.C.",
    "Brighton & Hove Albion": "Brighton_%26_Hove_Albion_F.C.",
    "Chelsea": "Chelsea_F.C.",
    "Crystal Palace": "Crystal_Palace_F.C.",
    "Everton": "Everton_F.C.",
    "Fulham": "Fulham_F.C.",
    "Ipswich Town": "Ipswich_Town_F.C.",
    "Leeds United": "Leeds_United_F.C.",
    "Leicester City": "Leicester_City_F.C.",
    "Liverpool": "Liverpool_F.C.",
    "Manchester City": "Manchester_City_F.C.",
    "Manchester United": "Manchester_United_F.C.",
    "Newcastle United": "Newcastle_United_F.C.",
    "Nottingham Forest": "Nottingham_Forest_F.C.",
    "Southampton": "Southampton_F.C.",
    "Tottenham Hotspur": "Tottenham_Hotspur_F.C.",
    "Wolverhampton Wanderers": "Wolverhampton_Wanderers_F.C.",
}

def _polite(): time.sleep(random.uniform(0.18, 0.4))

def get_html(title: str) -> str | None:
    url = REST_HTML.format(title=title)
    r = requests.get(url, headers=UA, timeout=30)
    if r.status_code != 200:
        return None
    return r.text

def section_siblings_until_next(h):
    for sib in h.find_all_next():
        # stop when another h2/h3 appears
        if sib.name in ("h2","h3") and sib is not h:
            break
        yield sib

def find_heading(soup: BeautifulSoup, needles: list[str]) -> BeautifulSoup | None:
    for h in soup.find_all(["h2","h3"]):
        txt = (h.get_text(" ", strip=True) or "").lower()
        if any(n in txt for n in needles):
            return h
    return None

SQUAD_HEADINGS_SEASON = ["first-team squad", "first team squad", "squad"]
SQUAD_HEADINGS_CLUB   = ["current squad", "first-team squad", "first team", "squad"]

POS_PATTERN = re.compile(r"^(GK|DF|MF|FW|GKP|DEF|MID|FWD)$", re.I)
NUM_PATTERN = re.compile(r"^\d{1,3}$")

def parse_squad_from_section(soup: BeautifulSoup, heading_needles: list[str]) -> list[dict]:
    """Extract players from the section whose heading contains any of heading_needles."""
    players = []
    h = find_heading(soup, heading_needles)
    if not h: return players
    # search tables first
    for el in section_siblings_until_next(h):
        if el.name in ("h2","h3"): break
        if el.name == "table":
            ths = [th.get_text(" ", strip=True).lower() for th in el.find_all("th")]
            if not ths: continue
            head = " ".join(ths)
            if ("player" in head) and ("no" in head or "number" in head or "pos" in head or "position" in head):
                for tr in el.find_all("tr"):
                    cells = [td.get_text(" ", strip=True) for td in tr.find_all(["td","th"])]
                    if len(cells) < 2: continue
                    # name: anchor link if present
                    a = tr.find("a")
                    name = a.get_text(" ", strip=True) if (a and a.get("href","").startswith("/wiki/")) else None
                    if not name:
                        # fallback: longest cell string
                        name = max(cells, key=len, default="").strip()
                    # number
                    number = next((c for c in cells if NUM_PATTERN.fullmatch(c)), None)
                    # position
                    pos = next((c.upper() for c in cells if POS_PATTERN.fullmatch(c)), None)
                    # ignore obvious non-rows
                    if not name or "player" in name.lower(): 
                        continue
                    players.append({"name": name, "number": number, "pos": pos})
        elif el.name in ("ul","ol"):
            # list fallback
            for li in el.find_all("li"):
                text = li.get_text(" ", strip=True)
                m = re.match(r"^\s*(\d{1,3})\s*[–-]\s*(.+?)\s*(\((GK|DF|MF|FW).*\))?\s*$", text, flags=re.I)
                if m:
                    players.append({"name": m.group(2), "number": m.group(1), "pos": (m.group(4) or None)})
                else:
                    a = li.find("a")
                    if a and a.get("href","").startswith("/wiki/"):
                        players.append({"name": a.get_text(" ", strip=True), "number": None, "pos": None})
    # dedupe by normalized name
    out, seen = [], set()
    for p in players:
        key = p["name"].strip().lower()
        if key in seen: continue
        seen.add(key)
        out.append(p)
    return out

def main():
    out_path = pathlib.Path("data/players.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    all_players = []
    total_clubs = 0

    for club, season_title in SEASON_TITLES.items():
        club_name = club
        # 1) season page
        html = get_html(season_title)
        got = []
        if html:
            soup = BeautifulSoup(html, "lxml")
            got = parse_squad_from_section(soup, SQUAD_HEADINGS_SEASON)
            if got:
                total_clubs += 1
                print(f"[ok] {club_name}: {len(got)} players (season page)")
        # 2) fallback to base club page
        if not got:
            fallback_title = CLUB_TITLES[club]
            html2 = get_html(fallback_title)
            if html2:
                soup2 = BeautifulSoup(html2, "lxml")
                got = parse_squad_from_section(soup2, SQUAD_HEADINGS_CLUB)
                if got:
                    total_clubs += 1
                    print(f"[ok] {club_name}: {len(got)} players (club page)")
                else:
                    print(f"[warn] {club_name}: squad not found on club page")
            else:
                print(f"[skip] {club_name}: page not found")

        # cap to at most 30 per club to avoid bloated lists
        got = got[:30]

        # store
        for p in got:
            all_players.append({
                "name": p["name"],
                "club": club_name,
                "number": p.get("number"),
                "pos": p.get("pos"),
                "season": "2025–26 Premier League",
            })
        _polite()

    out_path.write_text(json.dumps(all_players, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nClubs parsed: {total_clubs} • Players written: {len(all_players)} → {out_path}")

if __name__ == "__main__":
    main()
