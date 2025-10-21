// scripts/fetch_players_sportmonks.js
// Fetch Premier League squads from Sportmonks v3 and normalize to data/players.json
// - Uses TEAM_IDS from .env when present (recommended).
// - Otherwise can discover the season using LEAGUE_ID + SEASON_NAME.
// - Safe retries, rate-limit handling, error dumps, and backups.

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ───────────────────────────────────────────────────────────────────────────────
// Config
// ───────────────────────────────────────────────────────────────────────────────
const {
  SPORTMONKS_TOKEN,
  TEAM_IDS,                // comma-separated list of team IDs (preferred)
  SEASON_ID,               // numeric season id; if missing we can discover via LEAGUE_ID + SEASON_NAME
  LEAGUE_ID,               // numeric league id (e.g., 8 = EPL) (optional)
  SEASON_NAME,             // e.g., "2025/2026" (optional, used with LEAGUE_ID)
  SPORTMONKS_TIMEZONE = 'Europe/London',
  OUT = 'data/players.json', // output file
} = process.env;

const API_BASE = 'https://api.sportmonks.com/v3/football';

// Change includes/filters here if your plan requires fewer expansions
const SQUAD_INCLUDES = [
  'team',
  'player.nationality',
  'player.statistics.details.type',
  'player.position',
].join(',');

// Example filter to pin statistics to a season. If SEASON_ID is missing, we skip the filter.
const makeSeasonFilter = (seasonId) =>
  seasonId ? `playerstatisticSeasons:${seasonId}` : '';

const OUT_PATH          = path.resolve(process.cwd(), OUT);
const OUT_DIR           = path.dirname(OUT_PATH);
const BACKUP_PATH       = `${OUT_PATH}.bak`;
const DUMPS_DIR         = path.resolve(process.cwd(), 'tmp/api-dumps');

const MAX_RETRIES       = 3;
const BASE_DELAY_MS     = 600;   // backoff base
const HARD_RATE_SLEEP   = 4000;  // extra sleep on 429/too-many

// ───────────────────────────────────────────────────────────────────────────────
// Utils
// ───────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function q(params) {
  const usp = new URLSearchParams(params);
  return usp.toString();
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true }).catch(() => {});
}

async function loadJSONMaybe(file) {
  try {
    const buf = await fs.readFile(file, 'utf8');
    return JSON.parse(buf);
  } catch {
    return null;
  }
}

async function writePrettyJSON(file, data) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function logBanner(msg) {
  const line = '—'.repeat(Math.max(8, msg.length));
  console.log(line);
  console.log(msg);
  console.log(line);
}

// Minimal wrapper around fetch with retry + basic RL handling
async function getJson(url, { attempt = 1 } = {}) {
  const headers = { Accept: 'application/json' };
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await sleep(BASE_DELAY_MS * attempt);
      return getJson(url, { attempt: attempt + 1 });
    }
    throw err;
  }

  // Rate limited?
  if (res.status === 429) {
    const ra = parseInt(res.headers.get('retry-after') || '0', 10);
    const wait = Math.max(HARD_RATE_SLEEP, (isNaN(ra) ? 0 : ra * 1000));
    console.warn(`429 rate-limit — sleeping ${wait}ms then retrying…`);
    await sleep(wait);
    if (attempt < MAX_RETRIES) {
      return getJson(url, { attempt: attempt + 1 });
    }
  }

  // Other transient server errors
  if (res.status >= 500 && res.status <= 599) {
    if (attempt < MAX_RETRIES) {
      await sleep(BASE_DELAY_MS * attempt);
      return getJson(url, { attempt: attempt + 1 });
    }
  }

  // Parse body (JSON or text)
  let bodyText = '';
  let data = null;
  try {
    bodyText = await res.text();
    data = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    // not JSON
    data = null;
  }

  if (!res.ok) {
    const e = new Error(`${res.status} ${url}`);
    e.status = res.status;
    e.payload = data || bodyText || null;
    throw e;
  }

  return data;
}

// Dump an error payload for later debugging
async function dumpErrorPayload(fileStem, payload) {
  await ensureDir(DUMPS_DIR);
  const file = path.join(DUMPS_DIR, `${fileStem}.json`);
  const pretty = typeof payload === 'string'
    ? payload
    : JSON.stringify(payload, null, 2);
  await fs.writeFile(file, pretty, 'utf8');
  console.warn(`  (dumped API response to ${path.relative(process.cwd(), file)})`);
}

// ───────────────────────────────────────────────────────────────────────────────
// Discovery helpers (used only if TEAM_IDS not provided)
// ───────────────────────────────────────────────────────────────────────────────
async function discoverSeasonId(leagueId, seasonName) {
  if (!leagueId || !seasonName) {
    throw new Error('LEAGUE_ID and SEASON_NAME are required to discover a season id.');
  }
  const url = `${API_BASE}/seasons?${q({
    api_token: SPORTMONKS_TOKEN,
    include: 'league',
    per_page: 100,
  })}`;

  const resp = await getJson(url);
  const seasons = resp?.data || [];
  const match = seasons.find(s =>
    String(s?.league_id) === String(leagueId) &&
    String(s?.name).toLowerCase() === String(seasonName).toLowerCase()
  );

  if (!match) {
    const sample = seasons
      .filter(s => String(s?.league_id) === String(leagueId))
      .slice(0, 6)
      .map(s => `${s?.id} → ${s?.name}`)
      .join(', ');
    throw new Error(`Could not find season "${seasonName}" for league ${leagueId}. Examples: [${sample}]`);
  }
  return match.id;
}

// If you don’t pass TEAM_IDS, you could discover teams in a season.
// Depending on your plan you might need a different include/filter.
// This function is a best-effort helper.
async function discoverTeamsForSeason(seasonId, leagueId) {
  // Try stages endpoint → many setups let you traverse from season→stage→teams
  const url = `${API_BASE}/seasons/${seasonId}?${q({
    api_token: SPORTMONKS_TOKEN,
    include: 'stages.rounds.fixtures.participants',
  })}`;

  const resp = await getJson(url);
  const stages = resp?.data?.stages || [];

  const teamMap = new Map();
  for (const st of stages) {
    const rounds = st?.rounds || [];
    for (const r of rounds) {
      const fixtures = r?.fixtures || [];
      for (const f of fixtures) {
        const parts = f?.participants || [];
        for (const p of parts) {
          if (p?.participant?.id && p?.participant?.name) {
            // If a leagueId was set, we could filter by that, but participants already belong to the season.
            teamMap.set(p.participant.id, p.participant.name);
          }
        }
      }
    }
  }
  if (teamMap.size === 0) {
    throw new Error('Could not discover any teams from season traversal. Provide TEAM_IDS in .env instead.');
  }

  return Array.from(teamMap.entries()).map(([id, name]) => ({ id, name }));
}

// ───────────────────────────────────────────────────────────────────────────────
// Fetch helpers
// ───────────────────────────────────────────────────────────────────────────────
async function fetchTeamName(teamId) {
  const url = `${API_BASE}/teams/${teamId}?${q({ api_token: SPORTMONKS_TOKEN })}`;
  try {
    const js = await getJson(url);
    return js?.data?.name || `team-${teamId}`;
  } catch {
    return `team-${teamId}`;
  }
}

async function fetchSquad(teamId, seasonId) {
  const params = {
    api_token: SPORTMONKS_TOKEN,
    include: SQUAD_INCLUDES,
  };
  const filter = makeSeasonFilter(seasonId);
  if (filter) params.filters = filter;

  const url = `${API_BASE}/squads/teams/${teamId}?${q(params)}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await getJson(url);
    } catch (err) {
      const status = err?.status || 0;
      const brief = `${status} ${url}`;
      if (status === 404) {
        console.warn(`  fetch squad team=${teamId} attempt=${attempt} failed: ${brief}`);
        await dumpErrorPayload(`team-${teamId}-error`, err.payload ?? {});
        // 404 is probably final for this team/season → stop retrying
        throw err;
      } else {
        console.warn(`  fetch squad team=${teamId} attempt=${attempt} failed: ${brief}`);
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * attempt);
          continue;
        }
        await dumpErrorPayload(`team-${teamId}-error`, err.payload ?? {});
        throw err;
      }
    }
  }
}

// Normalize a single squad response into a list of player records
function normalizePlayersFromSquad(squadJson, { teamNameFallback = '', seasonId, seasonName }) {
  const rows = [];
  const items = squadJson?.data || [];

  for (const item of items) {
    // Each "item" represents a squad membership row linking player↔team
    const team = item?.team;
    const player = item?.player;

    const team_name = team?.name || teamNameFallback || '';
    const team_id   = team?.id ?? null;

    const name      = player?.display_name || player?.fullname || player?.name || '';
    const player_id = player?.id ?? null;

    const nationality = player?.nationality?.name || player?.nationality?.extra?.name || null;
    const position    = player?.position?.name || player?.position?.data?.name || null;

    // Jersey number can be found directly on membership or across nested stats
    const jersey =
      item?.jersey_number ??
      player?.number ??
      player?.statistics?.[0]?.number ??
      null;

    const image_url =
      player?.image_path ||
      player?.image ||
      null;

    // Prefer the exact season id if provided; otherwise keep the name
    const season = seasonId ? String(seasonId) : (seasonName || null);

    rows.push({
      // Core fields your app already expects
      name,
      club: team_name,
      number: jersey != null ? String(jersey) : null,
      pos: position,
      season,

      // Nice-to-have extras
      nationality,
      team_id,
      player_id,
      image_url,

      // Keep a hint of where this came from
      source: 'sportmonks_v3',
      fetched_at: new Date().toISOString(),
    });
  }

  return rows;
}

// ───────────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────────
async function main() {
  if (!SPORTMONKS_TOKEN) {
    console.error('❌ Missing SPORTMONKS_TOKEN in your local .env');
    process.exit(1);
  }

  await ensureDir(OUT_DIR);
  await ensureDir(DUMPS_DIR);

  // Resolve season id
  let seasonId = SEASON_ID ? parseInt(SEASON_ID, 10) : null;
  if (!seasonId && (LEAGUE_ID && SEASON_NAME)) {
    console.log(`Discovering season id for league=${LEAGUE_ID} name="${SEASON_NAME}"…`);
    try {
      seasonId = await discoverSeasonId(LEAGUE_ID, SEASON_NAME);
      console.log(`  ✔ Found season id = ${seasonId}`);
    } catch (err) {
      console.error(`  ✖ ${err.message}`);
      console.error('  Tip: set SEASON_ID directly in .env to skip discovery.');
      process.exit(1);
    }
  }

  // Build team list
  let teams = [];
  if (TEAM_IDS && TEAM_IDS.trim()) {
    const ids = TEAM_IDS.split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter(Boolean);

    console.log(`Using TEAM_IDS from .env (${ids.length} teams). Resolving names…`);
    teams = await Promise.all(
      ids.map(async (id) => ({ id, name: await fetchTeamName(id) }))
    );
  } else {
    if (!seasonId) {
      console.error('❌ No TEAM_IDS and no SEASON_ID. Provide TEAM_IDS in .env or set SEASON_ID (or LEAGUE_ID + SEASON_NAME).');
      process.exit(1);
    }
    console.log(`Discovering teams for season ${seasonId}…`);
    try {
      teams = await discoverTeamsForSeason(seasonId, LEAGUE_ID);
    } catch (err) {
      console.error(`  ✖ ${err.message}`);
      console.error('  Tip: set TEAM_IDS in .env to skip discovery.');
      process.exit(1);
    }
  }

  console.log(`Teams resolved: ${teams.length}`);
  logBanner('— Team list —');
  teams.forEach((t, i) => console.log(`[${i + 1}/${teams.length}] ${t.name} (id=${t.id})`));
  console.log('———————');

  // Backup existing file (if exists)
  const existing = await loadJSONMaybe(OUT_PATH);
  if (existing) {
    await fs.writeFile(BACKUP_PATH, JSON.stringify(existing, null, 2) + '\n', 'utf8');
    console.log(`Backup written to ${BACKUP_PATH}`);
  }

  // Fetch squads
  const allPlayers = [];
  const seasonNameForRows = SEASON_NAME || null;
  for (let i = 0; i < teams.length; i++) {
    const t = teams[i];
    const prefix = `[${i + 1}/${teams.length}] ${t.name} (id=${t.id}) …`;

    try {
      const js = await fetchSquad(t.id, seasonId);
      const rows = normalizePlayersFromSquad(js, {
        teamNameFallback: t.name,
        seasonId,
        seasonName: seasonNameForRows,
      });
      allPlayers.push(...rows);
      console.log(`${prefix} + ${rows.length} players`);
      // brief courtesy sleep to avoid bursty hits
      await sleep(180);
    } catch (err) {
      const status = err?.status || 0;
      console.warn(`${prefix} fetch failed: ${status} — continuing`);
      // already dumped payload in fetchSquad
    }
  }

  // Write output
  await writePrettyJSON(OUT_PATH, allPlayers);
  console.log(`Done. Wrote ${allPlayers.length} players to ${path.relative(process.cwd(), OUT_PATH)}`);
}

// ───────────────────────────────────────────────────────────────────────────────
main().catch(async (err) => {
  console.error('Uncaught error:', err?.message || err);
  try {
    await dumpErrorPayload('fatal', { message: err?.message, stack: err?.stack });
  } catch {}
  process.exit(1);
});
