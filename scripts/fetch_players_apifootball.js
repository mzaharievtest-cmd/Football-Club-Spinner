// scripts/fetch_players_apifootball.js
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const API_KEY    = process.env.APIFOOTBALL_KEY;
const LEAGUE_ID  = process.env.LEAGUE_ID || '39'; // Premier League
// IMPORTANT: API-Football uses the season start year.
// 2024 => 2024/25, 2025 => 2025/26 (may be incomplete today).
const PRIMARY_SEASON = Number(process.env.SEASON || 2024);

// Try current then fallback to previous if a team returns 0 players.
const SEASONS_TO_TRY = [PRIMARY_SEASON, 2024];

const OUT_FILE   = process.env.OUT_FILE || './data/players.json';
const BASE       = 'https://v3.football.api-sports.io';
const HEADERS    = { 'x-apisports-key': API_KEY };

if (!API_KEY) {
  console.error('Missing APIFOOTBALL_KEY in .env');
  process.exit(1);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(pathname, params = {}) {
  const url = new URL(BASE + pathname);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch {}
    throw new Error(`${res.status} ${res.statusText} for ${url}\n${body}`);
  }
  return res.json();
}

async function getTeams({ leagueId, season }) {
  // Be explicit: require both league & season
  const json = await api('/teams', { league: leagueId, season });
  const teams = (json.response || [])
    .map(r => ({ id: r.team?.id, name: r.team?.name, logo: r.team?.logo }))
    .filter(t => t.id && t.name);
  return teams;
}

async function getPlayersForTeamSeason(teamId, season) {
  const all = [];
  let page = 1;
  while (true) {
    const json = await api('/players', { league: LEAGUE_ID, team: teamId, season, page });
    const items = json.response || [];

    for (const r of items) {
      const p = r.player || {};
      const s = (r.statistics && r.statistics[0]) || {};
      const club = s.team?.name || '';
      const number = s.games?.number != null ? String(s.games.number) : '';
      const pos = s.games?.position || '';
      all.push({
        name: p.name || '',
        club,
        number,
        pos,
        season: String(season),
        image_url: p.photo || ''
      });
    }

    const cur = json.paging?.current || page;
    const total = json.paging?.total || cur;
    if (cur >= total) break;
    page++;
    await sleep(120);
  }
  return all;
}

async function getPlayersForTeamWithFallback(teamId) {
  // Try each season until we get a non-empty result
  for (let i = 0; i < SEASONS_TO_TRY.length; i++) {
    const season = SEASONS_TO_TRY[i];
    const players = await getPlayersForTeamSeason(teamId, season);
    if (players.length > 0) return players;
    // brief delay before trying next season
    await sleep(150);
  }
  return []; // none
}

async function main() {
  console.log(`League: ${LEAGUE_ID}`);
  console.log(`Season attempts (first is primary): ${SEASONS_TO_TRY.join(', ')}`);

  const teams = await getTeams({ leagueId: LEAGUE_ID, season: SEASONS_TO_TRY[0] });
  console.log(`Teams returned: ${teams.length}`);
  console.log('— Team list —');
  teams.forEach((t, i) => console.log(`[${i+1}/${teams.length}] ${t.name} (id=${t.id})`));
  console.log('———————');

  const outDir = path.dirname(OUT_FILE);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const allPlayers = [];
  for (const [i, team] of teams.entries()) {
    process.stdout.write(`[${i+1}/${teams.length}] ${team.name} (id=${team.id}) … `);
    try {
      const players = await getPlayersForTeamWithFallback(team.id);
      console.log(`+ ${players.length} players`);
      allPlayers.push(...players);
    } catch (err) {
      console.log(`! error: ${err.message.split('\n')[0]}`);
    }
    await sleep(180); // polite pacing
  }

  // De-duplicate by name+club+season
  const seen = new Set();
  const unique = allPlayers.filter(p => {
    const key = `${p.name}::${p.club}::${p.season}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  fs.writeFileSync(OUT_FILE, JSON.stringify(unique, null, 2));
  console.log(`Done. Wrote ${unique.length} players to ${OUT_FILE}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
