/**
 * lib/wikimedia-player.ts
 *
 * Server-side utility (Node/Next.js) to resolve legally-usable football player images via Wikidata + Wikimedia Commons.
 * Moved to /lib so it is not accidentally included on the client bundle.
 *
 * NOTE: This file is server-only. Do not import it in client-side code.
 */

export type PlayerImg = {
  source: 'player' | 'club' | 'fallback';
  name?: string;
  qid?: string;
  imageFile?: string;
  imageUrl: string;
  filePageUrl?: string;
  author?: string;
  license?: string;
};

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const WIKIDATA_ENTITYDATA = 'https://www.wikidata.org/wiki/Special:EntityData';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

const SILHOUETTE = '/img/silhouette-player.png'; // fallback asset path

const cacheQid = new Map<string, { value: any; ts: number }>();
const cacheEntity = new Map<string, { value: any; ts: number }>();
const cacheCommons = new Map<string, { value: any; ts: number }>();
const cachePlayerImg = new Map<string, { value: PlayerImg; ts: number }>();
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

function now() { return Date.now(); }
function fromCache<T>(map: Map<string, { value: any; ts: number }>, key: string): T | null {
  const v = map.get(key);
  if (!v) return null;
  if (now() - v.ts > CACHE_TTL) { map.delete(key); return null; }
  return (v as any).value ?? null;
}
function setCache(map: Map<string, any>, key: string, value: any) {
  map.set(key, { value, ts: now() });
}

function joinUrl(base: string, params: Record<string, string>): string {
  const u = new URL(base);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}
function normalizeFileName(fn: string): string { return fn.replace(/^File:/i, '').trim(); }
function filePathUrl(fileName: string, width = 800): string {
  const fn = normalizeFileName(fileName).replace(/ /g, '_');
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fn)}?width=${encodeURIComponent(String(width))}`;
}
function stripHtml(html?: string): string | undefined {
  if (!html) return undefined;
  const tmp = html.replace(/<\/?[^>]+(>|$)/g, '').trim();
  return tmp.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
}

export async function wikidataIdFor(name: string): Promise<string> {
  const cacheKey = `qid:${name.toLowerCase()}`;
  const cached = fromCache<{ qid: string }>(cacheQid, cacheKey);
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
  setCache(cacheQid, cacheKey, { qid });
  return qid;
}

export async function wikidataEntity(qid: string): Promise<any> {
  const cached = fromCache<any>(cacheEntity, qid);
  if (cached) return cached;

  const url = `${WIKIDATA_ENTITYDATA}/${encodeURIComponent(qid)}.json`;
  const res = await fetch(url, { headers: { 'User-Agent': 'FootballSpinner/1.0 (mzaharievtest-cmd)'} });
  if (!res.ok) throw new Error(`Failed to fetch entity ${qid}: ${res.status}`);
  const json = await res.json();
  const entity = json?.entities?.[qid];
  if (!entity) throw new Error(`Entity data missing for ${qid}`);
  setCache(cacheEntity, qid, entity);
  return entity;
}

export async function commonsImageMeta(fileName: string): Promise<{ filePageUrl: string; author?: string; license?: string }> {
  const fnNorm = normalizeFileName(fileName);
  const cacheKey = `commons:${fnNorm}`;
  const cached = fromCache<any>(cacheCommons, cacheKey);
  if (cached) return cached;

  const title = `File:${fnNorm}`;
  const url = joinUrl(COMMONS_API, {
    action: 'query',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'extmetadata',
    format: 'json',
    origin: '*'
  });

  const res = await fetch(url, { headers: { 'User-Agent': 'FootballSpinner/1.0 (mzaharievtest-cmd)'} });
  if (!res.ok) throw new Error(`Commons API failed: ${res.status}`);
  const json = await res.json();

  const pages = json?.query?.pages;
  if (!pages) throw new Error(`No pages returned from Commons for ${title}`);
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
  setCache(cacheCommons, cacheKey, meta);
  return meta;
}

function getP18FromEntity(entity: any): string | undefined {
  try {
    const claims = entity?.claims;
    if (!claims) return undefined;
    const p18 = claims.P18;
    if (!p18 || !p18.length) return undefined;
    const val = p18[0]?.mainsnak?.datavalue?.value;
    if (typeof val === 'string' && val.trim().length) return val;
    return undefined;
  } catch {
    return undefined;
  }
}

function getClubQidFromPlayer(entity: any): string | undefined {
  try {
    const claims = entity?.claims;
    if (!claims) return undefined;
    const p54 = claims.P54;
    if (!p54 || !p54.length) return undefined;
    for (const claim of p54) {
      const id = claim?.mainsnak?.datavalue?.value?.id;
      if (id) return id;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function playerImage(name: string, width = 800): Promise<PlayerImg> {
  const cacheKey = `playerImg:${name.toLowerCase()}:${width}`;
  const cached = fromCache<any>(cachePlayerImg, cacheKey);
  if (cached) return cached;

  let qid: string | undefined;
  try { qid = await wikidataIdFor(name); } catch (e) {}

  let entity: any = undefined;
  if (qid) {
    try { entity = await wikidataEntity(qid); } catch (e) {}
  }

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
      } catch (e) {}
    }
  }

  try {
    const clubQid = entity ? getClubQidFromPlayer(entity) : undefined;
    if (clubQid) {
      const clubEntity = await wikidataEntity(clubQid);
      const logoClaim = clubEntity?.claims?.P154;
      const logoFile = logoClaim && logoClaim.length ? logoClaim[0]?.mainsnak?.datavalue?.value : undefined;
      if (typeof logoFile === 'string' && logoFile) {
        const meta = await commonsImageMeta(logoFile);
        const url = filePathUrl(logoFile, Math.min(width, 600));
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
  } catch (e) {}

  const fallback: PlayerImg = {
    source: 'fallback',
    name,
    imageUrl: SILHOUETTE
  };
  setCache(cachePlayerImg, cacheKey, fallback);
  return fallback;
}

export async function clubLogo(clubName: string, width = 400): Promise<PlayerImg> {
  const cacheKey = `clubLogo:${clubName.toLowerCase()}:${width}`;
  const cached = fromCache<any>(cachePlayerImg, cacheKey);
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
  } catch (e) {}

  return {
    source: 'fallback',
    name: clubName,
    imageUrl: '/img/silhouette-club.png'
  };
}

export function figureHtml(img: PlayerImg, opts?: { alt?: string; width?: number; height?: number; className?: string }): string {
  const { alt = img.name ?? '', width = undefined, height = undefined, className = '' } = opts ?? {};
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

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function escapeAttr(s: string) { return escapeHtml(s); }
