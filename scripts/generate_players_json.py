# scripts/generate_players_from_wikipedia.py
# Build data/players.json by scraping Wikipedia for each PL club (season page -> fallback to club page).
# Tight "first-team" heuristics + balanced 18 picker:
#   - Require shirt number (1..99) AND a position (GK/DF/MF/FW) where possible
#   - Skip youth/loan sections (U21/U23/Academy/B team/Reserves/Loans)
#   - Exclude rows mentioning "loan"
#   - Prefer first valid squad table under the First-team/Current squad heading
#   - pick_top18: 2 GK, 6 DF, 6 MF, 4 FW, then best remaining (by numbered, low number)
# Output: data/players.json

from __future__ import annotations
import json, re, time, random, pathlib
import requests
from bs4 import BeautifulSoup

REST_HTML = "https://en.wikipedia.org/w/rest.php/v1/page/{title}/html"
UA = {"User-Agent": "footballspinner/1.0 (first-team fetcher)"}

# 20 PL clubs (adjust if the league changes)
SEASON_TITLES = {
    "Arsenal": "2025–26_Arsenal_F.C._season",
    "Aston Villa": "2025–26_Aston_Villa_F.C._season",
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

# Heuristics and patterns
SQUAD_HEADINGS_SEASON = ["first-team squad", "first team squad", "squad"]
SQUAD_HEADINGS_CLUB   = ["current squad", "first-team squad", "first team", "squad"]
EXCLUDE_SECTION_KEYS  = ["out on loan", "loans", "academy", "under-21", "under 21", "u21",
                         "under-23", "under 23", "u23", "development", "reserves", "b team"]
POS_PATTERN = re.compile(r"^(GK|DF|MF|FW|GKP|DEF|MID|FWD)$", re.I)
NUM_PATTERN = re.compile(r"^\d{1,2}$")  # 1..99
ROW_LOAN_RX = re.compile(r"\bloan(ed)?\b", re.I)

def _polite():
    time.sleep(random.uniform(0.18, 0.4))

def get_html(title: str) -> str | None:
    r = requests.get(REST_HTML.format(title=title), headers=UA, timeout=30)
    if r.status_code != 200:
        return None
    return r.text

def next_until_next_section(h):
    for sib in h.find_all_next():
        if sib.name in ("h2", "h3") and sib is not h:
            break
        yield sib

def find_heading(soup: BeautifulSoup, needles: list[str]) -> BeautifulSoup | None:
    for h in soup.find_all(["h2", "h3"]):
        txt = (h.get_text(" ", strip=True) or "").lower()
        if any(x in txt for x in EXCLUDE_SECTION_KEYS):
            return None
        if any(n in txt for n in needles):
            return h
    return None

def parse_first_valid_table(container: BeautifulSoup) -> list[dict]:
    """Find the first table that looks like the first-team squad (has 'player' and number/position headers)."""
    for tbl in container.find_all("table"):
        ths = [th.get_text(" ", strip=True).lower() for th in tbl.find_all("th")]
        if not ths:
            continue
        head = " ".join(ths)
        if "player" in head and ("no" in head or "number" in head or "pos" in head or "position" in head):
            players = []
            for tr in tbl.find_all("tr"):
                cells = [td.get_text(" ", strip=True) for td in tr.find_all(["td", "th"])]
                if len(cells) < 2:
                    continue
                row_text = " ".join(cells)
                if ROW_LOAN_RX.search(row_text):
                    continue
                number = next((c for c in cells if NUM_PATTERN.fullmatch(c)), None)
                pos = next((c.upper() for c in cells if POS_PATTERN.fullmatch(c)), None)
                if not number or not pos:
                    continue
                a = tr.find("a")
                name = a.get_text(" ", strip=True) if (a and a.get("href", "").startswith("/wiki/")) else None
                if not name:
                    nonnums = [c for c in cells if not NUM_PATTERN.fullmatch(c)]
                    name = max(nonnums, key=len, default="").strip()
                if not name or "player" in name.lower():
                    continue
                players.append({"name": name, "number": number, "pos": pos})
            if players:
                return players
    return []

def parse_squad(soup: BeautifulSoup, heading_needles: list[str]) -> list[dict]:
    """Prefer the first matching table after the heading; strict list fallback."""
    h = find_heading(soup, heading_needles)
    if not h:
        return []
    # 1) Prefer a valid table right under the section
    for el in next_until_next_section(h):
        if el.name in ("h2", "h3"):
            break
        if el.name == "table":
            got = parse_first_valid_table(el)
            if got:
                return got
    # 2) Strict list fallback
    players = []
    for el in next_until_next_section(h):
        if el.name in ("h2", "h3"):
            break
        if el.name in ("ul", "ol"):
            for li in el.find_all("li"):
                text = li.get_text(" ", strip=True)
                if ROW_LOAN_RX.search(text):
                    continue
                m = re.match(r"^\s*(\d{1,2})\s*[–-]\s*(.+?)\s*(\((GK|DF|MF|FW).*\))?\s*$", text, flags=re.I)
                if m:
                    players.append({"name": m.group(2), "number": m.group(1), "pos": (m.group(4) or None)})
                else:
                    a = li.find("a")
                    if a and a.get("href", "").startswith("/wiki/"):
                        players.append({"name": a.get_text(" ", strip=True), "number": None, "pos": None})
    # de-duplicate by name
    uniq, seen = [], set()
    for p in players:
        key = (p.get("name") or "").strip().lower()
        if key and key not in seen:
            seen.add(key)
            uniq.append(p)
    return uniq

def pick_top18(players: list[dict]) -> list[dict]:
    """Balanced 18: 2 GK, 6 DF, 6 MF, 4 FW, then best remaining by wearing number/lowest number."""
    def norm_pos(p):
        v = (p.get("pos") or "").upper()
        if v.startswith("GK"):  return "GK"
        if v.startswith("DF") or v.startswith("DEF"): return "DF"
        if v.startswith("MF") or v.startswith("MID"): return "MF"
        if v.startswith("FW") or v.startswith("FWD"): return "FW"
        return None

    buckets = {"GK": [], "DF": [], "MF": [], "FW": [], None: []}
    for p in players:
        buckets[norm_pos(p)].append(p)

    target = {"GK": 2, "DF": 6, "MF": 6, "FW": 4}

    def sort_key(p):
        num = p.get("number")
        has = 0 if (num and num.isdigit()) else 1    # prefer numbered
        numv = int(num) if (num and num.isdigit()) else 999
        return (has, numv, p.get("name", ""))

    for k in buckets:
        buckets[k].sort(key=sort_key)

    picked = []
    # 1) fill by targets
    for pos in ("GK", "DF", "MF", "FW"):
        take = min(target[pos], len(buckets[pos]))
        picked.extend(buckets[pos][:take])
        buckets[pos] = buckets[pos][take:]

    # 2) top up to 18 from remaining
    rest = buckets["GK"] + buckets["DF"] + buckets["MF"] + buckets["FW"] + buckets[None]
    rest.sort(key=sort_key)
    need = 18 - len(picked)
    if need > 0:
        picked.extend(rest[:need])

    # ensure max 18 + de-dup by name
    out, seen = [], set()
    for p in picked:
        name = (p.get("name") or "").strip().lower()
        if name and name not in seen:
            seen.add(name)
            out.append(p)
        if len(out) >= 18:
            break
    return out

def main():
    out_path = pathlib.Path("data/players.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    all_players = []
    total_clubs = 0

    for club, season_title in SEASON_TITLES.items():
        club_name = club
        got = []

        # 1) Try season page
        html = get_html(season_title)
        if html:
            soup = BeautifulSoup(html, "lxml")
            got = parse_squad(soup, SQUAD_HEADINGS_SEASON)
            if got:
                got = pick_top18(got)
                total_clubs += 1
                print(f"[ok] {club_name}: {len(got)} players (season page)")

        # 2) Fallback to base club page
        if not got:
            base = CLUB_TITLES[club]
            html2 = get_html(base)
            if html2:
                soup2 = BeautifulSoup(html2, "lxml")
                got = parse_squad(soup2, SQUAD_HEADINGS_CLUB)
                if got:
                    got = pick_top18(got)
                    total_clubs += 1
                    print(f"[ok] {club_name}: {len(got)} players (club page)")
                else:
                    print(f"[warn] {club_name}: squad not found on club page")
            else:
                print(f"[skip] {club_name}: page not found")

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
