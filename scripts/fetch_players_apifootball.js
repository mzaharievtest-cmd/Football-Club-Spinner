// improved fetch_players_apifootball.js (with page retry + API dump on empty responses)
// - includes league param for /players calls (fixes many 0-results cases)
// - retries pages that unexpectedly return zero items (configurable)
// - writes raw JSON dumps for empty-page responses under tmp/api-dumps/
// - detailed per-team paging logs for diagnostics
// - fallbacks: /players (season) -> /players (no season) -> /players/squads or /teams squad
// - preserves image_url from API (p.photo) when present
//
// Usage:
//   - ensure APIFOOTBALL_KEY, SEASON, LEAGUE_ID set in .env
//   - node --experimental-fetch scripts/fetch_players_apifootball.js
//
// Tunables via env:
//   PAGE_DELAY_MS, TEAM_DELAY_MS, MIN_PLAYERS_PER_TEAM, MAX_PAGE_RETRIES, RETRY_BACKOFF_MS

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const API_KEY   = process.env.APIFOOTBALL_KEY;
const SEASON    = process.env.SEASON || '2024';
const LEAGUE_ID = process.env.LEAGUE_ID || '39';
const OUT_FILE  = process.env.OUT_FILE || './data/players.json';

const MIN_EXPECTED_PLAYERS_PER_TEAM = parseInt(process.env.MIN_PLAYERS_PER_TEAM || '18', 10);
const PAGE_DELAY_MS = parseInt(process.env.PAGE_DELAY_MS || '150', 10);
const TEAM_DELAY_MS = parseInt(process.env.TEAM_DELAY_MS || '200', 10);
const MAX_PAGE_RETRIES = parseInt(process.env.MAX_PAGE_RETRIES || '3', 10);
const RETRY_BACKOFF_MS = parseInt(process.env.RETRY_BACKOFF_MS || '400', 10);

const BASE = 'https://v3.football.api-sports.io';
const H    = { 'x-apisports-key': API_KEY };

if (!API_KEY) {
  console.error('Missing APIFOOTBALL_KEY in .env');
  process.exit(1);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function apiRaw(pathname, params = {}) {
  const url = new URL(BASE + pathname);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url, { headers: H });
  const text = await res.text().catch(() => '');
  return { status: res.status, text, url: url.toString() };
}

async function api(pathname, params = {}) {
  const { status, text, url } = await apiRaw(pathname, params);
  if (status < 200 || status >= 300) {
    throw new Error(`${status} for ${url}\n${text}`);
  }
  try {
    return JSON.parse(text || '{}');
  } catch (e) {
    throw new Error(`Invalid JSON from ${url}: ${e.message}\n${text.slice(0,1000)}`);
  }
}

async function getTeams({ leagueId, season }) {
  const json = await api('/teams', { league: String(leagueId), season: String(season) });
  const teams = (json.response || []).map(r => ({
    id: r.team?.id,
    name: r.team?.name,
    logo: r.team?.logo
  })).filter(t => t.id && t.name);
  return teams;
}

function dumpApiResponse(teamId, page, raw) {
  try {
    const dumpDir = path.join('tmp', 'api-dumps');
    ensureDir(dumpDir);
    const fname = path.join(dumpDir, `team-${teamId}-page-${page}.json`);
    fs.writeFileSync(fname, raw, 'utf8');
    console.log(`      Wrote dump: ${fname}`);
  } catch (e) {
    console.warn('      Failed to write dump:', e.message);
  }
}

async function fetchPlayersPageWithRetries(teamId, params, page, maxRetries = MAX_PAGE_RETRIES) {
  let attempt = 0;
  let backoff = RETRY_BACKOFF_MS;
  while (attempt <= maxRetries) {
    attempt++;
    try {
      const rp = Object.assign({}, params, { page: String(page) });
      const { status, text, url } = await apiRaw('/players', rp);
      let json = {};
      try {
        json = JSON.parse(text || '{}');
      } catch (e) {
        // invalid JSON — dump and raise
        dumpApiResponse(teamId, page, text || '');
        throw new Error(`Invalid JSON on ${url}: ${e.message}`);
      }
      const items = json.response || [];
      // If empty on first try and paging.total indicates multiple pages, that's suspicious -> retry
      const cur = json.paging?.current || page;
      const total = json.paging?.total || cur;
      if (items.length === 0 && attempt <= maxRetries) {
        console.log(`      [retry] page=${page} attempt=${attempt}/${maxRetries} items=0 cur=${cur} total=${total} -> backing off ${backoff}ms`);
        dumpApiResponse(teamId, page, text || '');
        await new Promise(r => setTimeout(r, backoff));
        backoff *= 2;
        continue;
      }
      return json;
    } catch (err) {
      if (attempt <= maxRetries) {
        console.log(`      [retry error] page=${page} attempt=${attempt}/${maxRetries} err=${err.message} -> retrying in ${backoff}ms`);
        await new Promise(r => setTimeout(r, backoff));
        backoff *= 2;
        continue;
      }
      throw err;
    }
  }
  // if we exit loop unexpectedly
  throw new Error('Exceeded retries fetching page');
}

async function getPlayersFromPlayersEndpoint(teamId, season, withSeason = true) {
  const all = [];
  let page = 1;
  // base params include league (this fixed many 0-output issues)
  const baseParams = { team: String(teamId), league: String(LEAGUE_ID) };
  if (withSeason) baseParams.season = String(season);

  // initial fetch to know paging total
  try {
    const firstJson = await fetchPlayersPageWithRetries(teamId, baseParams, 1);
    const firstItems = firstJson.response || [];
    const cur = firstJson.paging?.current || 1;
    const total = firstJson.paging?.total || cur;
    console.log(`    /players ${withSeason ? `season=${season} ` : ''}league=${LEAGUE_ID} team=${teamId} page=${cur}/${total} items=${firstItems.length}`);

    firstItems.forEach(r => {
      const p = r.player || {};
      const s = (r.statistics && r.statistics[0]) || {};
      const club = s.team?.name || '';
      const number = (s.games && s.games.number != null) ? String(s.games.number) : (p.number != null ? String(p.number) : '');
      const pos = s.games?.position || p.position || '';
      all.push({
        name: p.name || p.common_name || '',
        club,
        number,
        pos,
        season: String(season),
        image_url: p.photo || ''
      });
    });

    // fetch remaining pages if any
    for (page = 2; page <= total; page++) {
      await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
      const pageJson = await fetchPlayersPageWithRetries(teamId, baseParams, page);
      const items = pageJson.response || [];
      const curp = pageJson.paging?.current || page;
      const tp = pageJson.paging?.total || curp;
      console.log(`    /players ${withSeason ? `season=${season} ` : ''}league=${LEAGUE_ID} team=${teamId} page=${curp}/${tp} items=${items.length}`);
      if (items.length === 0) {
        // dump and continue — fetcher will consider fallback later
        dumpApiResponse(teamId, page, JSON.stringify(pageJson || {}, null, 2));
      }
      items.forEach(r => {
        const p = r.player || {};
        const s = (r.statistics && r.statistics[0]) || {};
        const club = s.team?.name || '';
        const number = (s.games && s.games.number != null) ? String(s.games.number) : (p.number != null ? String(p.number) : '');
        const pos = s.games?.position || p.position || '';
        all.push({
          name: p.name || p.common_name || '',
          club,
          number,
          pos,
          season: String(season),
          image_url: p.photo || ''
        });
      });
    }
  } catch (err) {
    console.warn(`    getPlayersFromPlayersEndpoint error team=${teamId}: ${err.message}`);
  }

  return all;
}

async function getPlayersFromSquadsFallback(teamId) {
  try {
    const json = await api('/players/squads', { team: String(teamId) });
    const resp = json.response || [];
    if (Array.isArray(resp) && resp.length) {
      const maybePlayers = resp[0].players || resp[0];
      if (Array.isArray(maybePlayers) && maybePlayers.length) {
        console.log(`    /players/squads team=${teamId} players=${maybePlayers.length}`);
        return maybePlayers.map(p => ({
          name: p.name || p.player || p.common_name || '',
          club: '',
          number: p.number != null ? String(p.number) : '',
          pos: p.position || '',
          season: String(SEASON),
          image_url: p.photo || ''
        }));
      }
    }
  } catch (err) {
    console.warn(`    squads endpoint failed for team ${teamId}: ${err.message}`);
  }

  // teams fallback
  try {
    const json = await api('/teams', { id: String(teamId) });
    const resp = json.response && json.response[0];
    const squad = resp?.players || resp?.squad || resp?.team?.squad;
    if (Array.isArray(squad) && squad.length) {
      console.log(`    /teams (squad) team=${teamId} players=${squad.length}`);
      return squad.map(p => ({
        name: p.name || p.player || p.common_name || '',
        club: '',
        number: p.number != null ? String(p.number) : '',
        pos: p.position || '',
        season: String(SEASON),
        image_url: p.photo || ''
      }));
    }
  } catch (err) {
    console.warn(`    teams (squad) fallback failed for team ${teamId}: ${err.message}`);
  }

  return [];
}

async function getPlayersForTeam(teamId, season) {
  try {
    const list = await getPlayersFromPlayersEndpoint(teamId, season, true);
    if (list.length >= MIN_EXPECTED_PLAYERS_PER_TEAM) return list;

    if (list.length > 0 && list.length < MIN_EXPECTED_PLAYERS_PER_TEAM) {
      console.log(`    small player list (${list.length}) for team=${teamId} with season -> trying /players without season`);
    }
    const listNoSeason = await getPlayersFromPlayersEndpoint(teamId, season, false);
    if (listNoSeason.length >= MIN_EXPECTED_PLAYERS_PER_TEAM) return listNoSeason;

    console.log(`    /players returned ${list.length} and ${listNoSeason.length}; trying squads fallback`);
    const squads = await getPlayersFromSquadsFallback(teamId);
    if (squads.length) return squads;

    // best effort
    return listNoSeason.length ? listNoSeason : list;
  } catch (err) {
    console.warn(`    getPlayersForTeam: primary players endpoint failed for team ${teamId}: ${err.message}`);
    const squads = await getPlayersFromSquadsFallback(teamId);
    return squads;
  }
}

async function main() {
  console.log(`Season: ${SEASON} | League: ${LEAGUE_ID}`);
  const teams = await getTeams({ leagueId: LEAGUE_ID, season: SEASON });
  console.log(`Teams discovered: ${teams.length}`);
  teams.forEach((t, idx) => console.log(`  [${idx+1}] ${t.name} (id=${t.id})`));

  ensureDir(path.dirname(OUT_FILE));
  ensureDir(path.join('tmp', 'api-dumps'));

  const allPlayers = [];
  for (const [i, team] of teams.entries()) {
    console.log(`[${i+1}/${teams.length}] ${team.name} (id=${team.id})`);
    try {
      const players = await getPlayersForTeam(team.id, SEASON);
      console.log(`  + Collected ${players.length} players for ${team.name}`);
      allPlayers.push(...players);
    } catch (err) {
      console.warn(`  ! Failed for team ${team.id} ${team.name}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, TEAM_DELAY_MS));
  }

  // de-duplicate
  const seen = new Set();
  const unique = allPlayers.filter(p => {
    const key = `${p.name}::${p.club || ''}::${p.season || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`Total collected before dedupe: ${allPlayers.length}`);
  console.log(`Total unique after dedupe: ${unique.length}`);
  console.log(`Writing ${OUT_FILE}`);
  fs.writeFileSync(OUT_FILE, JSON.stringify(unique, null, 2) + '\n', 'utf8');
  console.log(`Done. Wrote ${unique.length} players to ${OUT_FILE}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
