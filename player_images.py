# File: player_images.py
# Requests-only image pipeline: Wikidata -> Wikimedia Commons
# Exports functions used by fetch_all_players.py, including player_image_by_qid.

from pathlib import Path
import requests, time, random, csv
from datetime import datetime, timedelta
from urllib.parse import quote as urlquote

# Config
USER_AGENT = "player-images-bot/1.0 (https://footballspinner.com/) mzaharievtest-cmd"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
CACHE_TTL_DAYS = 7
FALLBACK_LOCAL = "/img/silhouette-player.png"

# HTTP session
_session = requests.Session()
_session.headers.update({"User-Agent": USER_AGENT})

# Small in-memory TTL cache
_cache = {}
def _cached(key):
    entry = _cache.get(key)
    if not entry:
        return None
    value, expires = entry
    if datetime.utcnow() < expires:
        return value
    del _cache[key]
    return None
def _set_cache(key, value, days=CACHE_TTL_DAYS):
    _cache[key] = (value, datetime.utcnow() + timedelta(days=days))

def _polite():
    time.sleep(random.uniform(0, 0.15))

def _norm(s):
    return " ".join((s or "").strip().lower().split())

# --- Wikidata helpers ---
def wikidata_id_for(name):
    if not name: return None
    key = f"qid:{_norm(name)}"
    cached = _cached(key)
    if cached is not None:
        return cached
    _polite()
    params = {"action":"wbsearchentities","format":"json","language":"en","search":name,"type":"item","limit":1}
    r = _session.get(WIKIDATA_API, params=params, timeout=10)
    r.raise_for_status()
    data = r.json()
    qid = None
    if data.get("search"):
        qid = data["search"][0].get("id")
    _set_cache(key, qid)
    return qid

def wikidata_entity(qid):
    if not qid: return None
    key = f"entity:{qid}"
    cached = _cached(key)
    if cached is not None:
        return cached
    _polite()
    params = {"action":"wbgetentities","format":"json","ids":qid,"props":"claims|labels|descriptions"}
    r = _session.get(WIKIDATA_API, params=params, timeout=12)
    r.raise_for_status()
    data = r.json()
    ent = data.get("entities", {}).get(qid)
    _set_cache(key, ent)
    return ent

def _claim_value(entity, pid):
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

# --- Commons helpers ---
def commons_meta(filename):
    if not filename:
        return None
    fn = filename
    if fn.lower().startswith("file:"):
        fn = fn.split(":",1)[1]
    key = f"commons:{fn}"
    cached = _cached(key)
    if cached is not None:
        return cached
    _polite()
    params = {"action":"query","format":"json","titles":f"File:{fn}","prop":"imageinfo","iiprop":"url|extmetadata"}
    r = _session.get(COMMONS_API, params=params, timeout=12)
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
            ext = ii.get("extmetadata", {}) or {}
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
    fn = filename
    if fn.lower().startswith("file:"):
        fn = fn.split(":",1)[1]
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{urlquote(fn)}?width={int(width)}"

# --- Image resolution (QID-based) ---
def player_image_by_qid(qid, width=800):
    if not qid:
        return None
    key = f"player_image_by_qid:{qid}:{width}"
    cached = _cached(key)
    if cached is not None:
        return cached

    ent = wikidata_entity(qid)
    name = None
    if ent:
        labels = ent.get("labels", {})
        name = (labels.get("en") or {}).get("value")

    filename = None
    file_meta = {}
    image_url = None
    file_page = None
    author = None
    license = None
    source = "fallback"

    # Try P18 on player
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
        # fallback: current club P54 -> club logo P154
        club_qid = _claim_value(ent, "P54")
        if club_qid:
            club_ent = wikidata_entity(club_qid)
            logo_fn = _claim_value(club_ent, "P154")
            if logo_fn:
                filename = logo_fn
                file_meta = commons_meta(filename) or {}
                image_url = _filepath_for_commons(filename, min(width, 400))
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
        "name": name or qid,
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

def player_image(name, width=800):
    if not name:
        return {"name": name, "qid": None, "filename": None, "image_url": FALLBACK_LOCAL, "file_page": None, "author": "Wikimedia contributor", "license": "CC", "source": "fallback"}
    qid = wikidata_id_for(name)
    if qid:
        return player_image_by_qid(qid, width=width)
    return {"name": name, "qid": None, "filename": Path(FALLBACK_LOCAL).name, "image_url": FALLBACK_LOCAL, "file_page": None, "author": "Wikimedia contributor", "license": "CC", "source": "fallback"}

def club_logo(club_name, width=400):
    if not club_name:
        return {"name": club_name, "qid": None, "filename": None, "image_url": FALLBACK_LOCAL, "file_page": None, "author": "Wikimedia contributor", "license": "CC", "source": "fallback"}
    qid = wikidata_id_for(club_name)
    if not qid:
        return {"name": club_name, "qid": None, "filename": Path(FALLBACK_LOCAL).name, "image_url": FALLBACK_LOCAL, "file_page": None, "author": "Wikimedia contributor", "license": "CC", "source": "fallback"}
    ent = wikidata_entity(qid)
    logo = _claim_value(ent, "P154") or _claim_value(ent, "P18")
    if logo:
        meta = commons_meta(logo) or {}
        return {"name": club_name, "qid": qid, "filename": logo, "image_url": _filepath_for_commons(logo, width), "file_page": meta.get("file_page"), "author": meta.get("author"), "license": meta.get("license"), "source": "club"}
    return {"name": club_name, "qid": qid, "filename": Path(FALLBACK_LOCAL).name, "image_url": FALLBACK_LOCAL, "file_page": None, "author": "Wikimedia contributor", "license": "CC", "source": "fallback"}

# --- save & attribution ---
def save_player_image(record, out_dir="player_images"):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    url = record.get("image_url")
    fname = record.get("filename") or _norm(record.get("name","unknown")).replace(" ","_")
    safe_name = "".join(c for c in fname if c.isalnum() or c in "._-() ").strip()
    target = out / safe_name
    if not url:
        return None
    if str(url).startswith("/"):
        src = Path(url.lstrip("/"))
        try:
            if src.exists():
                with src.open("rb") as rf, target.open("wb") as wf:
                    wf.write(rf.read())
                return target
            return None
        except Exception:
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
    header = ["name", "qid", "filename", "file_page", "author", "license", "source", "image_url", "_saved_path"]
    with p.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        for r in records:
            w.writerow([r.get("name"), r.get("qid"), r.get("filename"), r.get("file_page"), r.get("author"), r.get("license"), r.get("source"), r.get("image_url"), r.get("_saved_path","")])
    return p

# --- HTML helper ---
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

if __name__ == "__main__":
    names = ["Erling Haaland","Bukayo Saka","Jude Bellingham"]
    recs = []
    for n in names:
        r = player_image(n, width=600)
        print(r)
        p = save_player_image(r)
        print("Saved:", p)
        r["_saved_path"] = str(p) if p else ""
        recs.append(r)
    save_attributions(recs)
