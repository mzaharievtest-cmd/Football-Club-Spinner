"""
player_images.py
A small, requests-only pipeline to fetch player images via Wikidata + Wikimedia Commons.

Exports:
- wikidata_id_for(name) -> QID or None
- wikidata_entity(qid) -> dict (raw entity JSON)
- commons_meta(filename) -> {file_page, author, license, file_url}
- player_image(name, width=800) -> {name,qid,filename,image_url,file_page,author,license,source}
- club_logo(club_name, width=400) -> same shape with source='club'
- save_player_image(record, out_dir='player_images') -> Path
- save_attributions(records, csv_path='player_images/attribution.csv')
- figure_html(record, alt=None, width=800, height=None)

Notes:
- Polite: small random delay 0-150ms between requests.
- In-memory TTL cache by normalized name (default 7 days).
- No scraping of club sites; only Wikidata + Commons APIs.
"""
from pathlib import Path
import requests, time, random, os, csv
from datetime import datetime, timedelta

# Configuration
USER_AGENT = "player-images-bot/1.0 (https://example.org/) mzaharievtest-cmd"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
CACHE_TTL_DAYS = 7

_session = requests.Session()
_session.headers.update({"User-Agent": USER_AGENT})

# Simple TTL cache
_cache = {}
def _cached(key, ttl_days=CACHE_TTL_DAYS):
    entry = _cache.get(key)
    if entry:
        value, expires = entry
        if datetime.utcnow() < expires:
            return value
        else:
            del _cache[key]
    return None
def _set_cache(key, value, ttl_days=CACHE_TTL_DAYS):
    _cache[key] = (value, datetime.utcnow() + timedelta(days=ttl_days))

def _polite():
    time.sleep(random.uniform(0, 0.15))

def _norm(s):
    return " ".join((s or "").strip().lower().split())

# 1) Search Wikidata (wbsearchentities) for QID.
def wikidata_id_for(name):
    if not name: return None
    key = f"qid:{_norm(name)}"
    cached = _cached(key)
    if cached is not None:
        return cached
    _polite()
    params = {
        "action": "wbsearchentities",
        "format": "json",
        "language": "en",
        "search": name,
        "type": "item",
        "limit": 1
    }
    r = _session.get(WIKIDATA_API, params=params, timeout=10)
    r.raise_for_status()
    data = r.json()
    qid = None
    if "search" in data and data["search"]:
        qid = data["search"][0].get("id")
    _set_cache(key, qid)
    return qid

# 2) Read entity JSON; get claims etc.
def wikidata_entity(qid):
    if not qid: return None
    key = f"entity:{qid}"
    cached = _cached(key)
    if cached is not None:
        return cached
    _polite()
    params = {
        "action": "wbgetentities",
        "format": "json",
        "ids": qid,
        "props": "claims|labels|descriptions",
        "languages": "en"
    }
    r = _session.get(WIKIDATA_API, params=params, timeout=10)
    r.raise_for_status()
    data = r.json()
    ent = data.get("entities", {}).get(qid)
    _set_cache(key, ent)
    return ent

# Commons metadata for a filename (P18 value)
def commons_meta(filename):
    if not filename:
        return None
    # Normalize filename (ensure no "File:" prefix)
    fn = filename
    if fn.lower().startswith("file:"):
        fn = fn.split(":", 1)[1]
    key = f"commons:{fn}"
    cached = _cached(key)
    if cached is not None:
        return cached
    _polite()
    params = {
        "action": "query",
        "format": "json",
        "titles": f"File:{fn}",
        "prop": "imageinfo",
        "iiprop": "url|extmetadata"
    }
    r = _session.get(COMMONS_API, params=params, timeout=10)
    r.raise_for_status()
    data = r.json()
    pages = data.get("query", {}).get("pages", {})
    file_page = f"https://commons.wikimedia.org/wiki/File:{fn}"
    author = "Wikimedia contributor"
    license = "CC"
    file_url = None
    for p in pages.values():
        iinfo = p.get("imageinfo")
        if iinfo:
            ii = iinfo[0]
            file_url = ii.get("url")
            ext = ii.get("extmetadata", {})
            artist = ext.get("Artist", {}).get("value") if ext.get("Artist") else None
            credit = ext.get("Credit", {}).get("value") if ext.get("Credit") else None
            license_short = ext.get("LicenseShortName", {}).get("value") if ext.get("LicenseShortName") else None
            license_url = ext.get("LicenseUrl", {}).get("value") if ext.get("LicenseUrl") else None
            author = artist or credit or author
            if license_short and license_url:
                license = f"{license_short} ({license_url})"
            elif license_short:
                license = license_short
            break
    meta = {"file_page": file_page, "author": author, "license": license, "file_url": file_url}
    _set_cache(key, meta)
    return meta

def _filepath_for_commons(filename, width):
    # Use Special:FilePath with width param — returns a URL that redirects to the scaled image.
    fn = filename
    if fn.lower().startswith("file:"):
        fn = fn.split(":",1)[1]
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{requests.utils.requote_uri(fn)}?width={int(width)}"

# Helper to extract P18 or P154 or P54 from entity claims
def _claim_value(entity, pid):
    # returns first value (string for commons filename or qid for items)
    if not entity: return None
    claims = entity.get("claims", {})
    if pid not in claims: return None
    mains = claims[pid]
    if not mains: return None
    sn = mains[0].get("mainsnak", {})
    dv = sn.get("datavalue")
    if not dv: return None
    if dv.get("type") == "string":
        return dv.get("value")
    if dv.get("type") == "wikibase-entityid":
        return dv.get("value", {}).get("id")
    return None

# 4) Player image flow
FALLBACK_LOCAL = "/img/silhouette-player.png"

def player_image(name, width=800):
    norm = _norm(name)
    key = f"player_image:{norm}:{width}"
    cached = _cached(key)
    if cached is not None:
        return cached

    qid = wikidata_id_for(name)
    filename = None
    file_meta = {}
    source = "fallback"
    image_url = None
    file_page = None
    author = None
    license = None

    if qid:
        ent = wikidata_entity(qid)
        # Try P18 (image)
        p18 = _claim_value(ent, "P18")
        if p18:
            filename = p18
            file_meta = commons_meta(filename) or {}
            image_url = _filepath_for_commons(filename, width)
            file_page = file_meta.get("file_page")
            author = file_meta.get("author")
            license = file_meta.get("license")
            source = "player"
        else:
            # Try current club via P54
            club_qid = _claim_value(ent, "P54")
            if club_qid:
                club_ent = wikidata_entity(club_qid)
                logo_fn = _claim_value(club_ent, "P154")  # logo image
                if logo_fn:
                    filename = logo_fn
                    file_meta = commons_meta(filename) or {}
                    image_url = _filepath_for_commons(filename, min(width,400))
                    file_page = file_meta.get("file_page")
                    author = file_meta.get("author")
                    license = file_meta.get("license")
                    source = "club"

    if not image_url:
        # fallback
        image_url = FALLBACK_LOCAL
        filename = Path(FALLBACK_LOCAL).name
        file_page = None
        author = "Wikimedia contributor"
        license = "CC"
        source = "fallback"

    rec = {
        "name": name,
        "qid": qid,
        "filename": filename,
        "image_url": image_url,
        "file_page": file_page,
        "author": author,
        "license": license,
        "source": source
    }
    _set_cache(key, rec)
    return rec

def club_logo(club_name, width=400):
    norm = _norm(club_name)
    key = f"club_logo:{norm}:{width}"
    cached = _cached(key)
    if cached is not None:
        return cached
    qid = wikidata_id_for(club_name)
    filename = None
    image_url = None
    file_meta = {}
    file_page = None
    author = None
    license = None
    source = "fallback"
    if qid:
        ent = wikidata_entity(qid)
        logo = _claim_value(ent, "P154") or _claim_value(ent, "P18")
        if logo:
            filename = logo
            file_meta = commons_meta(filename) or {}
            image_url = _filepath_for_commons(filename, width)
            file_page = file_meta.get("file_page")
            author = file_meta.get("author")
            license = file_meta.get("license")
            source = "club"
    if not image_url:
        image_url = FALLBACK_LOCAL
        filename = Path(FALLBACK_LOCAL).name
        author = "Wikimedia contributor"
        license = "CC"
        source = "fallback"
    rec = {
        "name": club_name,
        "qid": qid,
        "filename": filename,
        "image_url": image_url,
        "file_page": file_page,
        "author": author,
        "license": license,
        "source": source
    }
    _set_cache(key, rec)
    return rec

def save_player_image(record, out_dir="player_images"):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    url = record.get("image_url")
    fname = record.get("filename") or f"{_norm(record.get('name','unknown'))}.jpg"
    # sanitize filename
    safe_name = "".join(c for c in fname if c.isalnum() or c in "._-() ").strip()
    target = out / safe_name
    if str(url).startswith("/"):
        # local fallback - try to read relative to repo root
        src = Path(url.lstrip("/"))
        if src.exists():
            with src.open("rb") as rf, target.open("wb") as wf:
                wf.write(rf.read())
            return target
        else:
            # nothing to fetch
            return None
    try:
        _polite()
        resp = _session.get(url, stream=True, timeout=20)
        resp.raise_for_status()
        with target.open("wb") as f:
            for chunk in resp.iter_content(8192):
                if chunk:
                    f.write(chunk)
        return target
    except Exception:
        return None

def save_attributions(records, csv_path="player_images/attribution.csv"):
    p = Path(csv_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    header = ["name", "qid", "filename", "file_page", "author", "license", "source", "file_url"]
    with p.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        for r in records:
            w.writerow([
                r.get("name"),
                r.get("qid"),
                r.get("filename"),
                r.get("file_page"),
                r.get("author"),
                r.get("license"),
                r.get("source"),
                r.get("image_url")
            ])
    return p

def figure_html(record, alt=None, width=800, height=None):
    img_src = record.get("image_url", "")
    caption_author = record.get("author") or "Wikimedia contributor"
    license = record.get("license") or "CC"
    file_page = record.get("file_page") or "#"
    alt_text = alt or record.get("name") or ""
    h_attr = f' height="{int(height)}"' if height else ""
    html = (
        f'<figure>'
        f'<img src="{img_src}" loading="lazy" decoding="async" alt="{alt_text}" width="{int(width)}"{h_attr}>'
        f'<figcaption>Photo: <a href="{file_page}">{caption_author}</a> — {license}</figcaption>'
        f'</figure>'
    )
    return html

# Simple demo helper (not executed on import)
if __name__ == "__main__":
    names = ["Erling Haaland", "Bukayo Saka", "Jude Bellingham"]
    recs = []
    for n in names:
        r = player_image(n, width=600)
        print("Found:", r)
        saved = save_player_image(r)
        print("Saved to:", saved)
        recs.append(r)
    save_attributions(recs)
