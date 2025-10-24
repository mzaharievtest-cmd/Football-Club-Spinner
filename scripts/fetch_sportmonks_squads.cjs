#!/usr/bin/env node
/**
 * Fetch Premier League squads from SportMonks and write a flat players list.
 * Reads env:
 *   SPORTMONKS_TOKEN   (required)
 *   TEAM_IDS           (required, comma-separated SportMonks team IDs)
 *   OUT                (optional, default: data/players.json)
 *
 * Example:
 *   export SPORTMONKS_TOKEN="YOUR_TOKEN"
 *   export TEAM_IDS="9,14,15,18,19,20,27,29,51,52,63,71,78,236,1,3,6,8,11,13"
 *   node scripts/fetch_sportmonks_squads.cjs
 */

const fs = require('fs');
const fsp = fs.promises;

const TOKEN = process.env.SPORTMONKS_TOKEN;
const TEAM_IDS = (process.env.TEAM_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const OUT = process.env.OUT || 'data/players.json';

if (!TOKEN) throw new Error('Missing SPORTMONKS_TOKEN');
if (!TEAM_IDS.length) throw new Error('Missing TEAM_IDS');

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} for ${url}\n${body?.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchSquad(teamId) {
  const base = 'https://api.sportmonks.com/v3/football/squads/teams';
  // Includes limited to what your plan allows; these are safe for “Team squads”
  const include = 'player.nationality;player.position';
  const url = `${base}/${teamId}?api_token=${TOKEN}&include=${encodeURIComponent(include)}`;
  const json = await fetchJSON(url);
  // SportMonks returns { data: [ ... ] }
  return Array.isArray(json?.data) ? json.data : [];
}

(async () => {
  console.log(`Teams : ${TEAM_IDS.length}`);
  const rows = [];
  const seen = new Set(); // dedupe on player_id per team

  for (let i = 0; i < TEAM_IDS.length; i++) {
    const teamId = TEAM_IDS[i];
    process.stdout.write(`[${i + 1}/${TEAM_IDS.length}] team=${teamId}\n`);
    try {
      const squad = await fetchSquad(teamId);

      for (const r of squad) {
        const player = r.player || {};
        const key = `${r.team_id || teamId}:${player.id || player.player_id || player.external_id || player.name}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Normalize common fields
        const name =
          player.display_name ||
          player.common_name ||
          player.fullname ||
          player.name ||
          'Unknown Player';

        const image_url = player.image_path || null;

        // Note: jersey_number often comes from the squad “row” (r.jersey_number).
        // Fallback to player.jersey_number / player.number if not present.
        const jersey_number =
          r.jersey_number ??
          player.jersey_number ??
          player.number ??
          null;

        rows.push({
          name,
          club_id: r.team_id || Number(teamId),
          nationality: player.nationality?.name || null,
          position: player.position?.name || null,
          image_url,
          jersey_number, // ← requested field
          // Optional passthroughs you might want later:
          player_id: player.id ?? null,
          team_id: r.team_id || Number(teamId),
        });
      }
    } catch (err) {
      console.warn(`⚠️  team ${teamId} failed: ${String(err.message).split('\n')[0]}`);
    }
  }

  await fsp.mkdir('data', { recursive: true });
  await fsp.writeFile(OUT, JSON.stringify(rows, null, 2));
  console.log(`✅ Saved ${rows.length} players → ${OUT}`);
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
