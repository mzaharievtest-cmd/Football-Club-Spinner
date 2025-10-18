/**
 * wikimedia-player.ts
 *
 * Small TypeScript utility to resolve legally-usable football player images via Wikidata + Wikimedia Commons.
 * Target: Node 18+/Next.js (ESM). No external deps.
 *
 * Exports:
 * - wikidataIdFor(name)
 * - wikidataEntity(qid)
 * - commonsImageMeta(fileName)
 * - playerImage(name, width)
 * - clubLogo(clubName, width)
 * - figureHtml(img, opts)
 *
 * Notes:
 * - Caching is in-memory (Map) with optional TTL.
 * - Fallbacks: player P18 -> player's club logo (P54 -> P154) -> local silhouette '/img/silhouette-player.png'
 */

export type PlayerImg = {
  source: 'player' | 'club' | 'fallback';
  name?: string;
  qid?: string;
  imageFile?: string;      // Commons file name (e.g., "Erling_Haaland_by_...jpg")
  imageUrl: string;        // Direct file path URL (Special:FilePath ... ?width=)
  filePageUrl?: string;    // Commons file page (for attribution)
  author?: string;         // cleaned author string
  license?: string;        // license short name or URL
};

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const WIKIDATA_ENTITYDATA = 'https://www.wikidata.org/wiki/Special:EntityData';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

const SILHOUETTE = '/img/silhouette-player.png'; // fallback asset path

// Simple in-memory caches
const cacheQid = new Map<string, { qid: string; ts: number }>();
const cacheEntity = new Map<string, { entity: any; ts: number }>();
const cacheCommons = new Map<string, { meta: any; ts: number }>();
const cachePlayerImg = new Map<string, { img: PlayerImg; ts: number }>();
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

function now() { return Date.now(); }
function fromCache<T>(map: Map<string, { ts: number; [k: string]: any }>, key: string): T | null {
  const v = map.get(key);
  if (!v) return null;
  if (now() - v.ts > CACHE_TTL) { map.delete(key); return null; }
  return (v as any).value ?? (v as any).entity ?? (v as any).meta ?? (v as any).img ?? null;
}
function setCache(map: Map<string, any>, key: string, value: any) {
  map.set(key, { value, ts: now() });
}

/* ------------------------------
   Helpers
   ------------------------------ */

function joinUrl(base: string, params: Record<string, string>): string {
  const u = new URL(base);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}

function normalizeFileName(fn: string): string {
  // remove leading "File:" if present, replace underscores with spaces kept as is
  return fn.replace(/^File:/i, '').trim();
}

function filePathUrl(fileName: string, width = 800): string {
  const fn = normalizeFileName(fileName).replace(/ /g, '_');
  // use Special:FilePath which redirects to actual file; include width param
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fn)}?width=${encodeURIComponent(String(width))}`;
}

function filePageUrl(fileName: string): string {
  const fn = normalizeFileName(fileName).replace(/ /g, '_');
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fn)}`;
}

function stripHtml(html?: string): string | undefined {
  if (!html) return undefined;
  // basic removal of HTML tags and trimming; also unescape some HTML entities
  const tmp = html.replace(/<\/?[^>]+(>|$)/g, '').trim();
  return tmp.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
}

/* ------------------------------
   Wikidata helpers
   ------------------------------ */

/**
 * Search Wikidata for an entity and return the top QID (wbsearchentities).
 */
export async function wikidataIdFor(name: string): Promise<string> {
  const cacheKey = `qid:${name.toLowerCase()}`;
  const cached = fromCache<{ qid: string }>(cacheQid as any, cacheKey);
  if (cached) return cached.qid;

  const url = joinUrl(WIKIDATA_API, {
    action: 'wbsearchentities',
    search: name,
    language: 'en',
    format: 'json',
    limit: '1',
    type: 'item'
  });

  const res = await fetch(url, { headers: { 'User-Agent': 'FootballSpinner/1.0 (mzaharievtest-cmd)'} });
  if (!res.ok) throw new Error(`Wikidata search failed: ${res.status}`);
  const json = await res.json();
  const result = (json?.search && json.search[0]) ? json.search[0] : null;
  if (!result) throw new Error(`No Wikidata entity found for "${name}"`);
  const qid = result.id;
  cacheQid.set(cacheKey, { value: { qid }, ts: now() });
  return qid;
}

/**
 * Fetch full Wikidata entity JSON via Special:EntityData/QID.json
 */
export async function wikidataEntity(qid: string): Promise<any> {
  const cached = fromCache<any>(cacheEntity as any, qid);
  if (cached) return cached;

  const url = `${WIKIDATA_ENTITYDATA}/${encodeURIComponent(qid)}.json`;
  const res = await fetch(url, { headers: { 'User-Agent': 'FootballSpinner/1.0 (mzaharievtest-cmd)'} });
  if (!res.ok) throw new Error(`Failed to fetch entity ${qid}: ${res.status}`);
  const json = await res.json();
  const entity = json?.entities?.[qid];
  if (!entity) throw new Error(`Entity data missing for ${qid}`);
  cacheEntity.set(qid, { value: entity, ts: now() });
  return entity;
}

/* ------------------------------
   Commons helpers
   ------------------------------ */

/**
 * Get extmetadata for a Commons file name (e.g., "Erling_Haaland.jpg")
 * Returns { filePageUrl, author?, license? }
 */
export async function commonsImageMeta(fileName: string): Promise<{ filePageUrl: string; author?: string; license?: string }> {
  const fnNorm = normalizeFileName(fileName);
  const cacheKey = `commons:${fnNorm}`;
  const cached = fromCache<any>(cacheCommons as any, cacheKey);
  if (cached) return cached;

  const title = `File:${fnNorm}`;
  const url = joinUrl(COMMONS_API, {
    action: 'query',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'extmetadata',
    format: 'json',
    origin: '*' // for browser; safe even in node
  });

  const res = await fetch(url, { headers: { 'User-Agent': 'FootballSpinner/1.0 (mzaharievtest-cmd)'} });
  if (!res.ok) throw new Error(`Commons API failed: ${res.status}`);
  const json = await res.json();

  // traverse results
  const pages = json?.query?.pages;
  if (!pages) throw new Error(`No pages returned from Commons for ${title}`);
  // pages is object keyed by pageid
  const page = Object.values(pages)[0] as any;
  const imageinfo = page?.imageinfo?.[0];
  const ext = imageinfo?.extmetadata ?? {};
  const artistRaw = ext?.Artist?.value ?? ext?.Artist ?? undefined;
  const licenseShort = ext?.LicenseShortName?.value ?? ext?.LicenseShortName ?? undefined;
  const licenseUrl = ext?.LicenseUrl?.value ?? ext?.LicenseUrl ?? undefined;

  const author = stripHtml(artistRaw);
  const license = licenseShort ? (licenseUrl ? `${licenseShort} (${licenseUrl})` : licenseShort) : (licenseUrl ?? undefined);
  const filePage = `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`;

  const meta = { filePageUrl: filePage, author, license };
  cacheCommons.set(cacheKey, { value: meta, ts: now() });
  return meta;
}

/* ------------------------------
   Primary resolvers
   ------------------------------ */

/**
 * Try to get P18 (image) from a Wikidata entity object.
 * entity: wikidata entity
 * returns fileName or undefined
 */
function getP18FromEntity(entity: any): string | undefined {
  try {
    const claims = entity?.claims;
    if (!claims) return undefined;
    const p18 = claims.P18;
    if (!p18 || !p18.length) return undefined;
    // usually mainsnak.datavalue.value
    const val = p18[0]?.mainsnak?.datavalue?.value;
    if (typeof val === 'string' && val.trim().length) return val;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Try to get current club QID from player's entity (P54 member of sports team)
 */
function getClubQidFromPlayer(entity: any): string | undefined {
  try {
    const claims = entity?.claims;
    if (!claims) return undefined;
    const p54 = claims.P54;
    if (!p54 || !p54.length) return undefined;
    // pick first club claim that has a datavalue entity id
    for (const claim of p54) {
      const id = claim?.mainsnak?.datavalue?.value?.id;
      if (id) return id;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Given a player name, resolve image with fallbacks:
 *  - Player P18
 *  - Player's club logo (P54 -> club entity P154)
 *  - Local silhouette
 */
export async function playerImage(name: string, width = 800): Promise<PlayerImg> {
  const cacheKey = `playerImg:${name.toLowerCase()}:${width}`;
  const cached = fromCache<any>(cachePlayerImg as any, cacheKey);
  if (cached) return cached;

  // 1) resolve player QID
  let qid: string | undefined;
  try { qid = await wikidataIdFor(name); } catch (e) { /* continue to fallback */ }

  // 2) get entity
  let entity: any = undefined;
  if (qid) {
    try { entity = await wikidataEntity(qid); } catch (e) { /* ignore */ }
  }

  // 3) attempt P18 on player
  if (entity) {
    const p18 = getP18FromEntity(entity);
    if (p18) {
      try {
        const meta = await commonsImageMeta(p18);
        const url = filePathUrl(p18, width);
        const result: PlayerImg = {
          source: 'player',
          name,
          qid,
          imageFile: normalizeFileName(p18),
          imageUrl: url,
          filePageUrl: meta.filePageUrl,
          author: meta.author,
          license: meta.license
        };
        setCache(cachePlayerImg, cacheKey, result);
        return result;
      } catch (e) {
        // if commons meta fails, attempt fallback to club before final fallback
      }
    }
  }

  // 4) fallback: player's club logo via P54 -> club entity P154
  try {
    const clubQid = entity ? getClubQidFromPlayer(entity) : undefined;
    if (clubQid) {
      const clubEntity = await wikidataEntity(clubQid);
      // club logo P154
      const logoClaim = clubEntity?.claims?.P154;
      const logoFile = logoClaim && logoClaim.length ? logoClaim[0]?.mainsnak?.datavalue?.value : undefined;
      if (typeof logoFile === 'string' && logoFile) {
        const meta = await commonsImageMeta(logoFile);
        const url = filePathUrl(logoFile, Math.min(width, 600)); // club logos smaller
        const result: PlayerImg = {
          source: 'club',
          name,
          qid,
          imageFile: normalizeFileName(logoFile),
          imageUrl: url,
          filePageUrl: meta.filePageUrl,
          author: meta.author,
          license: meta.license
        };
        setCache(cachePlayerImg, cacheKey, result);
        return result;
      }
    }
  } catch (e) {
    // ignore and continue to final fallback
  }

  // 5) final fallback - silhouette
  const fallback: PlayerImg = {
    source: 'fallback',
    name,
    imageUrl: SILHOUETTE
  };
  setCache(cachePlayerImg, cacheKey, fallback);
  return fallback;
}

/**
 * Resolve club logo by club name (search qid, then P154).
 */
export async function clubLogo(clubName: string, width = 400): Promise<PlayerImg> {
  const cacheKey = `clubLogo:${clubName.toLowerCase()}:${width}`;
  const cached = fromCache<any>(cachePlayerImg as any, cacheKey);
  if (cached) return cached;

  try {
    const qid = await wikidataIdFor(clubName);
    const entity = await wikidataEntity(qid);
    const logoClaim = entity?.claims?.P154;
    const logoFile = logoClaim && logoClaim.length ? logoClaim[0]?.mainsnak?.datavalue?.value : undefined;
    if (typeof logoFile === 'string' && logoFile) {
      const meta = await commonsImageMeta(logoFile);
      const url = filePathUrl(logoFile, width);
      const result: PlayerImg = {
        source: 'club',
        name: clubName,
        qid,
        imageFile: normalizeFileName(logoFile),
        imageUrl: url,
        filePageUrl: meta.filePageUrl,
        author: meta.author,
        license: meta.license
      };
      setCache(cachePlayerImg, cacheKey, result);
      return result;
    }
  } catch (e) {
    // fall through to fallback
  }

  return {
    source: 'fallback',
    name: clubName,
    imageUrl: '/img/silhouette-club.png'
  };
}

/* ------------------------------
   Figure HTML builder
   ------------------------------ */

export function figureHtml(img: PlayerImg, opts?: { alt?: string; width?: number; height?: number; className?: string }): string {
  const { alt = img.name ?? '', width = undefined, height = undefined, className = '' } = opts ?? {};
  // Choose display attribution strings
  const author = img.author ? escapeHtml(img.author) : 'Wikimedia contributor';
  const license = img.license ? escapeHtml(img.license) : 'CC';
  const fileLink = img.filePageUrl ? escapeHtml(img.filePageUrl) : (img.imageFile ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(img.imageFile)}` : '#');

  const imgAttrs: string[] = [
    `src="${escapeAttr(img.imageUrl)}"`,
    `alt="${escapeAttr(alt)}"`,
    `loading="lazy"`
  ];
  if (width) imgAttrs.push(`width="${width}"`);
  if (height) imgAttrs.push(`height="${height}"`);
  if (className) imgAttrs.push(`class="${escapeAttr(className)}"`);

  const caption = img.filePageUrl
    ? `Photo: <a href="${escapeAttr(fileLink)}" target="_blank" rel="noopener noreferrer">${author}</a> — ${license}`
    : `Photo: ${author} — ${license}`;

  return `<figure class="fs-figure">${'<img ' + imgAttrs.join(' ') + '>'}<figcaption class="fs-attrib">${caption}</figcaption></figure>`;
}

/* ------------------------------
   Utility helpers
   ------------------------------ */

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function escapeAttr(s: string) { return escapeHtml(s); }

/* ------------------------------
   Usage snippet (example)
   ------------------------------ */

/**
 * Example usage (Node/Next.js):
 *
 * import { playerImage, figureHtml } from './wikimedia-player';
 *
 * (async () => {
 *   const img = await playerImage('Erling Haaland', 800);
 *   console.log(img);
 *   const fig = figureHtml(img, { alt: 'Erling Haaland', width: 800, className: 'rounded' });
 *   console.log(fig);
 * })();
 */

/* ------------------------------
   End of file
   ------------------------------ */
