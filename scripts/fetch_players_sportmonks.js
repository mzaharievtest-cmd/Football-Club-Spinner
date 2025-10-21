#!/usr/bin/env node
/**
 * scripts/fetch_players_sportmonks.js
 *
 * Fetch squads from SportMonks and write data/players.json
 *
 * Required env:
 *  - SPORTMONKS_KEY           (your SportMonks API token)
 *  - SPORTMONKS_SEASON_ID     (SportMonks numeric season id, e.g. 25583)
 *
 * Optional env:
 *  - TEAM_IDS                 comma-separated list of team ids to fetch (overrides auto-discovery)
 *  - OUT_FILE                 path to output JSON (default ./data/players.json)
 *  - RATE_DELAY_MS            per-request delay (default 200)
 *  - MAX_RETRIES              retries on transient failures (default 3)
 *
 * Notes:
 * - The SportMonks API shapes vary by plan/version. This script attempts to handle common shapes:
 *   - squads endpoint items containing "player" object
 *   - items with player_id and an "included" block containing player records
 * - When a player's image_path exists it's used as image_url (full CDN path). Otherwise image_url is "".
 * - The script writes a backup ./data/players.json.bak before overwriting.
 * - Debug dumps written under tmp/api-dumps on problematic responses.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const SPORTMONKS_KEY = process.env.SPORTMONKS_KEY;
const SEASON_ID = process.env.SPORTMONKS_SEASON_ID; // numeric id in SportMonks (not year)
const TEAM_IDS = process.env.TEAM_IDS ? process.env.TEAM_IDS.split(',').map(s => s.trim()).filter(Boolean) : null;
const OUT_FILE = process.env.OUT_FILE || './data/players.json';
const RATE_DELAY_MS = parseInt(process.env.RATE_DELAY_MS || '200', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);

const BASE = 'https://api.sportmonks.com/v3/football';
if (!SPORTMONKS_KEY) {
  console.error('Missing SPORTMONKS_KEY in .env');
  process.exit(1);
}
if (!SEASON_ID && !TEAM_IDS) {
  console.error('Missing SPORTMONKS_SEASON_ID in .env (or provide TEAM_IDS). Aborting.');
  process.exit(1);
}

const Q = s => encodeURIComponent(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ensureDir = d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); };

async function apiRaw(pathname, params = {}) {
  const url = new URL(`${BASE}${pathname}`);
  // default token param
  url.searchParams.set('api_token', SPORTMONKS_KEY);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  const txt = await res.text().catch(() => '');
  return { status: res.status, text: txt, url: url.toString() };
}

async function apiJson(pathname, params = {}) {
  const { status, text, url } = await apiRaw(pathname, params);
  if (status < 200 || status >= 300) {
    throw new Error(`${status} ${url}\n${text}`);
  }
  try {
    return JSON.parse(text || '{}');
  } catch (e) {
    throw new Error(`Invalid JSON ${url}: ${e.message}\n${(text||'').slice(0,1000)}`);
  }
}

function dumpResponse(teamId, suffix, content) {
  try {
    const dir = path.join('tmp', 'api-dumps');
    ensureDir(dir);
    const file = path.join(dir, `team-${teamId}-${suffix}.json`);
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
    console.log(`  (dumped API response to ${file})`);
  } catch (e) {
    console.warn('  Failed to write dump:', e.message);
  }
}

// Discover teams for the season using SportMonks teams-by-season endpoint.
// Note: endpoint may vary by plan; if this fails you can set TEAM_IDS env to override.
async function discoverTeamsBySeason(seasonId) {
  // sportmonks: /teams/season/{season_id}
  const path = `/teams/season/${Q(seasonId)}`;
  const json = await apiJson(path, { include: 'team' });
  // json.data likely array of team objects or a wrapper — attempt to parse common shapes
  const teams = [];
  if (Array.isArray(json.data) && json.data.length) {
    for (const t of json.data) {
      // t.id and t.name commonly present as t.id and t.name or t.team.data.name
      if (t.id && (t.name || (t.team && t.team.data && t.team.data.name))) {
        teams.push({
          id: t.id,
          name: t.name || (t.team && t.team.data && t.team.data.name),
          image_path: t.logo || t.image_path || (t.team && t.team.data && t.team.data.image_path) || ''
        });
      }
    }
  } else if (Array.isArray(json) && json.length) {
    // fallback: unlikely
    json.forEach(t => { if (t.id && t.name) teams.push({ id: t.id, name: t.name }); });
  }
  return teams;
}

// Fetch squad for a team using squads endpoint with included player info and filters by season statistics
async function fetchSquadForTeam(teamId, seasonFilterId) {
  // build includes & filters similar to the example you gave
  const include = [
    'team',
    'player.nationality',
    'player.statistics.details.type',
    'player.position'
  ].join(',');
  // filter example: playerstatisticSeasons:25583
  const filters = seasonFilterId ? `playerstatisticSeasons:${seasonFilterId}` : '';

  const path = `/squads/teams/${Q(teamId)}`;
  const params = { include };
  if (filters) params.filters = filters;

  // retry wrapper for transient errors
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const json = await apiJson(path, params);
      return json; // upstream parsing handles shapes
    } catch (err) {
      console.warn(`  fetch squad team=${teamId} attempt=${attempt} failed: ${err.message.split('\\n')[0]}`);
      if (attempt === MAX_RETRIES) throw err;
      await sleep(300 * attempt);
    }
  }
  return null;
}

// Helper to find included player by id if the API uses included blocks
function findIncludedPlayer(included, playerId) {
  if (!Array.isArray(included)) return null;
  const pid = String(playerId);
  for (const inc of included) {
    // sportmonks included records often have 'type' and 'id' and attributes: inc.id / inc.type / inc.attributes
    try {
      const idVal = inc.id || (inc.attributes && inc.attributes.player_id) || inc.attributes?.id;
      const type = inc.type || '';
      if (String(idVal) === pid && (type === 'player' || type === 'players' || (inc.attributes && (inc.attributes.name || inc.attributes.common_name)))) {
        return inc;
      }
    } catch (e) {}
  }
  return null;
}

// Normalize a single squad item (various possible shapes)
function normalizeSquadItem(item, included) {
  // shapes seen:
  // - item.player (object)
  // - item.player_id (with included player record)
  // - item.player.data (SportMonks nested)
  let player = null;

  if (item.player && typeof item.player === 'object') {
    player = item.player;
  } else if (item.player && item.player.data) {
    player = item.player.data;
  } else if (item.player_id) {
    // try to find included player
    const inc = findIncludedPlayer(included, item.player_id);
    if (inc) {
      // attributes are usually in inc.attributes
      player = inc.attributes || inc;
    } else {
      // fallback to shallow fields on item
      player = { id: item.player_id };
    }
  } else if (item.player && item.player.id) {
    player = item.player;
  }

  // SportMonks sometimes nests player attributes under 'attributes'
  if (player && player.attributes) player = Object.assign({}, player.attributes, { id: player.id });

  // Build output fields
  const name = player?.name || player?.common_name || player?.display_name || '';
  const image = player?.image_path || player?.image || player?.avatar || '';
  // jersey number might be on the squad item as jersey_number or jersey_number or jerseyNumber
  const number = (item.jersey_number != null ? String(item.jersey_number)
               : item.jerseyNumber != null ? String(item.jerseyNumber)
               : player?.number != null ? String(player.number)
               : '');
  // position might be on item.position or player.position or item.position_id -> included position may exist
  const pos = (item.position_name || item.position || (player && player.position && (player.position.name || player.position)) || '');
  // team name if present on item.team or item.team.name or included team
  const club = (item.team && (item.team.name || item.team.data?.name)) || '';
  return {
    name: String(name || '').trim(),
    club: club || '',
    number: number || '',
    pos: pos || '',
    season: String(SEASON_ID),
    image_url: image || ''
  };
}

async function main() {
  console.log('SportMonks squad fetcher');
  console.log(`Season id: ${SEASON_ID}`);
  console.log(`Team override (TEAM_IDS): ${TEAM_IDS ? TEAM_IDS.join(',') : '(none)'}`);
  ensureDir(path.dirname(OUT_FILE));
  ensureDir(path.join('tmp','api-dumps'));

  let teams = [];
  if (TEAM_IDS && TEAM_IDS.length) {
    teams = TEAM_IDS.map(id => ({ id: String(id), name: '' }));
  } else {
    try {
      console.log('Discovering teams for season via /teams/season/{season_id} ...');
      const discovered = await discoverTeamsBySeason(SEASON_ID);
      if (!discovered || discovered.length === 0) {
        console.warn('No teams discovered for season. Consider setting TEAM_IDS env.');
      } else {
        teams = discovered;
      }
    } catch (err) {
      console.warn('Failed to discover teams:', err.message);
      console.warn('Set TEAM_IDS env to a comma-separated list of team ids to proceed.');
      process.exitCode = 1;
      return;
    }
  }

  console.log(`Teams to fetch: ${teams.length}`);
  const out = [];
  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    process.stdout.write(`[${i+1}/${teams.length}] team=${team.name || team.id} id=${team.id} ... `);
    try {
      const json = await fetchSquadForTeam(team.id, SEASON_ID);
      if (!json) {
        console.log('! no json');
        continue;
      }
      // The squads response may store records under data (array), or response.data
      const dataArr = json.data || json.response || json || [];
      const included = json.included || json.meta?.included || json.data?.included || [];

      // If zero items, dump and continue
      if (!Array.isArray(dataArr) || dataArr.length === 0) {
        console.log('+ 0 players');
        dumpResponse(team.id, 'empty', json);
        continue;
      }

      let count = 0;
      for (const item of dataArr) {
        try {
          const normalized = normalizeSquadItem(item, included);
          // normalize club: if missing use team.name (if available)
          if (!normalized.club) normalized.club = team.name || normalized.club || '';
          // skip empty names
          if (!normalized.name) continue;
          out.push(normalized);
          count++;
        } catch (e) {
          // continue on bad item but dump for debugging
          dumpResponse(team.id, `item-error-${Date.now()}`, { item, err: e.message });
        }
      }

      console.log(`+ ${count} players`);
    } catch (err) {
      console.log(`! error: ${err.message.split('\\n')[0]}`);
      try { dumpResponse(team.id, 'error', { error: err.message }); } catch(e) {}
    }
    await sleep(RATE_DELAY_MS);
  }

  // De-duplicate by name+club+season
  const seen = new Set();
  const unique = [];
  for (const p of out) {
    const key = `${p.name}::${p.club || ''}::${p.season || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }

  // Backup existing file
  try {
    if (fs.existsSync(OUT_FILE)) {
      fs.copyFileSync(OUT_FILE, `${OUT_FILE}.bak`);
      console.log(`Backup written to ${OUT_FILE}.bak`);
    }
  } catch (e) {
    console.warn('Failed to write backup:', e.message);
  }

  // Write output
  fs.writeFileSync(OUT_FILE, JSON.stringify(unique, null, 2) + '\n', 'utf8');
  console.log(`Done. Wrote ${unique.length} players to ${OUT_FILE}`);
}

main().catch(err => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});
