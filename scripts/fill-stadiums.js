#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TEAMS_PATH = path.resolve(ROOT, 'teams.json');
const LEAGUE_MAP_PATH = path.resolve(ROOT, 'data', 'league-map.json');
const OUT_PATH = path.resolve(ROOT, 'data', 'stadiums.generated.json');

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function exists(p) { try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; } }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
function key(leagueCode, teamName) {
  return `${String(leagueCode || '').toUpperCase()}:${norm(teamName)}`;
}

async function wikidataSearch(query) {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.searchParams.set('action', 'wbsearchentities');
  url.searchParams.set('search', query);
  url.searchParams.set('language', 'en');
  url.searchParams.set('type', 'item');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '5');
  const res = await fetch(url, { headers: { 'User-Agent': 'football-spinner-stadium-fetch/1.0' } });
  if (!res.ok) throw new Error(`Wikidata search failed ${res.status}`);
  return res.json();
}

async function wikidataEntity(qid) {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  const res = await fetch(url, { headers: { 'User-Agent': 'football-spinner-stadium-fetch/1.0' } });
  if (!res.ok) throw new Error(`Wikidata entity fetch failed ${res.status}`);
  return res.json();
}

function extractEnglishLabel(entity) {
  return entity?.labels?.en?.value
    || Object.values(entity?.labels || {})[0]?.value
    || '';
}

async function resolveStadiumNameFromClubQID(qid) {
  const data = await wikidataEntity(qid);
  const entity = data?.entities?.[qid];
  if (!entity) return '';

  const claims = entity.claims || {};
  const p115 = claims.P115 || []; // home venue
  // Prefer truthy statements; take the first value
  const stadiumQid = p115.find(c => c?.mainsnak?.datavalue?.value?.id)?.mainsnak?.datavalue?.value?.id;
  if (!stadiumQid) return '';

  const stadiumData = await wikidataEntity(stadiumQid);
  const stadiumEntity = stadiumData?.entities?.[stadiumQid];
  return extractEnglishLabel(stadiumEntity);
}

async function findStadiumByName(teamName, countryHint = '') {
  const queries = [
    `${teamName} football`,
    `${teamName} ${countryHint} football`,
    `${teamName} FC ${countryHint}`,
    `${teamName}`
  ];

  for (const q of queries) {
    try {
      const results = await wikidataSearch(q);
      const items = results?.search || [];
      for (const item of items) {
        // Fetch entity and check if it has a home venue (P115)
        const qid = item.id;
        const data = await wikidataEntity(qid);
        const entity = data?.entities?.[qid];
        const hasHomeVenue = !!(entity?.claims?.P115 && entity.claims.P115.length > 0);

        // Guard against non-football orgs by preferring "association football club" (Q476028) in P31
        const p31 = (entity?.claims?.P31 || []).map(c => c?.mainsnak?.datavalue?.value?.id);
        const isFootballClub = p31.includes('Q476028') || p31.includes('Q170980'); // association football club / football club (legacy)

        if (hasHomeVenue && isFootballClub) {
          return await resolveStadiumNameFromClubQID(qid);
        }
      }
    } catch (e) {
      // continue with next query
    }
    // throttle to be kind to the API
    await sleep(150);
  }
  return '';
}

async function main() {
  if (!exists(TEAMS_PATH)) {
    console.error('teams.json not found at repo root.');
    process.exit(2);
  }
  const teams = readJSON(TEAMS_PATH);
  const leagueMap = exists(LEAGUE_MAP_PATH) ? readJSON(LEAGUE_MAP_PATH) : {};

  const out = {};
  let resolved = 0, skipped = 0, missing = 0;

  // Process sequentially with light throttling to avoid rate limits
  for (const t of teams) {
    const k = key(t.league_code, t.team_name);
    if (t.stadium && String(t.stadium).trim() !== '') {
      skipped++;
      continue; // already present
    }

    const countryHint =
      leagueMap?.[t.league_code]?.country ||
      leagueMap?.[t.league_code]?.Country ||
      '';

    const stadium = await findStadiumByName(t.team_name, countryHint);
    if (stadium) {
      out[k] = stadium;
      resolved++;
    } else {
      missing++;
    }
    // gentle throttle
    await sleep(120);
  }

  // Write mapping
  const dir = path.dirname(OUT_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');

  console.log('Fetch stadiums summary:');
  console.log(`- Resolved via Wikidata: ${resolved}`);
  console.log(`- Already present in teams.json: ${skipped}`);
  console.log(`- Still missing after fetch: ${missing}`);
  console.log(`- Mapping written to: ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
