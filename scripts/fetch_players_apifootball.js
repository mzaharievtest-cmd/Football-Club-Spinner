// improved fetch_players_apifootball.js
// - includes league param for /players calls (fixes many 0-results cases)
// - detailed per-team paging logs for diagnostics
// - fallbacks: /players (season) -> /players (no season) -> /players/squads or /teams squad
// - preserves image_url from API (p.photo) when present
// - writes pretty JSON and prints diagnostics (before/after dedupe counts)
//
// Usage:
//   - Set APIFOOTBALL_KEY, SEASON, LEAGUE_ID in .env or environment
//   - node --experimental-fetch scripts/fetch_players_apifootball.js
//
// Notes:
//   - Some API-Football plans expose /players/squads, others don't; this script tries both.
//   - Tune MIN_PLAYERS_PER_TEAM, PAGE_DELAY_MS, TEAM_DELAY_MS via env if needed.

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const API_KEY   = process.env.APIFOOTBALL_KEY;
const SEASON    = process.env.SEASON || '2025';
const LEAGUE_ID = process.env.LEAGUE_ID || '39'; // Premier League default
const OUT_FILE  = process.env.OUT_FILE || './data/players.json';

// Tunables (via env)
const MIN_EXPECTED_PLAYERS_PER_TEAM = parseInt(process.env.MIN_PLAYERS_PER_TEAM || '18', 10);
const PAGE_DELAY_MS = parseInt(process.env.PAGE_DELAY_MS || '150', 10);
const TEAM_DELAY_MS = parseInt(process.env.TEAM_DELAY_MS || '200', 10);

const BASE = 'https://v3.football.api-sports.io';
const H    = { 'x-apisports-key': API_KEY };

if (!API_KEY) {
  console.error('Missing APIFOOTBALL_KEY in .env');
  process.exit(1);
}

async function api(pathname, params = {}) {
  const url = new URL(BASE + pathname);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url, { headers: H });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${url}\n${text}`);
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

async function getPlayersFromPlayersEndpoint(teamId, season, withSeason = true) {
  let page = 1;
  const all = [];
  while (true) {
    // include league param — this helps return season/league-scoped players
    const params = { team: String(teamId), page: String(page), league: String(LEAGUE_ID) };
    if (withSeason) params.season = String(season);

    const json = await api('/players', params);
    const cur = json.paging?.current || page;
    const total = json.paging?.total || cur;
    const items = json.response || [];
    console.log(`    /players ${withSeason ? `season=${season} ` : ''}league=${LEAGUE_ID} team=${teamId} page=${cur}/${total} items=${items.length}`);
    // Debugging: uncomment to inspect the full response for teams that return 0
    // if (items.length === 0) console.log('      response snippet:', JSON.stringify(json, null, 2).slice(0,2000));

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
        image_url: p.photo || '' // from API-Football CDN when present
      });
    });

    if (cur >= total) break;
    page++;
    await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
  }
  return all;
}

async function getPlayersFromSquadsFallback(teamId) {
  // Try endpoint '/players/squads' (some API plans expose this), then fallback to /teams with squad
  try {
    const json = await api('/players/squads', { team: String(teamId) });
    const resp = json.response || [];
    if (Array.isArray(resp) && resp.length) {
      const maybePlayers = resp[0].players || resp[0];
      if (Array.isArray(maybePlayers) && maybePlayers.length) {
        console.log(`    /players/squads team=${teamId} players=${maybePlayers.length}`);
        return maybePlayers.map(p => ({
          name: p.name || p.player || p.common_name || '',
          club: '', // squad endpoint may not include club name here
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

  // Fallback: try /teams endpoint for squad info (some API responses include squad array)
  try {
    const json = await api('/teams', { id: String(teamId) });
    const resp = json.response && json.response[0];
    const squad = resp?.players || resp?.squad || resp?.team?.squad;
    if (Array.isArray(squad) && squad.length) {
      console.log(`    /teams (squad) team=${teamId} players=${squad.length}`);
      return squad.map(p => ({
        name: p.name || p.player || p.common_name || '',
        club: '', number: p.number != null ? String(p.number) : '',
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
  // 1) try /players with season (this is the primary call)
  try {
    const list = await getPlayersFromPlayersEndpoint(teamId, season, true);
    if (list.length >= MIN_EXPECTED_PLAYERS_PER_TEAM) return list;

    // If result is small, try again without the season filter
    if (list.length > 0 && list.length < MIN_EXPECTED_PLAYERS_PER_TEAM) {
      console.log(`    small player list (${list.length}) for team=${teamId} with season -> trying /players without season`);
    }
    const listNoSeason = await getPlayersFromPlayersEndpoint(teamId, season, false);
    if (listNoSeason.length >= MIN_EXPECTED_PLAYERS_PER_TEAM) return listNoSeason;

    // still small: try squads fallback
    console.log(`    /players returned ${list.length} and ${listNoSeason.length}; trying squads fallback`);
    const squads = await getPlayersFromSquadsFallback(teamId);
    if (squads.length) return squads;

    // return the best we have (prefer listNoSeason if larger)
    return listNoSeason.length ? listNoSeason : list;
  } catch (err) {
    console.warn(`    getPlayersForTeam: primary players endpoint failed for team ${teamId}: ${err.message}`);
    // try fallbacks
    try {
      const listNoSeason = await getPlayersFromPlayersEndpoint(teamId, season, false);
      if (listNoSeason.length) return listNoSeason;
    } catch (e) {
      console.warn(`    getPlayersForTeam: /players no-season failed for team ${teamId}: ${e.message}`);
    }
    const squads = await getPlayersFromSquadsFallback(teamId);
    return squads;
  }
}

async function main() {
  console.log(`Season: ${SEASON} | League: ${LEAGUE_ID}`);
  const teams = await getTeams({ leagueId: LEAGUE_ID, season: SEASON });
  console.log(`Teams discovered: ${teams.length}`);
  teams.forEach((t, idx) => console.log(`  [${idx+1}] ${t.name} (id=${t.id})`));

  const outDir = path.dirname(OUT_FILE);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

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

  // de-duplicate by name+club+season (safeguard)
  const seen = new Set();
  const unique = allPlayers.filter(p => {
    const key = `${p.name}::${p.club || ''}::${p.season || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // diagnostics
  console.log(`Total collected before dedupe: ${allPlayers.length}`);
  console.log(`Total unique after dedupe: ${unique.length}`);
  console.log(`Writing ${OUT_FILE}`);

  // Write pretty JSON (ensure directory exists)
  fs.writeFileSync(OUT_FILE, JSON.stringify(unique, null, 2) + '\n', 'utf8');
  console.log(`Done. Wrote ${unique.length} players to ${OUT_FILE}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
