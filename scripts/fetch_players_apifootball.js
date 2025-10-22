// scripts/fetch_players_apifootball.js
// Node >= 18. Fetches PL 2025 squads with photos → data/players.json
// Tries /teams first; falls back to /standings if /teams is blocked (403).

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://v3.football.api-sports.io';
const LEAGUE_ID = 39;   // Premier League
const SEASON    = 2025; // 2025/26
const OUTFILE   = path.resolve('data/players.json');
const DUMP_DIR  = path.resolve('tmp/api-dumps');

const API_KEY = process.env.FOOTBALL_API_KEY;

if (!API_KEY) {
  console.error('Missing FOOTBALL_API_KEY env var. Run:\n  export FOOTBALL_API_KEY="YOUR_REAL_KEY"\n');
  process.exit(1);
}

async function api(pathname, params = {}, attempt = 1) {
  const usp = new URLSearchParams(params);
  const url = `${API_BASE}${pathname}?${usp.toString()}`;
  const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY, 'accept': 'application/json' } });

  const text = await res.text();
  if (!res.ok) {
    // dump for debugging
    fs.mkdirSync(DUMP_DIR, { recursive: true });
    const dumpFile = path.join(DUMP_DIR, `${pathname.replace(/[\/?=&]/g,'_')}-${Date.now()}.json`);
    fs.writeFileSync(dumpFile, text);
    // Retry 5xx a couple of times
    if (res.status >= 500 && attempt < 3) {
      await new Promise(r => setTimeout(r, 800 * attempt));
      return api(pathname, params, attempt + 1);
    }
    throw new Error(`HTTP ${res.status} for ${pathname}?${usp} :: ${text.slice(0,300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${pathname}?${usp}`);
  }
}

/** Primary: /teams?league&season */
async function getTeamsViaTeams() {
  const data = await api('/teams', { league: LEAGUE_ID, season: SEASON });
  return (data.response || []).map(r => ({
    id: r.team?.id,
    name: r.team?.name,
    logo: r.team?.logo
  })).filter(t => t.id);
}

/** Fallback: /standings?league&season (extract teams out of standings table) */
async function getTeamsViaStandings() {
  const data = await api('/standings', { league: LEAGUE_ID, season: SEASON });
  // response[0].league.standings is an array-of-arrays (one per group) of team rows
  const lists = data.response?.[0]?.league?.standings || [];
  const flat = lists.flat();
  const teams = flat.map(row => ({
    id: row.team?.id,
    name: row.team?.name,
    logo: row.team?.logo
  })).filter(t => t.id);
  // Dedup by id
  const map = new Map();
  for (const t of teams) map.set(t.id, t);
  return Array.from(map.values());
}

async function getTeams() {
  try {
    const t = await getTeamsViaTeams();
    if (t.length) return t;
    console.warn('Info: /teams returned 0 — using /standings fallback.');
    return await getTeamsViaStandings();
  } catch (e) {
    if (/HTTP 403/.test(String(e))) {
      console.warn('Info: /teams blocked (403) — using /standings fallback.');
      return await getTeamsViaStandings();
    }
    throw e;
  }
}

/** Paginated: /players?team&season (auto-paginates) */
async function getPlayersForTeam(teamId) {
  let page = 1;
  const players = [];
  while (true) {
    const data = await api('/players', { team: teamId, season: SEASON, page });
    const batch = data.response || [];
    for (const r of batch) {
      const p = r.player || {};
      const teamName = r.statistics?.[0]?.team?.name || '';
      players.push({
        id: p.id,
        name: [p.firstname, p.lastname].filter(Boolean).join(' ') || p.name || 'Unknown',
        age: p.age ?? null,
        nationality: p.nationality || null,
        height: p.height || null,
        weight: p.weight || null,
        number: r.statistics?.[0]?.games?.number ?? null,
        position: r.statistics?.[0]?.games?.position || null,
        club: teamName,
        season: `${SEASON}/${SEASON + 1}`,
        image_url: p.photo || null
      });
    }
    const current = data.paging?.current ?? page;
    const total   = data.paging?.total ?? page;
    if (current >= total) break;
    page++;
    await new Promise(r => setTimeout(r, 200));
  }
  return players;
}

(async () => {
  try {
    console.log(`Season: ${SEASON}`);
    const teams = await getTeams();
    console.log(`Teams : ${teams.length}`);
    if (teams.length !== 20) {
      console.warn(`Warning: expected 20 PL teams, got ${teams.length}. (This can be plan/coverage related.)`);
    }
    console.log('———————');

    const allPlayers = [];
    for (let i = 0; i < teams.length; i++) {
      const t = teams[i];
      console.log(`[${i+1}/${teams.length}] ${t.name} (id=${t.id})`);
      try {
        const teamPlayers = await getPlayersForTeam(t.id);
        console.log(`  + ${teamPlayers.length} players`);
        allPlayers.push(...teamPlayers);
      } catch (e) {
        console.warn(`  ! Failed team=${t.id}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }

    // Dedup
    const byId = new Map();
    for (const p of allPlayers) byId.set(p.id || `${p.name}-${p.club}`, p);
    const final = Array.from(byId.values());

    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    if (fs.existsSync(OUTFILE)) {
      fs.copyFileSync(OUTFILE, `${OUTFILE}.bak`);
      console.log(`Backup: ${OUTFILE}.bak`);
    }
    fs.writeFileSync(OUTFILE, JSON.stringify(final, null, 2));
    console.log(`Done. Wrote ${final.length} players to ${OUTFILE}`);
  } catch (err) {
    console.error('Fatal:', err.message);
    process.exit(1);
  }
})();
