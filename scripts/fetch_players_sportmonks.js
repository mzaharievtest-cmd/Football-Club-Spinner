// scripts/fetch_players_sportmonks.js
import 'dotenv/config';
import fs from 'fs-extra';
import axios from 'axios';
import pLimit from 'p-limit';
import path from 'path';

const {
  SPORTMONKS_TOKEN,
  SEASON_ID,
  SEASON_NAME,
  LEAGUE_ID = '8',          // 8 = Premier League (confirm in your account)
  TEAM_IDS,
  OUT = 'data/players.json',
  SPORTMONKS_TIMEZONE = 'Europe/London',
  LEAGUE_CODE = 'EPL'
} = process.env;

if (!SPORTMONKS_TOKEN) {
  console.error('❌ Missing SPORTMONKS_TOKEN in environment. Add it to your local .env or CI env.');
  process.exit(1);
}

const API = axios.create({
  baseURL: 'https://api.sportmonks.com/v3/football',
  params: { api_token: SPORTMONKS_TOKEN },
  timeout: 20000
});

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getJson(url, params = {}, { attempts = 3, backoffMs = 800 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const { data } = await API.get(url, { params });
      return data;
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      if (status === 429) {
        const retryAfter = Number(err.response.headers['retry-after'] || 2) * 1000;
        console.warn(`429 Rate limited. Sleeping ${retryAfter}ms…`);
        await sleep(retryAfter);
      } else {
        console.warn(`Request failed (${status || 'no-status'}) attempt=${i}/${attempts} → ${url}`);
        if (i < attempts) await sleep(backoffMs * i);
      }
    }
  }
  throw lastErr;
}

/** Discover season id from league+name if SEASON_ID is not provided */
async function discoverSeasonId(leagueId, seasonName) {
  console.log(`Discovering season id for league=${leagueId} name="${seasonName}"…`);
  // Get league with seasons included
  const data = await getJson(`/leagues/${leagueId}`, { include: 'seasons' });
  const seasons = data?.data?.seasons?.data || [];
  const match = seasons.find(s => (s.name || '').trim() === seasonName.trim());
  if (!match) {
    const examples = seasons.slice(0, 5).map(s => s.name);
    console.error(`  ✖ Could not find season "${seasonName}" for league ${leagueId}. Examples: ${JSON.stringify(examples)}`);
    return null;
  }
  console.log(`  ✓ Found season id=${match.id} (${match.name})`);
  return match.id;
}

/** Get team meta (name/logo) for courtesy logs */
async function getTeamMeta(teamId) {
  try {
    const data = await getJson(`/teams/${teamId}`);
    const t = data?.data;
    return { id: teamId, name: t?.name || `team-${teamId}`, image: t?.image_path || null };
  } catch {
    return { id: teamId, name: `team-${teamId}`, image: null };
  }
}

/** Fetch squad for a team; try filtered by season first, then fallback unfiltered if 404/empty */
async function fetchSquad(teamId, seasonId) {
  const include = 'team,player.nationality,player.position';
  // Try with filters (some tenants support this)
  const paramsWithFilter = { include, filters: `playerstatisticSeasons:${seasonId}` };

  try {
    const res = await getJson(`/squads/teams/${teamId}`, paramsWithFilter);
    const rows = res?.data || [];
    if (rows.length > 0) return rows;
  } catch (e) {
    // continue to fallback
  }

  // Fallback: without filters (common case for current squad)
  const res2 = await getJson(`/squads/teams/${teamId}`, { include });
  return res2?.data || [];
}

/** Normalize players to a compact JSON your app understands */
function normalizePlayers(rows, { seasonId, seasonName, leagueCode }) {
  const out = [];
  for (const row of rows) {
    const player = row?.player?.data || {};
    const team = row?.team?.data || {};
    const pos = player?.position?.data || {};

    out.push({
      // generic fields your UI already uses
      team_name: player?.display_name || player?.fullname || player?.name || 'Player',
      logo_url: player?.image_path || null, // image_url for your grid/wheel
      league_code: leagueCode || 'PLAYER',
      primary_color: '#163058',

      // nice-to-have metadata
      name: player?.display_name || player?.fullname || player?.name || null,
      player_id: player?.id || null,
      club: team?.name || null,
      team_id: team?.id || null,
      number: row?.jersey_number ?? null,
      pos: pos?.name || pos?.short_code || null,
      nationality: player?.nationality?.data?.name || null,

      // season
      season_id: seasonId || null,
      season: seasonName || null,
      source: 'sportmonks'
    });
  }
  // Deduplicate by player_id (keep first)
  const seen = new Set();
  return out.filter(p => {
    const key = p.player_id || `${p.name}-${p.club}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  // Ensure output dir exists
  await fs.ensureDir(path.dirname(OUT));

  // Determine season id
  let seasonId = SEASON_ID ? Number(SEASON_ID) : null;
  let seasonName = SEASON_NAME || null;
  if (!seasonId) {
    if (!LEAGUE_ID || !SEASON_NAME) {
      console.error('❌ Provide either SEASON_ID, or LEAGUE_ID + SEASON_NAME in your env.');
      process.exit(1);
    }
    seasonId = await discoverSeasonId(LEAGUE_ID, SEASON_NAME);
    if (!seasonId) process.exit(1);
  }
  if (!seasonName) {
    try {
      const s = await getJson(`/seasons/${seasonId}`);
      seasonName = s?.data?.name || null;
    } catch {}
  }

  // Resolve team ids
  const teamIds = String(TEAM_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number);

  if (!teamIds.length) {
    console.error('❌ TEAM_IDS is empty. Add comma-separated team ids to .env (e.g., TEAM_IDS=9,19,49,50,...)');
    process.exit(1);
  }

  console.log(`Season: ${seasonId}${seasonName ? ` (${seasonName})` : ''}`);
  console.log(`Teams : ${teamIds.length}`);
  console.log('———————');

  // Courtesy team names for nicer logs
  const metas = await Promise.all(teamIds.map(getTeamMeta));
  metas.forEach((m, i) => console.log(`[${i + 1}/${teamIds.length}] ${m.name} (id=${m.id})`));
  console.log('———————');

  const limit = pLimit(2); // keep it polite to the API
  const allPlayers = [];
  let anyErrors = false;

  // Fetch each squad (with retry/429 handling done inside getJson)
  const tasks = teamIds.map((teamId, idx) => limit(async () => {
    try {
      const label = metas[idx]?.name || `team-${teamId}`;
      const rows = await fetchSquad(teamId, seasonId);
      const normalized = normalizePlayers(rows, { seasonId, seasonName, leagueCode: LEAGUE_CODE });
      console.log(`[${idx + 1}/${teamIds.length}] ${label} … + ${normalized.length} players`);
      allPlayers.push(...normalized);
      // small delay to avoid burst
      await sleep(250);
    } catch (e) {
      anyErrors = true;
      console.warn(`[${idx + 1}/${teamIds.length}] team=${teamId} failed: ${e?.response?.status || e.message}`);
    }
  }));

  await Promise.all(tasks);

  // Final JSON write (with backup)
  const backup = `${OUT}.bak`;
  if (await fs.pathExists(OUT)) {
    await fs.copy(OUT, backup);
    console.log(`Backup written to ${backup}`);
  }
  // Sort by club then name for determinism
  allPlayers.sort((a, b) =>
    String(a.club || '').localeCompare(String(b.club || '')) ||
    String(a.team_name || '').localeCompare(String(b.team_name || ''))
  );
  await fs.writeJson(OUT, allPlayers, { spaces: 2 });
  console.log(`Done. Wrote ${allPlayers.length} players to ${OUT}`);

  if (anyErrors) {
    console.log('Some teams failed; check logs above. You can re-run to fill the gaps.');
  }
}

main().catch(err => {
  console.error('Fatal:', err?.response?.data || err);
  process.exit(1);
});
