// scripts/fetch_players_apifootball.js
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const API_KEY   = process.env.APIFOOTBALL_KEY;
const SEASON    = process.env.SEASON || '2025';
const LEAGUE_ID = process.env.LEAGUE_ID || '39'; // Premier League
const OUT_FILE  = process.env.OUT_FILE || './data/players.json';

const BASE = 'https://v3.football.api-sports.io';
const H    = { 'x-apisports-key': API_KEY };

if (!API_KEY) {
  console.error('Missing APIFOOTBALL_KEY in .env');
  process.exit(1);
}

async function api(pathname, params = {}) {
  const url = new URL(BASE + pathname);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { headers: H });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} for ${url}\n${body}`);
  }
  return res.json();
}

async function getTeams({ leagueId, season }) {
  const json = await api('/teams', { league: String(leagueId), season: String(season) });
  return (json.response || []).map(r => ({
    id: r.team?.id,
    name: r.team?.name,
    logo: r.team?.logo
  })).filter(t => t.id && t.name);
}

async function getPlayersForTeam(teamId, season) {
  let page = 1;
  const all = [];
  while (true) {
    const json = await api('/players', { team: String(teamId), season: String(season), page: String(page) });
    const items = json.response || [];
    items.forEach(r => {
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
        image_url: p.photo || '' // ← photo from API-Football CDN
      });
    });
    const cur = json.paging?.current || page;
    const total = json.paging?.total || cur;
    if (cur >= total) break;
    page++;
    // polite delay to be nice to the API (and avoid burst rate limits)
    await new Promise(r => setTimeout(r, 150));
  }
  return all;
}

async function main() {
  console.log(`Season: ${SEASON} | League: ${LEAGUE_ID}`);
  const teams = await getTeams({ leagueId: LEAGUE_ID, season: SEASON });
  console.log(`Teams: ${teams.length}`);

  const outDir = path.dirname(OUT_FILE);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const allPlayers = [];
  for (const [i, team] of teams.entries()) {
    console.log(`[${i+1}/${teams.length}] ${team.name} (id=${team.id})`);
    try {
      const players = await getPlayersForTeam(team.id, SEASON);
      console.log(`  + ${players.length} players`);
      allPlayers.push(...players);
    } catch (err) {
      console.warn(`  ! Failed for team ${team.id} ${team.name}: ${err.message}`);
    }
    // small delay between teams
    await new Promise(r => setTimeout(r, 200));
  }

  // Optional: de-duplicate by name+club (safeguard)
  const seen = new Set();
  const unique = allPlayers.filter(p => {
    const key = `${p.name}::${p.club}::${p.season}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Write pretty JSON
  fs.writeFileSync(OUT_FILE, JSON.stringify(unique, null, 2));
  console.log(`Done. Wrote ${unique.length} players to ${OUT_FILE}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
