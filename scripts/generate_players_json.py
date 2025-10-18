# scripts/generate_players_from_wikipedia.py
# Build data/players.json by scraping Wikipedia for each PL club (season page -> fallback to club page).
# Improved parsing:
#  - Accept full-word positions and map to GK/DF/MF/FW
#  - Number is optional (prefer if present)
#  - Skip excluded sections instead of aborting; don't stop the whole page
#  - Balanced pick_top18 (2 GK, 6 DF, 6 MF, 4 FW, then best remaining)

from __future__ import annotations
import json, re, time, random, pathlib
import requests
from bs4 import BeautifulSoup

REST_HTML = "https://en.wikipedia.org/w/rest.php/v1/page/{title}/html"
UA = {"User-Agent": "footballspinner/1.0 (first-team fetcher)"}

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

SQUAD_HEADINGS_SEASON = ["first-team squad", "first team squad", "squad"]
SQUAD_HEADINGS_CLUB   = ["current squad", "first-team squad", "first team", "squad"]
EXCLUDE_SECTION_KEYS  = ["out on loan", "loans", "academy", "under-21", "under 21", "u21",
                         "under-23", "under 23", "u23", "development", "reserves", "b team"]

# position normalization
POS_ABBR_RX = re.compile(r"^(GK|DF|MF|FW|GKP|DEF|MID|FWD)$", re.I)
POS_WORDS = {
    "goalkeeper": "GK",
    "keeper": "GK",
    "defender": "DF",
    "centre-back": "DF", "center-back": "DF", "center back": "DF", "centre back": "DF", "cb": "DF",
    "full-back": "DF", "fullback": "DF", "left-back": "DF", "right-back": "DF", "lb": "DF", "rb": "DF",
    "wing-back": "DF", "wingback": "DF", "lwb": "DF", "rwb": "DF",
    "midfielder": "MF",
    "defensive midfielder": "MF", "central midfielder": "MF", "attacking midfielder": "MF",
    "left midfielder": "MF", "right midfielder": "MF", "cm": "MF", "dm": "MF", "am": "MF",
    "forward": "FW", "striker": "FW", "winger": "FW", "left winger": "FW", "right winger": "FW",
    "lw": "FW", "rw": "FW", "st": "FW", "cf": "FW",
}
NUM_RX = re.compile(r"^\d{1,2}$")   # 1..99
ROW_LOAN_RX = re.compile(r"\bloan(ed)?\b", re.I)

def _polite():
    time.sleep(random.uniform(0.18, 0.4))

def get_html(title: str) -> str | None:
    r = requests.get(REST_HTML.format(title=title), headers=UA, timeout=30)
    if r.status_code != 200:
        return None
    return r.text

def is_excluded_heading(txt: str) -> bool:
    t = txt.lower()
    return any(k in t for k in EXCLUDE_SECTION_KEYS)

def find_heading(soup: BeautifulSoup, needles: list[str]) -> BeautifulSoup | None:
    # find the first heading that matches a needle
    for h in soup.find_all(["h2", "h3"]):
        txt = (h.get_text(" ", strip=True) or "").lower()
        if any(n in txt for n in needles):
            return h
    return None

def iter_section_blocks(soup: BeautifulSoup, start_heading: BeautifulSoup):
    """Yield blocks (tables/lists) within the section until next h2/h3, skipping excluded subsections."""
    if not start_heading:
        return
    for el in start_heading.find_all_next():
        if el.name in ("h2", "h3") and el is not start_heading:
            # stop when the next section starts
            break
        if el.name in ("h2", "h3") and is_excluded_heading(el.get_text(" ", strip=True)):
            # skip excluded subsection entirely
            for _ in el.find_all_next():
                if _.name in ("h2", "h3") and _ is not el:
                    # resume scanning after excluded section ends
                    break
            continue
        if el.name in ("table", "ul", "ol"):
            yield el

def normalize_pos(text: str | None) -> str | None:
    if not text: return None
    t = text.strip().lower()
    # abbr?
    m = POS_ABBR_RX.fullmatch(t.upper())
    if m: 
        code = m.group(1).upper()
        return {"GKP":"GK", "DEF":"DF", "MID":"MF", "FWD":"FW"}.get(code, code)
    # words: test longer keys first
    for key in sorted(POS_WORDS.keys(), key=len, reverse=True):
        if key in t:
            return POS_WORDS[key]
    return None

def extract_rows_from_table(tbl) -> list[dict]:
    ths = [th.get_text(" ", strip=True).lower() for th in tbl.find_all("th")]
    if not ths: 
        return []
    if "player" not in " ".join(ths).lower():
        return []
    players = []
    for tr in tbl.find_all("tr"):
        cells = [td.get_text(" ", strip=True) for td in tr.find_all(["td","th"])]
        if len(cells) < 2:
            continue
        row_text = " ".join(cells)
        if ROW_LOAN_RX.search(row_text):
            continue

        # number (optional)
        number = next((c for c in cells if NUM_RX.fullmatch(c)), None)

        # position: from any cell
        pos_raw = None
        for c in cells:
            p = normalize_pos(c)
            if p:
                pos_raw = p
                break

        # name
        a = tr.find("a")
        name = a.get_text(" ", strip=True) if (a and a.get("href","").startswith("/wiki/")) else None
        if not name:
            nonnums = [c for c in cells if not NUM_RX.fullmatch(c)]
            name = max(nonnums, key=len, default="").strip()

        if not name or not pos_raw:
            continue

        players.append({"name": name, "number": number, "pos": pos_raw})
    return players

def extract_from_list(lst) -> list[dict]:
    players = []
    for li in lst.find_all("li"):
        text = li.get_text(" ", strip=True)
        if ROW_LOAN_RX.search(text):
            continue
        # try patterns like: "7 – Bukayo Saka (Right winger)"
        m = re.match(r"^\s*(\d{1,2})\s*[–-]\s*(.+?)\s*(\((.+?)\))?\s*$", text)
        if m:
            num = m.group(1)
            name = m.group(2).strip()
            pos = normalize_pos(m.group(4))
            if name and pos:
                players.append({"name": name, "number": num, "pos": pos})
            continue
        # fallback: bold/link first name with a position somewhere
        a = li.find("a")
        pos = normalize_pos(text)
        if a and a.get("href","").startswith("/wiki/") and pos:
            players.append({"name": a.get_text(" ", strip=True), "number": None, "pos": pos})
    return players

def parse_squad(soup: BeautifulSoup, heading_needles: list[str]) -> list[dict]:
    h = find_heading(soup, heading_needles)
    if not h:
        return []
    # scan only inside this section; skip excluded subsections
    for block in iter_section_blocks(soup, h):
        if block.name == "table":
            got = extract_rows_from_table(block)
            if got:
                return got
        elif block.name in ("ul","ol"):
            got = extract_from_list(block)
            if got:
                return got
    return []

def pick_top18(players: list[dict]) -> list[dict]:
    """Balanced 18: 2 GK, 6 DF, 6 MF, 4 FW, then best remaining (prefer numbered, lower number)."""
    def bucket(p):
        v = (p.get("pos") or "").upper()
        if v.startswith("GK"): return "GK"
        if v.startswith("DF"): return "DF"
        if v.startswith("MF"): return "MF"
        if v.startswith("FW"): return "FW"
        return None

    buckets = {"GK": [], "DF": [], "MF": [], "FW": [], None: []}
    for p in players:
        buckets[bucket(p)].append(p)

    target = {"GK": 2, "DF": 6, "MF": 6, "FW": 4}

    def sort_key(p):
        num = p.get("number")
        has = 0 if (num and num.isdigit()) else 1
        numv = int(num) if (num and num.isdigit()) else 999
        return (has, numv, p.get("name",""))

    for k in buckets:
        buckets[k].sort(key=sort_key)

    picked = []
    for pos in ("GK","DF","MF","FW"):
        take = min(target[pos], len(buckets[pos]))
        picked.extend(buckets[pos][:take])
        buckets[pos] = buckets[pos][take:]

    rest = buckets["GK"] + buckets["DF"] + buckets["MF"] + buckets["FW"] + buckets[None]
    rest.sort(key=sort_key)
    need = 18 - len(picked)
    if need > 0:
        picked.extend(rest[:need])

    # de-dup and clamp to 18
    out, seen = [], set()
    for p in picked:
        key = (p.get("name") or "").strip().lower()
        if key and key not in seen:
            seen.add(key)
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
        got = []

        # season page
        html = get_html(season_title)
        if html:
            soup = BeautifulSoup(html, "lxml")
            got = parse_squad(soup, SQUAD_HEADINGS_SEASON)
            if got:
                got = pick_top18(got)
                total_clubs += 1
                print(f"[ok] {club}: {len(got)} players (season page)")

        # fallback: club page
        if not got:
            base = CLUB_TITLES[club]
            html2 = get_html(base)
            if html2:
                soup2 = BeautifulSoup(html2, "lxml")
                got = parse_squad(soup2, SQUAD_HEADINGS_CLUB)
                if got:
                    got = pick_top18(got)
                    total_clubs += 1
                    print(f"[ok] {club}: {len(got)} players (club page)")
                else:
                    print(f"[warn] {club}: squad not found on club page")
            else:
                print(f"[skip] {club}: page not found")

        for p in got:
            all_players.append({
                "name": p["name"],
                "club": club,
                "number": p.get("number"),
                "pos": p.get("pos"),
                "season": "2025–26 Premier League",
            })
        _polite()

    out_path.write_text(json.dumps(all_players, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nClubs parsed: {total_clubs} • Players written: {len(all_players)} → {out_path}")

if __name__ == "__main__":
    main()
