// scripts/fetch_players_apifootball.js
// Node >= 18 (uses built-in fetch). No external deps.
// Fetches PL 2025 squads with photos and writes data/players.json.

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://v3.football.api-sports.io';
const LEAGUE_ID = 39;           // Premier League
const SEASON = 2025;            // 2025/26
const OUTFILE = path.resolve('data/players.json');
const DUMP_DIR = path.resolve('tmp/api-dumps');

const API_KEY = process.env.FOOTBALL_API_KEY;

if (!API_KEY) {
  console.error('Missing FOOTBALL_API_KEY env var. Run:\n  export FOOTBALL_API_KEY="..."\n');
  process.exit(1);
}

async function api(pathname, params = {}, attempt = 1) {
  const usp = new URLSearchParams(params);
  const url = `${API_BASE}${pathname}?${usp.toString()}`;
  const res = await fetch(url, {
    headers: { 'x-apisports-key': API_KEY }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (attempt < 3 && res.status >= 500) {
      await new Promise(r => setTimeout(r, 800 * attempt));
      return api(pathname, params, attempt + 1);
    }
    // dump for debugging
    fs.mkdirSync(DUMP_DIR, { recursive: true });
    fs.writeFileSync(path.join(DUMP_DIR, `error-${Date.now()}.json`), body);
    throw new Error(`HTTP ${res.status} for ${pathname}?${usp} :: ${body.slice(0,300)}`);
  }
  return res.json();
}

async function getTeams() {
  const data = await api('/teams', { league: LEAGUE_ID, season: SEASON });
  const teams = (data.response || []).map(r => ({
    id: r.team?.id,
    name: r.team?.name,
    logo: r.team?.logo
  })).filter(t => t.id);
  return teams;
}

async function getPlayersForTeam(teamId) {
  // /players is paginated
  let page = 1;
  const players = [];
  while (true) {
    const data = await api('/players', { team: teamId, season: SEASON, page });
    const batch = (data.response || []);
    for (const r of batch) {
      const p = r.player || {};
      // r.statistics may include team name; safe fallback:
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
        image_url: p.photo || null // <- CDN photo from API-FOOTBALL
      });
    }

    const current = data.paging?.current ?? page;
    const total   = data.paging?.total ?? page;
    if (current >= total) break;
    page++;
    // Be kind to rate limits
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
      console.warn(`Warning: expected 20 PL teams, got ${teams.length}. (Check your plan/coverage.)`);
    }

    const allPlayers = [];
    for (let i = 0; i < teams.length; i++) {
      const t = teams[i];
      console.log(`[${i+1}/${teams.length}] ${t.name} (id=${t.id})`);
      try {
        const teamPlayers = await getPlayersForTeam(t.id);
        console.log(`  + ${teamPlayers.length} players`);
        allPlayers.push(...teamPlayers);
      } catch (e) {
        console.warn(`  ! Failed players for team=${t.id}: ${e.message}`);
      }
      // small delay between teams
      await new Promise(r => setTimeout(r, 300));
    }

    // Deduplicate by id (some players appear multiple times if transferred)
    const dedupMap = new Map();
    for (const p of allPlayers) {
      dedupMap.set(p.id || `${p.name}-${p.club}`, p);
    }
    const final = Array.from(dedupMap.values());

    // Ensure output dir
    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });

    // Backup if exists
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
