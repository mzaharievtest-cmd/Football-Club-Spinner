#!/usr/bin/env node
/* Fetch squads from Sportmonks and write data/players.json
 * ENV:
 *  SPORTMONKS_TOKEN=xxxx
 *  TEAM_IDS=9,14,19,...    (Sportmonks team IDs)
 *  SEASON_ID=25583         (2025/26)
 *  OUT=data/players.json
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const TOKEN = process.env.SPORTMONKS_TOKEN;
const TEAM_IDS = (process.env.TEAM_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const SEASON_ID = process.env.SEASON_ID || '25583'; // 2025/26
const OUT = process.env.OUT || path.join('data', 'players.json');

if (!TOKEN) {
  console.error('Missing SPORTMONKS_TOKEN in env');
  process.exit(1);
}
if (!TEAM_IDS.length) {
  console.error('Provide TEAM_IDS in env (comma-separated Sportmonks team IDs).');
  process.exit(1);
}

async function fetchJson(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params || {})) {
    u.searchParams.set(k, v);
  }
  const res = await fetch(u, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} for ${u.pathname} :: ${body.slice(0,200)}`);
  }
  return res.json();
}

function normPlayer(row, teamName, teamId) {
  // In this endpoint, each row is a "squad membership" with .player and .team expanded
  const p = row.player || {};
  const pos = (p.position && p.position.name) || null;
  const nationality = (p.nationality && p.nationality.name) || null;

  // Your wheel expects fields like team_name, logo_url, league_code, stadium
  // For players mode we map name->team_name, image_path->logo_url, club->team label.
  return {
    // Wheel-compatible fields:
    team_name: p.display_name || p.common_name || p.name || 'Player',
    logo_url: p.image_path || '', // usually full https URL from Sportmonks
    league_code: 'PLAYER',
    primary_color: '#163058',
    stadium: teamName || '',

    // Keep raw Player info too if you need it later:
    name: p.display_name || p.common_name || p.name || 'Player',
    image_url: p.image_path || '',
    club: teamName || '',
    club_id: teamId || null,
    position: pos,
    nationality
  };
}

async function run() {
  await fsp.mkdir(path.dirname(OUT), { recursive: true });

  console.log(`Season: ${SEASON_ID}`);
  console.log(`Teams : ${TEAM_IDS.length}`);
  console.log('———————');

  const allPlayers = [];
  for (let i = 0; i < TEAM_IDS.length; i++) {
    const id = TEAM_IDS[i];
    process.stdout.write(`[${i+1}/${TEAM_IDS.length}] team=${id}\n`);
    try {
      const data = await fetchJson(`https://api.sportmonks.com/v3/football/squads/teams/${id}`, {
        api_token: TOKEN,
        include: 'team;player;player.nationality;player.position',
        filters: `playerstatisticSeasons:${SEASON_ID}`, // affects player.statistics if included
      });

      // Docs: this endpoint returns an array of squad entries.
      // Some SDKs return {data: [...]}; raw v3 often yields an array directly.
      const rows = Array.isArray(data) ? data
                 : Array.isArray(data.data) ? data.data
                 : [];

      if (!rows.length) {
        console.warn(`  ⚠️  team ${id}: empty response or not in your project`);
        continue;
      }

      const teamName = rows[0]?.team?.name || '';
      const normalized = rows
        .filter(r => r && r.player) // keep only rows with expanded player
        .map(r => normPlayer(r, teamName, id));

      console.log(`  + ${normalized.length} players`);
      allPlayers.push(...normalized);
    } catch (err) {
      console.warn(`  ⚠️  team ${id} failed: ${err.message}`);
    }
  }

  // De-dup by (club_id, name)
  const seen = new Set();
  const unique = [];
  for (const p of allPlayers) {
    const k = `${p.club_id || ''}|${p.name || ''}`.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(p);
  }

  await fsp.writeFile(OUT, JSON.stringify(unique, null, 2));
  console.log(`\n✅ Done. Saved ${unique.length} unique players → ${OUT}`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
