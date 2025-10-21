#!/usr/bin/env python3
"""
generate_players_json.py
Add an image_url field to each player in data/players.json by fuzzy-matching
filenames in public/players (and public/). Leaves image_url as "" when no match.
Creates a backup data/players.json.bak before writing.
"""
import os
import json
import unicodedata
import re
from pathlib import Path
from shutil import copyfile

REPO_ROOT = Path(__file__).resolve().parents[1]  # assumes script lives in scripts/
DATA_FILE = REPO_ROOT / "data" / "players.json"
BACKUP_FILE = DATA_FILE.with_suffix(DATA_FILE.suffix + ".bak")
PUBLIC_PLAYERS = REPO_ROOT / "public" / "players"
PUBLIC_ROOT = REPO_ROOT / "public"

def normalize_text(s: str) -> str:
    if not s:
        return ""
    # Unicode normalize, remove diacritics
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    # remove leading digits and punctuation
    s = re.sub(r'^[\d\W_]+', '', s)
    # remove parenthesized content
    s = re.sub(r'\(.*?\)', ' ', s)
    # strip non-alphanumeric to spaces
    s = re.sub(r'[^a-zA-Z0-9]+', ' ', s)
    s = s.strip().lower()
    s = re.sub(r'\s+', ' ', s)
    return s

def build_filename_index():
    index = []
    if PUBLIC_PLAYERS.exists() and PUBLIC_PLAYERS.is_dir():
        for fname in sorted(os.listdir(PUBLIC_PLAYERS)):
            if fname.startswith('.'):
                continue
            index.append({
                "src": f"/players/{fname}",
                "file": fname,
                "norm": normalize_text(fname)
            })
    if PUBLIC_ROOT.exists() and PUBLIC_ROOT.is_dir():
        for fname in sorted(os.listdir(PUBLIC_ROOT)):
            if fname.startswith('.') or (PUBLIC_PLAYERS.exists() and (PUBLIC_PLAYERS / fname).exists()):
                continue
            index.append({
                "src": f"/{fname}",
                "file": fname,
                "norm": normalize_text(fname)
            })
    return index

def best_match(player: dict, index: list):
    name = (player.get("name") or player.get("player_name") or "").strip()
    if not name:
        return None
    club = str(player.get("club") or player.get("team") or "").strip()
    norm_name = normalize_text(name)
    if not norm_name:
        return None
    tokens = [t for t in norm_name.split() if t]
    last = tokens[-1] if tokens else ""
    first_last = f"{tokens[0]} {last}" if len(tokens) >= 2 else norm_name
    norm_club = normalize_text(club)

    # 1) full name substring
    for f in index:
        if norm_name in f["norm"]:
            return f["src"]
    # 2) last name substring
    if last:
        for f in index:
            if last in f["norm"]:
                return f["src"]
    # 3) first+last
    for f in index:
        if first_last in f["norm"]:
            return f["src"]
    # 4) all tokens present (any order)
    for f in index:
        if all(tok in f["norm"] for tok in tokens):
            return f["src"]
    # 5) club substring
    if norm_club:
        for f in index:
            if norm_club in f["norm"]:
                return f["src"]
    return None

def main():
    if not DATA_FILE.exists():
        print(f"data/players.json not found at {DATA_FILE}. Aborting.")
        return

    # load players
    with DATA_FILE.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, list):
        print("Expected players.json to contain a JSON array.")
        return

    # backup
    copyfile(DATA_FILE, BACKUP_FILE)
    print(f"Backup written to {BACKUP_FILE}")

    index = build_filename_index()
    print(f"Scanned {len(index)} candidate image files")

    updated = []
    changed = 0
    for p in data:
        match = best_match(p, index)
        image_url = match or ""  # empty string when no confident match (per your choice)
        if p.get("image_url") != image_url:
            changed += 1
        newp = dict(p)
        newp["image_url"] = image_url
        updated.append(newp)

    # write back
    with DATA_FILE.open("w", encoding="utf-8") as fh:
        json.dump(updated, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"Updated {changed} entries in {DATA_FILE}")

if __name__ == "__main__":
    main()
