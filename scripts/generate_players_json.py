# scripts/generate_players_json.py
# Build data/players.json by scraping Wikipedia for each PL club (season page -> fallback to club page).
# Robust parsing:
# - Uses Wikipedia REST HTML for stability
# - Finds First-team/Current squad section; skips Academy/Loans/etc.
# - Reads ONLY the Player/Name column from tables (via header map)
# - Accepts full-word positions (maps to GK/DF/MF/FW)
# - Cleans names (removes refs, captain tags, heights/fees/DOB lines)
# - Picks a balanced 18 per club (2 GK, 6 DF, 6 MF, 4 FW, then best remaining)

from __future__ import annotations
import json, re, time, random, pathlib
import requests
from bs4 import BeautifulSoup

# ---------- Config ----------
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
ROW_LOAN_RX = re.compile(r"\bloan(ed)?\b", re.I)

# Position normalization
POS_ABBR_RX = re.compile(r"^(GK|DF|MF|FW|GKP|DEF|MID|FWD)$", re.I)
POS_WORDS = {
    "goalkeeper": "GK", "keeper": "GK",
    "defender": "DF", "centre-back": "DF", "center-back": "DF", "centre back": "DF", "center back": "DF", "cb": "DF",
    "full-back": "DF", "fullback": "DF", "left-back": "DF", "right-back": "DF", "lb": "DF", "rb": "DF",
    "wing-back": "DF", "wingback": "DF", "lwb": "DF", "rwb": "DF",
    "midfielder": "MF", "defensive midfielder": "MF", "central midfielder": "MF", "attacking midfielder": "MF",
    "left midfielder": "MF", "right midfielder": "MF", "cm": "MF", "dm": "MF", "am": "MF",
    "forward": "FW", "striker": "FW", "winger": "FW", "left winger": "FW", "right winger": "FW",
    "lw": "FW", "rw": "FW", "st": "FW", "cf": "FW",
}

# ---------- Helpers ----------
def _polite():
    time.sleep(random.uniform(0.18, 0.4))

def get_html(title: str) -> str | None:
    r = requests.get(REST_HTML.format(title=title), headers=UA, timeout=30)
    if r.status_code != 200:
        return None
    return r.text

def is_excluded_heading(txt: str) -> bool:
    t = (txt or "").lower()
    return any(k in t for k in EXCLUDE_SECTION_KEYS)

def find_heading(soup: BeautifulSoup, needles: list[str]) -> BeautifulSoup | None:
    for h in soup.find_all(["h2","h3"]):
        txt = (h.get_text(" ", strip=True) or "").lower()
        if any(n in txt for n in needles):
            return h
    return None

def iter_section_blocks(soup: BeautifulSoup, start_heading: BeautifulSoup):
    if not start_heading: return
    for el in start_heading.find_all_next():
        if el.name in ("h2","h3") and el is not start_heading:
            break
        if el.name in ("h2","h3") and is_excluded_heading(el.get_text(" ", strip=True)):
            # skip excluded subsection content
            for sib in el.find_all_next():
                if sib.name in ("h2","h3") and sib is not el:
                    break
            continue
        if el.name in ("table","ul","ol"):
            yield el

# ---- Name cleaning (no (?R) recursion) ----
def clean_name(raw: str) -> str | None:
    if not raw:
        return None

    s = str(raw)
    # drop bracket refs like [137]
    s = re.sub(r"\[\s*\d+\s*\]", "", s)
    # collapse whitespace
    s = re.sub(r"\s+", " ", s).strip()

    # remove trailing (...) groups safely (balanced from the end)
    def strip_trailing_parens(txt: str) -> str:
        while txt.endswith(")"):
            depth = 0
            matched = False
            for i in range(len(txt)-1, -1, -1):
                c = txt[i]
                if c == ")":
                    depth += 1
                elif c == "(":
                    depth -= 1
                    if depth == 0:
                        txt = txt[:i].rstrip()
                        matched = True
                        break
            if not matched:
                break
        return txt

    s = strip_trailing_parens(s)

    # reject junky lines (heights, fees, ages, header blobs)
    RX_M_HEIGHT = re.compile(r"\b\d\.\d{2}\s*m\b", re.I)                 # 1.86 m
    RX_FT_IN    = re.compile(r"\b\d+\s*ft\s*\d*\s*in\b", re.I)           # 6 ft 1 in
    RX_MONEY    = re.compile(r"[£$€]\s*\d", re.I)                         # £34.3m
    RX_AGE      = re.compile(r"\bage\b|\baged\b|\(\d{4}-\d{2}-\d{2}\)", re.I)
    RX_BIG_BLOB = re.compile(r"No\.\s*Pos\.", re.I)                       # header row dump

    if (RX_M_HEIGHT.search(s) or RX_FT_IN.search(s) or RX_MONEY.search(s)
        or RX_AGE.search(s) or RX_BIG_BLOB.search(s)):
        return None

    if not re.search(r"[A-Za-zÀ-ž]", s):
        return None

    # strip common role tags left in-line
    s = re.sub(r"\b(captain|vice-captain|3rd captain|4th captain|hg|ct)\b", "", s, flags=re.I)
    s = s.strip(" -–—·,")
    s = re.sub(r"\s{2,}", " ", s).strip()

    # drop obvious column labels
    if s.lower() in {"player","name","position","pos","no.","no","nation","date of birth (age)"}:
        return None

    return s or None

def normalize_pos(text: str | None) -> str | None:
    if not text: return None
    t = text.strip()
    if POS_ABBR_RX.fullmatch(t.upper()):
        code = t.upper()
        return {"GKP":"GK","DEF":"DF","MID":"MF","FWD":"FW"}.get(code, code)
    tl = t.lower()
    for key in sorted(POS_WORDS.keys(), key=len, reverse=True):
        if key in tl:
            return POS_WORDS[key]
    return None

def header_map(tbl) -> dict:
    """Map normalized headers -> column index (player/name, pos/position, no/number)."""
    # Prefer the first <thead><tr> if present
    heads = []
    thead = tbl.find("thead")
    if thead:
        row = thead.find("tr")
        if row:
            heads = [th.get_text(" ", strip=True).lower() for th in row.find_all("th")]
    if not heads:
        # fallback: collect top-row THs
        heads = [th.get_text(" ", strip=True).lower() for th in tbl.find_all("th")]

    norm = []
    for h in heads:
        h2 = h
        h2 = h2.replace("squad no.", "no").replace("no.", "no").replace("shirt number","no")
        h2 = h2.replace("player name", "player").replace("name", "player")
        h2 = h2.replace("position", "pos")
        norm.append(h2)

    idx = {}
    for i, h in enumerate(norm):
        if "player" in h:
            idx["player"] = i
        if h in {"pos"} or "position" in h:
            idx["pos"] = i
        if h in {"no","number"}:
            idx["no"] = i
    return idx

def first_player_link(cell) -> str | None:
    # Prefer first /wiki/ link; skip File:/Category: etc.
    if hasattr(cell, "find_all"):
        for a in cell.find_all("a", href=True):
            href = a["href"]
            if href.startswith("/wiki/") and ":" not in href.split("/wiki/")[1]:
                nm = clean_name(a.get_text(" ", strip=True))
                if nm:
                    return nm
        return clean_name(cell.get_text(" ", strip=True))
    return clean_name(str(cell))

def extract_rows_from_table(tbl) -> list[dict]:
    hmap = header_map(tbl)
    if "player" not in hmap:
        return []
    players = []
    tbody = tbl.find("tbody")
    rows = tbody.find_all("tr") if tbody else tbl.find_all("tr")
    for tr in rows:
        tds = tr.find_all(["td","th"])
        if len(tds) <= max(hmap.values(), default=-1):
            continue
        row_txt = " ".join(td.get_text(" ", strip=True) for td in tds)
        if ROW_LOAN_RX.search(row_txt):
            continue

        # Name strictly from Player column
        name = first_player_link(tds[hmap["player"]])
        if not name:
            continue

        # Position (from pos column, else anywhere)
        pos = None
        if "pos" in hmap:
            pos = normalize_pos(tds[hmap["pos"]].get_text(" ", strip=True))
        if not pos:
            for td in tds:
                pos = normalize_pos(td.get_text(" ", strip=True))
                if pos: break
        if not pos:
            continue

        # Number (optional)
        number = None
        if "no" in hmap:
            raw_no = tds[hmap["no"]].get_text(" ", strip=True)
            number = raw_no if re.fullmatch(r"\d{1,2}", raw_no) else None
        else:
            m = re.search(r"\b(\d{1,2})\b", row_txt)
            number = m.group(1) if m else None

        players.append({"name": name, "number": number, "pos": pos})
    return players

def extract_from_list(lst) -> list[dict]:
    players = []
    for li in lst.find_all("li"):
        text = li.get_text(" ", strip=True)
        if ROW_LOAN_RX.search(text):
            continue
        a = li.find("a", href=True)
        nm = first_player_link(li) if a else None
        pos = normalize_pos(text)
        m = re.match(r"^\s*(\d{1,2})\s*[–-]\s*", text)
        number = m.group(1) if m else None
        if nm and pos:
            players.append({"name": nm, "number": number, "pos": pos})
    return players

def parse_squad(soup: BeautifulSoup, heading_needles: list[str]) -> list[dict]:
    h = find_heading(soup, heading_needles)
    if not h:
        return []
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

# ---------- Balanced 18 picker ----------
def pick_top18(players: list[dict]) -> list[dict]:
    """2 GK, 6 DF, 6 MF, 4 FW, then best remaining (prefer numbered, lowest number)."""
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
        has = 0 if (num and str(num).isdigit()) else 1
        numv = int(num) if (num and str(num).isdigit()) else 999
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

    out, seen = [], set()
    for p in picked:
        key = (p.get("name") or "").strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(p)
        if len(out) >= 18:
            break
    return out

# ---------- Main ----------
def main():
    out_path = pathlib.Path("data/players.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    all_players = []
    total_clubs = 0

    for club, season_title in SEASON_TITLES.items():
        got = []

        html = get_html(season_title)
        if html:
            soup = BeautifulSoup(html, "lxml")
            got = parse_squad(soup, SQUAD_HEADINGS_SEASON)
            if got:
                got = pick_top18(got)
                total_clubs += 1
                print(f"[ok] {club}: {len(got)} players (season page)")

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
