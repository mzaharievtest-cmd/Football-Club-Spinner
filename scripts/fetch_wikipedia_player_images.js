#!/usr/bin/env node
/**
 * Fetch Premier League player images from Wikipedia/Wikimedia once,
 * save them to public/players/, and write image_url into data/players.json.
 *
 * Usage:
 *   node scripts/fetch_wikipedia_player_images.js
 *   node scripts/fetch_wikipedia_player_images.js --force   # re-download even if image_url exists
 *   node scripts/fetch_wikipedia_player_images.js --limit 50
 *
 * Requires:
 *   - data/players.json  (array of { name, club, ... })
 *   - public/players/    (will be created if missing)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import slugify from 'slugify';
import pLimit from 'p-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const PLAYERS_JSON = path.join(ROOT, 'data', 'players.json');
const OUT_DIR = path.join(ROOT, 'public', 'players');

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const limitArgIndex = process.argv.indexOf('--limit');
const LIMIT = limitArgIndex > -1 ? parseInt(process.argv[limitArgIndex + 1], 10) : null;

// polite concurrency (Wikipedia is generous, but let’s be nice)
const limit = pLimit(4);

// Helpers
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function toSlug(name) {
  // "Bukayo Saka" → "bukayo-saka"
  return slugify(name, { lower: true, strict: true });
}

function chooseFilename(name, ext) {
  return `${toSlug(name)}${ext.toLowerCase()}`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function backupFile(file) {
  if (!fs.existsSync(file)) return;
  const bn = path.basename(file);
  const dir = path.dirname(file);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dir, `${bn}.${stamp}.bak`);
  fs.copyFileSync(file, dest);
  return dest;
}

// -------- Wikipedia/Wikimedia API helpers --------

// 1) Search Wikipedia for the player page
async function findWikipediaPage(title, club) {
  // First try an exact match for typical disambiguations
  const candidates = [
    `${title} (footballer)`,
    `${title} (association football)`,
    `${title} (soccer)`,
    title
  ];

  for (const cand of candidates) {
    const page = await fetchPageSummary(cand);
    if (page?.pageid && isFootballerPage(page)) return page;
    await sleep(150);
  }

  // Fallback: full-text search, bias with club & “footballer”
  const q = `${title} footballer ${club || ''}`.trim();
  const search = await wikiSearch(q);
  for (const s of search) {
    const page = await fetchPageSummary(s.title);
    if (page?.pageid && isFootballerPage(page)) return page;
    await sleep(120);
  }

  return null;
}

function isFootballerPage(summary) {
  const desc = `${summary?.description || ''} ${summary?.extract || ''}`.toLowerCase();
  // loose heuristics
  return /footballer|soccer player|association football/.test(desc);
}

async function wikiSearch(query) {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('list', 'search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('srlimit', '6');
  url.searchParams.set('srsearch', query);

  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const json = await res.json();
  return json?.query?.search || [];
}

// 2) Query the page summary (has a thumbnail sometimes)
async function fetchPageSummary(title) {
  const url = new URL('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title));
  const res = await fetch(url.toString(), { headers: { 'accept': 'application/json' } });
  if (!res.ok) return null;
  const json = await res.json();
  return json; // may have originalimage.source or thumbnail.source
}

// 3) If summary doesn’t give original image, ask for pageimages prop=pageimages
async function fetchPageImageOriginal(title) {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('prop', 'pageimages');
  url.searchParams.set('format', 'json');
  url.searchParams.set('piprop', 'original');
  url.searchParams.set('titles', title);

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const json = await res.json();
  const pages = json?.query?.pages || {};
  const page = Object.values(pages)[0];
  return page?.original?.source || null;
}

function inferExtFromUrl(url) {
  const u = new URL(url);
  const p = u.pathname.toLowerCase();
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return '.jpg';
  if (p.endsWith('.png')) return '.png';
  if (p.endsWith('.webp')) return '.webp';
  if (p.endsWith('.svg')) return '.svg';
  // default
  return '.jpg';
}

// Download binary
async function downloadToFile(url, destFile) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destFile, buf);
}

// Main per-player pipeline
async function processPlayer(p, idx, total) {
  const name = (p.name || p.player_name || '').trim();
  if (!name) return { ok: false, reason: 'missing name' };

  if (!FORCE && p.image_url && typeof p.image_url === 'string' && p.image_url.trim()) {
    return { ok: true, skipped: true, reason: 'already has image_url' };
  }

  // find wiki page
  const page = await findWikipediaPage(name, p.club);
  if (!page) return { ok: false, reason: 'no wikipedia page' };

  // get image
  let imageUrl = page?.originalimage?.source || page?.thumbnail?.source || null;
  if (!imageUrl) {
    imageUrl = await fetchPageImageOriginal(page.title);
  }
  if (!imageUrl) return { ok: false, reason: 'no image on page' };

  // fetch image and save
  const ext = inferExtFromUrl(imageUrl);
  const filename = chooseFilename(name, ext);
  const outPath = path.join(OUT_DIR, filename);
  try {
    await downloadToFile(imageUrl, outPath);
  } catch (e) {
    return { ok: false, reason: 'download failed', error: e.message };
  }

  // write back image_url into the record
  p.image_url = `/players/${filename}`;
  return { ok: true, file: filename };
}

// Orchestrator
async function main() {
  if (!fs.existsSync(PLAYERS_JSON)) {
    console.error(`✖ ${PLAYERS_JSON} not found`);
    process.exit(1);
  }
  ensureDir(OUT_DIR);

  const raw = fs.readFileSync(PLAYERS_JSON, 'utf8');
  let players = [];
  try {
    players = JSON.parse(raw);
    if (!Array.isArray(players)) throw new Error('players.json must be an array');
  } catch (e) {
    console.error('✖ Failed to parse players.json:', e.message);
    process.exit(1);
  }

  const total = LIMIT ? Math.min(players.length, LIMIT) : players.length;
  console.log(`Players total: ${players.length}`);
  console.log(`Processing   : ${total}${LIMIT ? ` (limited via --limit ${LIMIT})` : ''}`);
  console.log(`Output dir   : ${OUT_DIR}`);
  console.log(`Force mode   : ${FORCE ? 'ON (re-download images)' : 'OFF (skip existing image_url)'}`);
  console.log('———————');

  let processed = 0, okCount = 0, skipCount = 0, failCount = 0;

  // process sequentially with small concurrency
  const jobs = players.slice(0, total).map((p, i) =>
    limit(async () => {
      const res = await processPlayer(p, i+1, total);
      processed++;
      if (res.ok && res.skipped) {
        skipCount++;
        console.log(`[${processed}/${total}] ↷ ${p.name} — skipped (already has image)`);
      } else if (res.ok) {
        okCount++;
        console.log(`[${processed}/${total}] ✓ ${p.name} → ${res.file}`);
      } else {
        failCount++;
        console.log(`[${processed}/${total}] ✖ ${p.name} — ${res.reason}${res.error ? ` (${res.error})` : ''}`);
      }
      // small delay to be nice to Wikipedia
      await sleep(120);
    })
  );

  await Promise.all(jobs);

  const backup = backupFile(PLAYERS_JSON);
  fs.writeFileSync(PLAYERS_JSON, JSON.stringify(players, null, 2));
  console.log('———————');
  if (backup) console.log(`Backup written to ${backup}`);
  console.log(`Done. ok=${okCount}, skipped=${skipCount}, failed=${failCount}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
