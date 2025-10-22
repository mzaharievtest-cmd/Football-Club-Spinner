// fetch_players_apifootball.js (CommonJS)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const fetch = (...a) => import('node-fetch').then(({default:f}) => f(...a));

const API_KEY = process.env.FOOTBALL_API_KEY;
const LEAGUE  = process.env.LEAGUE || '39';      // Premier League
const SEASON  = process.env.SEASON || '2025';
const OUT     = process.env.OUT || 'data/players.json';
const TEAM_IDS_ENV = (process.env.TEAM_IDS || '').trim();

if (!API_KEY) {
  console.error('Missing FOOTBALL_API_KEY in .env'); process.exit(1);
}

async function api(path) {
  const url = `https://v3.football.api-sports.io${path}`;
  const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY } });
  if (!res.ok) {
    const txt = await res.text().catch(()=>'');
    throw new Error(`${res.status} ${path}\n${txt.slice(0,400)}`);
  }
  return res.json();
}

async function getTeamIds() {
  if (TEAM_IDS_ENV) return TEAM_IDS_ENV.split(',').map(s => s.trim()).filter(Boolean);
  const data = await api(`/teams?league=${LEAGUE}&season=${SEASON}`);
  const ids = (data.response || []).map(r => r.team?.id).filter(Boolean);
  if (ids.length !== 20) {
    console.warn(`Warning: expected 20 PL teams, got ${ids.length}. Proceeding with found IDs.`);
  }
  return ids;
}

async function getTeamSquad(teamId) {
  // players endpoint: /players?team=ID&season=YYYY; iterate pages just in case
  let page = 1, all = [];
  while (true) {
    const data = await api(`/players?team=${teamId}&season=${SEASON}&page=${page}`);
    all = all.concat(data.response || []);
    if (page >= (data.paging?.total || 1)) break;
    page++;
  }
  return all;
}

function normalizePlayers(teamBlock) {
  // teamBlock is one entry from /players response
  // We flatten to your wheel-friendly structure
  const out = [];
  for (const r of teamBlock) {
    const p = r.player || {};
    const t = r.statistics?.[0]?.team || {};
    out.push({
      name: p.name || '',
      firstname: p.firstname || '',
      lastname: p.lastname || '',
      age: p.age || null,
      nationality: p.nationality || '',
      photo: p.photo || '',                // image URL
      club: t.name || '',
      team_id: t.id || null,
      season: `${SEASON} Premier League`,
      number: p.number || null,
      pos: r.statistics?.[0]?.games?.position || null,
      image_url: p.photo || '',            // <- the field you’ll use in UI
    });
  }
  return out;
}

(async () => {
  try {
    console.log(`Season: ${SEASON}`);
    const teamIds = await getTeamIds();
    console.log(`Teams : ${teamIds.length}`);
    console.log('———————');

    const allPlayers = [];
    let idx = 0;
    for (const id of teamIds) {
      idx++;
      process.stdout.write(`[${idx}/${teamIds.length}] team=${id} … `);
      try {
        const resp = await getTeamSquad(id);
        const norm = normalizePlayers(resp);
        allPlayers.push(...norm);
        console.log(`+ ${norm.length} players`);
      } catch (e) {
        console.log(`FAIL (${e.message.split('\n')[0]})`);
      }
    }

    // Ensure output dir
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    // Write
    fs.writeFileSync(OUT, JSON.stringify(allPlayers, null, 2));
    console.log(`Done. Wrote ${allPlayers.length} players to ${OUT}`);
  } catch (e) {
    console.error('Fatal:', e.message);
    process.exit(1);
  }
})();
