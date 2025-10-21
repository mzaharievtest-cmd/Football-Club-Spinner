#!/usr/bin/env node
/**
 * scripts/fetch_players_sportmonks.js (improved fallbacks)
 *
 * - Accepts SPORTMONKS_KEY or SPORTMONKS_TOKEN
 * - Accepts SEASON_ID or SPORTMONKS_SEASON_ID
 * - Tries squads with filters -> squads without filters -> players-by-team -> teams/{id}
 * - Writes debug dumps into tmp/api-dumps for non-200/empty responses
 * - Backups existing data/players.json to data/players.json.bak
 *
 * Usage:
 *   - place .env in repo root with SPORTMONKS_KEY (or SPORTMONKS_TOKEN) and SEASON_ID
 *   - node scripts/fetch_players_sportmonks.js
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SPORTMONKS_KEY = process.env.SPORTMONKS_KEY || process.env.SPORTMONKS_TOKEN;
const SEASON_ID = process.env.SEASON_ID || process.env.SPORTMONKS_SEASON_ID;
const TEAM_IDS = process.env.TEAM_IDS ? process.env.TEAM_IDS.split(',').map(s => s.trim()).filter(Boolean) : null;
const OUT_FILE = process.env.OUT_FILE || './data/players.json';
const RATE_DELAY_MS = parseInt(process.env.RATE_DELAY_MS || '200', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);

if (!SPORTMONKS_KEY) {
  console.error('Missing SPORTMONKS_KEY (or SPORTMONKS_TOKEN) in environment/.env');
  process.exit(1);
}
if (!SEASON_ID && !TEAM_IDS) {
  console.error('Missing SEASON_ID (or SPORTMONKS_SEASON_ID) in environment/.env (or provide TEAM_IDS). Aborting.');
  process.exit(1);
}

let fetchFn = global.fetch;
if (!fetchFn) {
  try {
    fetchFn = require('node-fetch');
  } catch (e) {
    console.error('No global fetch and node-fetch not available. Please run on Node 18+ or install node-fetch.');
    process.exit(1);
  }
}

const BASE = 'https://api.sportmonks.com/v3/football';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ensureDir = d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); };

async function apiRaw(pathname, params = {}) {
  const url = new URL(`${BASE}${pathname}`);
  url.searchParams.set('api_token', SPORTMONKS_KEY);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  const urlStr = url.toString();
  const res = await fetchFn(urlStr, { headers: { Accept: 'application/json' } });
  const text = await res.text().catch(() => '');
  return { status: res.status, text, url: urlStr };
}

async function apiJson(pathname, params = {}) {
  const { status, text, url } = await apiRaw(pathname, params);
  if (status < 200 || status >= 300) {
    const err = new Error(`${status} ${url}\n${text}`);
    err.status = status;
    err.text = text;
    throw err;
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

// Discover teams for the season using /teams/season/{season_id}
async function discoverTeamsBySeason(seasonId) {
  const path = `/teams/season/${encodeURIComponent(seasonId)}`;
  const json = await apiJson(path);
  const teams = [];
  if (json && Array.isArray(json.data) && json.data.length) {
    for (const t of json.data) {
      const id = t.id || (t.team && t.team.data && t.team.data.id);
      const name = t.name || (t.team && t.team.data && t.team.data.name) || (t.attributes && (t.attributes.name || t.attributes.common_name));
      const image = t.logo || t.image_path || (t.team && t.team.data && t.team.data.image_path) || '';
      if (id && name) teams.push({ id: String(id), name: String(name), image_path: image });
    }
  }
  return teams;
}

// Primary attempt: squads endpoint with filters (season); fallback chain implemented below
async function fetchSquadForTeamWithFallbacks(teamId, seasonFilterId) {
  // 1) try squads with filters (as before)
  const include = [
    'team',
    'player.nationality',
    'player.statistics.details.type',
    'player.position'
  ].join(',');
  const filteredParams = { include, filters: seasonFilterId ? `playerstatisticSeasons:${seasonFilterId}` : '' };

  try {
    // try filtered squads
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const json = await apiJson(`/squads/teams/${encodeURIComponent(teamId)}`, filteredParams);
        return { source: 'squads_filtered', json };
      } catch (err) {
        // if 404 specifically, break to try alternate endpoints earlier
        if (err.status === 404) {
          dumpResponse(teamId, `squads-filter-404-attempt-${attempt}`, { status: err.status, text: err.text || '' });
          break;
        }
        dumpResponse(teamId, `squads-filter-error-attempt-${attempt}`, { status: err.status || 'err', text: err.text || err.message });
        if (attempt < MAX_RETRIES) await sleep(250 * attempt);
        else throw err;
      }
    }
  } catch (e) {
    // swallow here and proceed to fallbacks
  }

  // 2) try squads without filters (sometimes the filter causes Not Found)
  try {
    const paramsNoFilter = { include };
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const json = await apiJson(`/squads/teams/${encodeURIComponent(teamId)}`, paramsNoFilter);
        return { source: 'squads_unfiltered', json };
      } catch (err) {
        dumpResponse(teamId, `squads-unfilter-error-attempt-${attempt}`, { status: err.status || 'err', text: err.text || err.message });
        if (err.status === 404) break; // not present at all
        if (attempt < MAX_RETRIES) await sleep(200 * attempt);
        else throw err;
      }
    }
  } catch (e) {
    // continue to next fallback
  }

  // 3) try players-by-team endpoint variants (SportMonks shape varies by plan)
  // Common possibilities:
  //   /players/teams/{teamId}
  //   /players/team/{teamId}  (some APIs)
  // We'll attempt two variants; dump responses for inspection.
  const playerPaths = [
    `/players/teams/${encodeURIComponent(teamId)}`,
    `/players/team/${encodeURIComponent(teamId)}`,
    `/players?team_id=${encodeURIComponent(teamId)}` // as a final general attempt
  ];
  for (const p of playerPaths) {
    try {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const json = await apiJson(p, {}); // no include/filters here
          return { source: p, json };
        } catch (err) {
          dumpResponse(teamId, `players-fallback-${encodeURIComponent(p)}-attempt-${attempt}`, { status: err.status || 'err', text: err.text || err.message });
          if (attempt < MAX_RETRIES) await sleep(200 * attempt);
          else break;
        }
      }
    } catch (e) {
      // try next path
    }
  }

  // 4) Last attempt: fetch team resource to see if it carries squad info
  try {
    const json = await apiJson(`/teams/${encodeURIComponent(teamId)}`);
    // return so calling code can inspect json and extract squad if present
    return { source: 'teams', json };
  } catch (err) {
    dumpResponse(teamId, 'teams-endpoint-error', { status: err.status || 'err', text: err.text || err.message });
  }

  // nothing worked
  return { source: 'none', json: null };
}

function findIncludedPlayer(included, playerId) {
  if (!Array.isArray(included)) return null;
  const pid = String(playerId);
  for (const inc of included) {
    try {
      const idVal = inc.id || (inc.attributes && (inc.attributes.player_id || inc.attributes.id));
      const type = inc.type || '';
      if (String(idVal) === pid && (type === 'player' || type === 'players' || (inc.attributes && (inc.attributes.name || inc.attributes.common_name)))) {
        return inc;
      }
    } catch (e) {}
  }
  return null;
}

function normalizeSquadItem(item, included, teamName) {
  let player = null;
  if (item.player && typeof item.player === 'object') player = item.player;
  else if (item.player && item.player.data) player = item.player.data;
  else if (item.player_id) {
    const inc = findIncludedPlayer(included, item.player_id);
    if (inc) player = inc.attributes || inc;
    else player = { id: item.player_id };
  } else if (item.player && item.player.id) player = item.player;

  if (player && player.attributes) player = Object.assign({}, player.attributes, { id: player.id });

  const name = (player && (player.name || player.common_name || player.display_name || player.fullname)) || '';
  const image = (player && (player.image_path || player.image || player.avatar)) || '';
  const number = (item.jersey_number != null ? String(item.jersey_number)
               : item.jerseyNumber != null ? String(item.jerseyNumber)
               : (player && player.number != null ? String(player.number) : '')) || '';
  const pos = item.position_name || item.position || (player && (player.position && (player.position.name || player.position))) || '';
  const club = (item.team && (item.team.name || item.team.data?.name)) || teamName || '';

  return {
    name: String(name).trim(),
    club: String(club || '').trim(),
    number: String(number || '').trim(),
    pos: String(pos || '').trim(),
    season: String(SEASON_ID),
    image_url: image || ''
  };
}

async function main() {
  console.log('SportMonks squad fetcher (with robust fallbacks)');
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
      const res = await fetchSquadForTeamWithFallbacks(team.id, SEASON_ID);
      if (!res || !res.json) {
        console.log('! no response');
        continue;
      }
      const { source, json } = res;

      // Normalize possible data locations
      let dataArr = [];
      let included = json.included || json.meta?.included || json.data?.included || json.response?.included || [];
      if (Array.isArray(json.data) && json.data.length) dataArr = json.data;
      else if (Array.isArray(json.response) && json.response.length) dataArr = json.response;
      else if (Array.isArray(json)) dataArr = json;
      else if (json.data && Array.isArray(json.data.data)) dataArr = json.data.data; // nested shape

      // Special-case: if we hit /teams/{id} and it includes a squad or players field
      if ((source === 'teams' || source === `/teams/${team.id}`) && (!dataArr || dataArr.length === 0)) {
        const teamResp = json.data || json.response || json;
        const squad = teamResp && (teamResp.players || teamResp.squad || teamResp.team?.squad || teamResp.attributes?.players);
        if (Array.isArray(squad) && squad.length) {
          dataArr = squad;
        }
      }

      // If still empty, dump and continue
      if (!Array.isArray(dataArr) || dataArr.length === 0) {
        console.log('+ 0 players');
        dumpResponse(team.id, `no-data-source-${source}`, json);
        continue;
      }

      let count = 0;
      for (const item of dataArr) {
        try {
          const norm = normalizeSquadItem(item, included, team.name || '');
          if (!norm.name) continue;
          // if blank image, attempt included lookup
          if (!norm.image_url && included && item.player_id) {
            const inc = findIncludedPlayer(included, item.player_id);
            if (inc) {
              const img = (inc.attributes && (inc.attributes.image_path || inc.attributes.image)) || inc.image_path || '';
              if (img) norm.image_url = img;
            }
          }
          if (!norm.club) norm.club = team.name || '';
          out.push(norm);
          count++;
        } catch (e) {
          dumpResponse(team.id, `item-error-${Date.now()}`, { item, err: e.message });
        }
      }

      console.log(`+ ${count} players (source=${source})`);
    } catch (err) {
      console.log(`! error: ${err.message.split('\n')[0]}`);
      dumpResponse(team.id, 'error-final', { error: err.message || err });
    }
    await sleep(RATE_DELAY_MS);
  }

  // Deduplicate
  const seen = new Set();
  const unique = [];
  for (const p of out) {
    const key = `${p.name}::${p.club || ''}::${p.season || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }

  // Backup old file
  try {
    if (fs.existsSync(OUT_FILE)) {
      fs.copyFileSync(OUT_FILE, `${OUT_FILE}.bak`);
      console.log(`Backup written to ${OUT_FILE}.bak`);
    }
  } catch (e) {
    console.warn('Failed to write backup:', e.message);
  }

  // Write JSON
  fs.writeFileSync(OUT_FILE, JSON.stringify(unique, null, 2) + '\n', 'utf8');
  console.log(`Done. Wrote ${unique.length} players to ${OUT_FILE}`);
}

main().catch(err => {
  console.error('Fatal:', err && err.message ? err.message : err);
  process.exit(1);
});
