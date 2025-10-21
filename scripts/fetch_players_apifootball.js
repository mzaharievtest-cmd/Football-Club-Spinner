// scripts/fetch_players_apifootball.js
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const API_KEY   = process.env.APIFOOTBALL_KEY;
const LEAGUE_ID = process.env.LEAGUE_ID || '39';       // EPL
// IMPORTANT: API-Football uses the SEASON START YEAR (2024 => 2024/25)
const SEASON    = Number(process.env.SEASON || 2024);
const OUT_FILE  = process.env.OUT_FILE || './data/players.json';

const BASE    = 'https://v3.football.api-sports.io';
const HEADERS = { 'x-apisports-key': API_KEY };

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

/* 1) Get the 20 teams for league+season from STANDINGS (this is canonical) */
async function getTeamsFromStandings({ leagueId, season }) {
  const json = await api('/standings', { league: leagueId, season });
  const table = json.response?.[0]?.league?.standings?.[0] || [];
  const teams = table
    .map(r => ({ id: r.team?.id, name: r.team?.name, logo: r.team?.logo }))
    .filter(t => t.id && t.name);
  return teams;
}

/* 2) Prefer /players/squads (current squad, no season arg) */
async function getSquad(teamId) {
  const json = await api('/players/squads', { team: teamId });
  const arr = json.response?.[0]?.players || [];
  return arr.map(p => ({
    name: p.name || '',
    club: '',                // filled later if needed
    number: p.number != null ? String(p.number) : '',
    pos: p.position || '',
    season: String(SEASON),  // normalize to target season
    image_url: p.photo || ''
  }));
}

/* 3) Fallback to /players with league+season (paged) */
async function getPlayersBySeason(teamId, season) {
  const all = [];
  let page = 1;
  while (true) {
    const js = await api('/players', { league: LEAGUE_ID, team: teamId, season, page });
    const items = js.response || [];
    for (const r of items) {
      const p = r.player || {};
      const s = (r.statistics && r.statistics[0]) || {};
      all.push({
        name: p.name || '',
        club: s.team?.name || '',
        number: s.games?.number != null ? String(s.games.number) : '',
        pos: s.games?.position || '',
        season: String(season),
        image_url: p.photo || ''
      });
    }
    const cur = js.paging?.current || page;
    const total = js.paging?.total || cur;
    if (cur >= total) break;
    page++;
    await sleep(120);
  }
  return all;
}

/* 4) Orchestrate */
async function main() {
  console.log(`League: ${LEAGUE_ID}`);
  console.log(`Season: ${SEASON} (start year → e.g. 2024 = 2024/25)`);

  const teams = await getTeamsFromStandings({ leagueId: LEAGUE_ID, season: SEASON });
  console.log(`Teams returned: ${teams.length}`);
  console.log('— Team list —');
  teams.forEach((t, i) => console.log(`[${i+1}/20] ${t.name} (id=${t.id})`));
  console.log('———————');

  if (teams.length !== 20) {
    console.error('⚠️ Standings did not return 20 teams. Check LEAGUE_ID/SEASON.');
  }

  const outDir = path.dirname(OUT_FILE);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const result = [];
  for (const [i, team] of teams.entries()) {
    process.stdout.write(`[${i+1}/20] ${team.name} (id=${team.id}) … `);
    let players = [];
    try {
      // Prefer current squad
      players = await getSquad(team.id);

      // If empty, fall back to season endpoint
      if (players.length === 0) {
        players = await getPlayersBySeason(team.id, SEASON);
      }

      // Normalize club field to this team’s name if missing
      players.forEach(p => { if (!p.club) p.club = team.name; });

      console.log(`+ ${players.length} players`);
      result.push(...players);
    } catch (err) {
      console.log(`! error: ${err.message.split('\n')[0]}`);
    }
    await sleep(160);
  }

  // De-dup by name+club+season
  const seen = new Set();
  const unique = result.filter(p => {
    const key = `${p.name}::${p.club}::${p.season}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  fs.writeFileSync(OUT_FILE, JSON.stringify(unique, null, 2));
  console.log(`Done. Wrote ${unique.length} players to ${OUT_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
