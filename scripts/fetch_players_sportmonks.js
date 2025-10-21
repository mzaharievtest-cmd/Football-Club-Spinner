#!/usr/bin/env node
/**
 * Fetch EPL players from Sportmonks (v3) squads endpoint and write data/players.json
 *
 * Env:
 *  - SPORTMONKS_TOKEN (required)
 *  - SEASON_ID       (required) -> used in filters=playerstatisticSeasons:{SEASON_ID}
 *  - TEAM_IDS        (required) -> comma-separated Sportmonks team IDs
 *  - OUT_FILE        (optional) -> default: ./data/players.json
 *
 * Usage:
 *  node scripts/fetch_players_sportmonks.js
 *
 * Notes:
 *  - We normalize each player into your app's shape:
 *      { name, club, number, pos, season, image_url, league_code }
 *  - league_code is set to 'EPL' for your wheel filters.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const TOKEN     = process.env.SPORTMONKS_TOKEN;
const SEASON_ID = process.env.SEASON_ID;
const TEAM_IDS  = (process.env.TEAM_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const OUT_FILE  = process.env.OUT_FILE || path.resolve(__dirname, '..', 'data', 'players.json');

if (!TOKEN)    exit('Missing SPORTMONKS_TOKEN in .env');
if (!SEASON_ID) exit('Missing SEASON_ID in .env');
if (!TEAM_IDS.length) exit('Missing TEAM_IDS in .env (comma-separated IDs)');

const BASE = 'https://api.sportmonks.com/v3/football';
const INCLUDE = 'team;player.nationality;player.statistics.details.type;player.position';
const LEAGUE_CODE = 'EPL'; // matches your wheel’s league filter

(async function main() {
  ensureDir(path.dirname(OUT_FILE));
  const players = [];
  const seen = new Set();

  console.log(`Season ID : ${SEASON_ID}`);
  console.log(`Teams     : ${TEAM_IDS.join(', ')}`);
  console.log(`Output    : ${OUT_FILE}`);
  console.log('--------------------------------');

  let idx = 0;
  for (const tid of TEAM_IDS) {
    idx++;
    const url = `${BASE}/squads/teams/${encodeURIComponent(tid)}?include=${encodeURIComponent(INCLUDE)}&filters=${encodeURIComponent('playerstatisticSeasons:' + SEASON_ID)}&api_token=${encodeURIComponent(TOKEN)}`;

    process.stdout.write(`[${idx}/${TEAM_IDS.length}] Team ${tid} … `);
    const json = await fetchJson(url);

    const data = Array.isArray(json?.data) ? json.data : [];
    if (!data.length) {
      console.log('0 players');
      continue;
    }

    // Team name (same for the whole array)
    const teamName = data[0]?.team?.name || '—';

    let added = 0;
    for (const row of data) {
      const p = row?.player || {};
      const pid = p.id ?? row.player_id;

      if (!pid || seen.has(pid)) continue;
      seen.add(pid);

      const name = p.display_name || [p.firstname, p.lastname].filter(Boolean).join(' ') || p.common_name || p.name || 'Player';
      const image_url = p.image_path || '';             // Sportmonks provides CDN image
      const number = row.jersey_number ?? p.number ?? null;

      // Position: Sportmonks hierarchy -> detailed_position -> position -> name
      const pos =
        row?.detailed_position?.name ||
        p?.detailed_position?.name ||
        row?.position?.name ||
        p?.position?.name ||
        null;

      players.push({
        name,
        club: teamName,
        number: number != null ? String(number) : null,
        pos,
        season: String(SEASON_ID), // keep as string; your UI can display "2025/26" elsewhere
        image_url,
        primary_color: '#163058',  // optional fallback for player wedges
        league_code: LEAGUE_CODE
      });
      added++;
    }

    console.log(`+ ${added} players (${teamName})`);
    await sleep(200); // small courtesy delay
  }

  // Sort by club, then name
  players.sort((a, b) => (a.club || '').localeCompare(b.club || '') || (a.name || '').localeCompare(b.name || ''));

  // Backup (if exists)
  if (fs.existsSync(OUT_FILE)) {
    const backup = OUT_FILE.replace(/\.json$/i, `.backup.${Date.now()}.json`);
    fs.copyFileSync(OUT_FILE, backup);
    console.log(`Backup created: ${rel(backup)}`);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(players, null, 2), 'utf8');
  console.log(`Done. Wrote ${players.length} players to ${rel(OUT_FILE)}`);
})().catch(err => {
  console.error('\nFatal:', err?.responseJSON || err?.message || err);
  process.exit(1);
});

// ───────── helpers ─────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function rel(p) {
  return path.relative(process.cwd(), p);
}
async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} for ${url}\n${text}`);
  }
  return res.json();
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function exit(msg) { console.error(msg); process.exit(1); }
