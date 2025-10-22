const fs = require('fs');
const path = require('path');
require('dotenv').config();

const API_KEY   = process.env.FOOTBALL_API_KEY;
const LEAGUE    = Number(process.env.LEAGUE || 39);     // Premier League
const SEASON    = Number(process.env.SEASON || 2025);   // season start year
const OUT_PATH  = process.env.OUT || 'data/players.json';
const TEAM_IDS  = (process.env.TEAM_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .map(n => Number(n));

if (!API_KEY) {
  console.error('❌ Missing FOOTBALL_API_KEY in .env');
  process.exit(1);
}

const BASE = 'https://v3.football.api-sports.io';
const HEADERS = { 'x-apisports-key': API_KEY, 'Accept': 'application/json' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getJSON(url, params = {}, retries = 3) {
  const qs = new URLSearchParams(params).toString();
  const full = `${url}?${qs}`;
  for (let a = 1; a <= retries; a++) {
    try {
      const res = await fetch(full, { headers: HEADERS });
      const remain = res.headers.get('x-ratelimit-requests-remaining');
      const reset  = res.headers.get('x-ratelimit-requests-reset');
      if (!res.ok) {
        const text = await res.text().catch(()=>'');
        throw new Error(`HTTP ${res.status} ${res.statusText} (remain=${remain}, reset=${reset}) • ${text.slice(0,200)}`);
      }
      const json = await res.json();
      return { json, remain, reset };
    } catch (e) {
      if (a === retries) throw e;
      console.warn(`  ⚠️  ${e.message} — retry ${a}/${retries}`);
      await sleep(300 * a);
    }
  }
}

// Normalize to your wheel’s expected shape
function normalizeFromPlayers(entry) {
  const p = entry.player || {};
  const s = (entry.statistics && entry.statistics[0]) || {};
  const team = s.team || {};
  const games = s.games || {};
  const season = (s.league && s.league.season) || SEASON;

  const name = p.name || [p.firstname, p.lastname].filter(Boolean).join(' ') || 'Player';
  const img  = p.photo || '';

  return {
    team_name: name,
    logo_url: img,
    league_code: 'PLAYER',
    primary_color: '#163058',
    stadium: '',

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

function normalizeFromSquad(player, team) {
  // /players/squads response: { response: [{ team: {...}, players: [...] }] }
  const name = player.name || 'Player';
  const img  = player.photo || '';
  return {
    team_name: name,
    logo_url: img,
    league_code: 'PLAYER',
    primary_color: '#163058',
    stadium: '',

    player_id: player.id || null,
    name,
    club: team?.name || null,
    team_id: team?.id || null,
    number: player.number != null ? String(player.number) : null,
    pos: player.position || null,
    season: String(SEASON),
    image_url: img,
    nationality: player.nationality || null,
    age: player.age || null,
    height: player.height || null,
    weight: player.weight || null,
    team_logo: team?.logo || null
  };
}

function ensureDir(p) {
  const d = path.dirname(p);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function dedupe(players) {
  const map = new Map();
  for (const p of players) {
    const key = p.player_id ?? `${p.name}|${p.club}`;
    if (!map.has(key)) map.set(key, p);
  }
  return Array.from(map.values());
}

async function fetchPlayersByLeagueSeason() {
  console.log(`→ Fetching /players by league=${LEAGUE} season=${SEASON} (paged)…`);
  let page = 1;
  const out = [];
  while (true) {
    const { json, remain } = await getJSON(`${BASE}/players`, { league: LEAGUE, season: SEASON, page });
    const list = json.response || [];
    const paging = json.paging || {};
    console.log(`  [page ${paging.current || page}/${paging.total || '?'}] +${list.length} (remain=${remain})`);
    list.forEach(e => out.push(normalizeFromPlayers(e)));
    if (!paging.total || page >= paging.total) break;
    page++;
    await sleep(120); // be gentle
  }
  return dedupe(out);
}

async function fetchPlayersBySquads(teamIds) {
  console.log(`→ Falling back to /players/squads for ${teamIds.length} teams…`);
  const out = [];
  let idx = 0;
  for (const id of teamIds) {
    idx++;
    try {
      const { json, remain } = await getJSON(`${BASE}/players/squads`, { team: id });
      const item = (json.response && json.response[0]) || null;
      const team = item?.team || null;
      const players = item?.players || [];
      console.log(`  [${idx}/${teamIds.length}] team=${id} ${team?.name ? `(${team.name}) `:''}+${players.length} (remain=${remain})`);
      players.forEach(pl => out.push(normalizeFromSquad(pl, team)));
      await sleep(120);
    } catch (e) {
      console.warn(`  ✖ team=${id} squads error: ${e.message}`);
    }
  }
  return dedupe(out);
}

(async () => {
  try {
    // 1) Try full league-season
    let players = await fetchPlayersByLeagueSeason();

    // 2) If empty, try previous season automatically, then squads
    if (players.length === 0) {
      console.warn('⚠️ League/season returned 0 players. Trying previous season…');
      const prevSeason = SEASON - 1;
      let prev = [];
      try {
        prev = await (async () => {
          let page = 1;
          const out = [];
          while (true) {
            const { json } = await getJSON(`${BASE}/players`, { league: LEAGUE, season: prevSeason, page });
            const list = json.response || [];
            const paging = json.paging || {};
            console.log(`  [prev ${paging.current || page}/${paging.total || '?'}] +${list.length}`);
            list.forEach(e => out.push(normalizeFromPlayers(e)));
            if (!paging.total || page >= paging.total) break;
            page++;
            await sleep(120);
          }
          return dedupe(out);
        })();
      } catch (_) {}
      if (prev.length) {
        console.log(`✅ Using previous season ${prevSeason}: ${prev.length} players`);
        players = prev;
      } else if (TEAM_IDS.length) {
        // 3) Fallback to squads per team
        players = await fetchPlayersBySquads(TEAM_IDS);
      }
    }

    ensureDir(OUT_PATH);
    if (fs.existsSync(OUT_PATH)) fs.copyFileSync(OUT_PATH, `${OUT_PATH}.bak`);
    fs.writeFileSync(OUT_PATH, JSON.stringify(players, null, 2));
    console.log(`\nDone. Wrote ${players.length} players to ${OUT_PATH}`);
  } catch (e) {
    console.error('\n❌ Fatal:', e.message);
    process.exit(1);
  }
})();
