// CommonJS version (works regardless of "type" in package.json)
require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const pLimit = require('p-limit');

const {
  SPORTMONKS_TOKEN,
  // choose one of the following ways to identify the season
  SEASON_ID,                  // e.g. 25583  (preferred if you know it)
  LEAGUE_ID,                  // e.g. 8      (Premier League in Sportmonks — confirm in your account)
  SEASON_NAME,                // e.g. 2025/2026 (used only if SEASON_ID is missing)
  // optional: if you already know the Sportmonks team IDs, set them here
  TEAM_IDS,                   // e.g. 9,14,18,... (Sportmonks team IDs, not your own list)
  // output + misc
  OUT = 'data/players.json',
  SPORTMONKS_TIMEZONE = 'Europe/London',
  LEAGUE_CODE = 'EPL'
} = process.env;

const ARGS = new Set(process.argv.slice(2));
const DISCOVER_ONLY = ARGS.has('--discover'); // print the teams/ids and exit

if (!SPORTMONKS_TOKEN) {
  console.error('❌ Missing SPORTMONKS_TOKEN in your environment (.env).');
  process.exit(1);
}

const api = axios.create({
  baseURL: 'https://api.sportmonks.com/v3/football',
  params: { api_token: SPORTMONKS_TOKEN },
  timeout: 20000
});

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function getJson(url, params = {}, { attempts = 3, backoffMs = 800 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const { data } = await api.get(url, { params });
      return data;
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      if (status === 429) {
        const retryAfter = Number(err.response?.headers?.['retry-after'] || 2) * 1000;
        console.warn(`429 rate limited. Sleeping ${retryAfter}ms…`);
        await sleep(retryAfter);
      } else {
        console.warn(`Request failed (${status || 'no-status'}) attempt=${i}/${attempts} → ${url}`);
        if (i < attempts) await sleep(backoffMs * i);
      }
    }
  }
  throw lastErr;
}

/** If you don’t know the SEASON_ID, find it from league + season name */
async function discoverSeasonId(leagueId, seasonName) {
  console.log(`Discovering season id for league=${leagueId} name="${seasonName}"…`);
  const res = await getJson(`/leagues/${leagueId}`, { include: 'seasons' });
  const seasons = res?.data?.seasons?.data || [];
  const match = seasons.find(s => (s.name || '').trim() === String(seasonName || '').trim());
  if (!match) {
    const examples = seasons.slice(0, 10).map(s => s.name);
    console.error(`  ✖ Could not find season "${seasonName}" for league ${leagueId}. Examples: ${JSON.stringify(examples)}`);
    return null;
  }
  console.log(`  ✓ Found season id=${match.id} (${match.name})`);
  return match.id;
}

/** Discover *Sportmonks* team IDs that participated in a season (filtered to the chosen league when possible) */
async function discoverTeamsForSeason(seasonId, leagueIdNullable) {
  // Primary approach: teams in season endpoint
  // (Depending on your plan, you may need includes or a different filter. This works for most plans.)
  let teams = [];
  try {
    const data = await getJson(`/teams/seasons/${seasonId}`, { include: 'country,league' });
    teams = data?.data || [];
  } catch (e) {
    console.warn('Could not list teams from /teams/seasons/{id}; trying league fallback…');
  }

  // If leagueId is provided, try to filter by it using included league (when available)
  if (leagueIdNullable && Array.isArray(teams) && teams.length) {
    const filtered = teams.filter(t => String(t?.league_id || t?.league?.data?.id || '') === String(leagueIdNullable));
    if (filtered.length) teams = filtered;
  }

  // Fallback if nothing was found: use the league endpoint with includes (if your plan supports it)
  if (!teams.length && leagueIdNullable) {
    try {
      // This may or may not include teams depending on your subscription.
      const data = await getJson(`/leagues/${leagueIdNullable}`, { include: 'teams' });
      const raw = data?.data?.teams?.data || [];
      if (raw.length) teams = raw;
    } catch (_) {}
  }

  if (!teams.length) {
    console.error('✖ Could not discover teams for the season. Double-check your plan and IDs.');
    return [];
  }

  // Normalize minimal info
  return teams.map(t => ({
    id: t.id,
    name: t.name || t.display_name || t.short_code || `team-${t.id}`,
    image: t.image_path || null
  }));
}

/** Fetch squad for a team; try season-filtered first, then fallback to unfiltered */
async function fetchSquad(teamId, seasonId) {
  const include = 'team,player.nationality,player.position';
  // season-filtered (best quality if your plan supports player stats in a season)
  try {
    const withFilter = await getJson(`/squads/teams/${teamId}`, {
      include,
      filters: `playerstatisticSeasons:${seasonId}`
    });
    const rows = withFilter?.data || [];
    if (rows.length) return rows;
  } catch (_) { /* fall through */ }

  // fallback (no filter)
  const plain = await getJson(`/squads/teams/${teamId}`, { include });
  return plain?.data || [];
}

function normalizePlayers(rows, { seasonId, seasonName, leagueCode }) {
  const out = [];
  for (const row of rows) {
    const player = row?.player?.data || {};
    const team = row?.team?.data || {};
    const pos = player?.position?.data || {};
    out.push({
      // map to the wheel’s existing shape so you can re-use drawing code
      team_name: player?.display_name || player?.fullname || player?.name || 'Player',
      logo_url: player?.image_path || null,           // player headshot
      league_code: leagueCode || 'PLAYER',
      primary_color: '#163058',

      // keep richer info for your app
      name: player?.display_name || player?.fullname || player?.name || null,
      player_id: player?.id || null,
      club: team?.name || null,
      team_id: team?.id || null,
      number: row?.jersey_number ?? null,
      pos: pos?.name || pos?.short_code || null,
      nationality: player?.nationality?.data?.name || null,
      season_id: seasonId || null,
      season: seasonName || null,
      source: 'sportmonks'
    });
  }
  // de-dupe on player_id (or name+club if missing)
  const seen = new Set();
  return out.filter(p => {
    const key = p.player_id || `${p.name}-${p.club}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  await fs.ensureDir(path.dirname(OUT));

  // Resolve season
  let seasonId = SEASON_ID ? Number(SEASON_ID) : null;
  let seasonName = SEASON_NAME || null;

  if (!seasonId) {
    if (!LEAGUE_ID || !SEASON_NAME) {
      console.error('❌ Provide either SEASON_ID, or LEAGUE_ID + SEASON_NAME in your .env');
      process.exit(1);
    }
    const found = await discoverSeasonId(LEAGUE_ID, SEASON_NAME);
    if (!found) process.exit(1);
    seasonId = found;
  }

  if (!seasonName) {
    try {
      const s = await getJson(`/seasons/${seasonId}`);
      seasonName = s?.data?.name || null;
    } catch (_) {}
  }

  // Discover teams if TEAM_IDS not specified or in discover mode
  let teamIds = [];
  if (DISCOVER_ONLY || !TEAM_IDS) {
    const discovered = await discoverTeamsForSeason(seasonId, LEAGUE_ID);
    if (!discovered.length) process.exit(1);

    console.log(`Teams in season ${seasonId}${seasonName ? ` (${seasonName})` : ''}: ${discovered.length}`);
    discovered.forEach((t, i) => {
      console.log(`[${String(i + 1).padStart(2, '0')}/${discovered.length}] ${t.name}  (id=${t.id})`);
    });

    if (DISCOVER_ONLY) {
      console.log('\nTip: set TEAM_IDS in your .env with the ids above, e.g.\nTEAM_IDS=' +
        discovered.map(t => t.id).join(','));
      return;
    }
    teamIds = discovered.map(t => t.id);
  } else {
    teamIds = String(TEAM_IDS).split(',').map(s => Number(s.trim())).filter(Boolean);
  }

  console.log('———————');
  const limit = pLimit(2); // be gentle with rate limits
  const allPlayers = [];
  let hadErrors = false;

  await Promise.all(teamIds.map((teamId, idx) => limit(async () => {
    try {
      const rows = await fetchSquad(teamId, seasonId);
      const normalized = normalizePlayers(rows, { seasonId, seasonName, leagueCode: LEAGUE_CODE });
      console.log(`[${idx + 1}/${teamIds.length}] team=${teamId} … + ${normalized.length} players`);
      allPlayers.push(...normalized);
      await sleep(250);
    } catch (e) {
      hadErrors = true;
      console.warn(`[${idx + 1}/${teamIds.length}] team=${teamId} failed: ${e?.response?.status || e.message}`);
    }
  })));

  if (await fs.pathExists(OUT)) {
    await fs.copy(OUT, `${OUT}.bak`);
    console.log(`Backup written to ${OUT}.bak`);
  }

  allPlayers.sort((a, b) =>
    String(a.club || '').localeCompare(String(b.club || '')) ||
    String(a.team_name || '').localeCompare(String(b.team_name || ''))
  );

  await fs.writeJson(OUT, allPlayers, { spaces: 2 });
  console.log(`Done. Wrote ${allPlayers.length} players to ${OUT}`);
  if (hadErrors) console.log('Some teams failed; re-run later to fill gaps.');
}

main().catch(err => {
  console.error('Fatal:', err?.response?.data || err);
  process.exit(1);
});
