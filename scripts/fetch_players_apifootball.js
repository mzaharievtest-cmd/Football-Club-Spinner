const fs = require('fs');
const path = require('path');
require('dotenv').config();

const API_KEY  = process.env.FOOTBALL_API_KEY;
const LEAGUE   = Number(process.env.LEAGUE || 39);
const SEASON   = Number(process.env.SEASON || 2025);
const OUT_PATH = process.env.OUT || 'data/players.json';

if (!API_KEY) { console.error('Missing FOOTBALL_API_KEY in .env'); process.exit(1); }

const BASE = 'https://v3.football.api-sports.io';
const HEADERS = { 'x-apisports-key': API_KEY };

const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

async function getJSON(url, params = {}, retries = 3) {
  const qs = new URLSearchParams(params).toString();
  const full = `${url}?${qs}`;
  for (let a=1; a<=retries; a++){
    try {
      const res = await fetch(full, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (a===retries) throw e;
      await sleep(300*a);
    }
  }
}

function ensureDir(p){ const d = path.dirname(p); if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); }

function normalize(entry){
  const p = entry.player || {};
  const s = (entry.statistics && entry.statistics[0]) || {};
  const team = s.team || {};
  const games = s.games || {};
  const season = (s.league && s.league.season) || SEASON;

  const name = p.name || [p.firstname, p.lastname].filter(Boolean).join(' ') || 'Player';
  const img  = p.photo || '';

  return {
    // fields your wheel uses in PLAYER mode
    team_name: name,
    logo_url: img,
    league_code: 'PLAYER',
    primary_color: '#163058',
    stadium: '',

    // extra fields if you want to show later
    player_id: p.id || null,
    name,
    club: team.name || null,
    team_id: team.id || null,
    number: games.number != null ? String(games.number) : null,
    pos: games.position || null,
    season: String(season),
    image_url: img,
    nationality: p.nationality || null,
    age: p.age || null,
    height: p.height || null,
    weight: p.weight || null,
    team_logo: team.logo || null
  };
}

async function fetchAll() {
  let page = 1;
  const out = [];
  while (true) {
    const data = await getJSON(`${BASE}/players`, { league: LEAGUE, season: SEASON, page });
    const list = data.response || [];
    const paging = data.paging || {};
    console.log(`[page ${paging.current || page}/${paging.total || '?'}] +${list.length}`);
    list.forEach(e => out.push(normalize(e)));
    if (!paging.total || page >= paging.total) break;
    page++;
    await sleep(150);
  }
  // de-dup by player_id
  const map = new Map();
  for (const p of out) {
    const key = p.player_id ?? `${p.name}|${p.club}`;
    if (!map.has(key)) map.set(key, p);
  }
  return Array.from(map.values());
}

(async () => {
  const players = await fetchAll();
  ensureDir(OUT_PATH);
  if (fs.existsSync(OUT_PATH)) fs.copyFileSync(OUT_PATH, `${OUT_PATH}.bak`);
  fs.writeFileSync(OUT_PATH, JSON.stringify(players, null, 2));
  console.log(`Done. Wrote ${players.length} players to ${OUT_PATH}`);
})();
