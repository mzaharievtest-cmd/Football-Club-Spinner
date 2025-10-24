#!/usr/bin/env node
const fs = require('fs');
const fsp = fs.promises;

const TOKEN = process.env.SPORTMONKS_TOKEN;
const TEAM_IDS = (process.env.TEAM_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const OUT = process.env.OUT || 'data/players.json';

if (!TOKEN) throw new Error('Missing SPORTMONKS_TOKEN');
if (!TEAM_IDS.length) throw new Error('Missing TEAM_IDS');

async function fetchSquad(teamId) {
  const url = `https://api.sportmonks.com/v3/football/squads/teams/${teamId}?api_token=${TOKEN}&include=player.nationality;player.position`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

(async () => {
  console.log(`Fetching squads for ${TEAM_IDS.length} teams...`);
  const allPlayers = [];
  for (const id of TEAM_IDS) {
    try {
      console.log(`→ Team ${id}`);
      const data = await fetchSquad(id);
      const rows = Array.isArray(data.data) ? data.data : data;
      for (const r of rows) {
        const p = r.player || {};
        allPlayers.push({
          name: p.display_name || p.common_name || p.name,
          club_id: id,
          nationality: p.nationality?.name || null,
          position: p.position?.name || null,
          image_url: p.image_path || null,
        });
      }
    } catch (e) {
      console.warn(`⚠️  Team ${id} failed: ${e.message}`);
    }
  }
  await fsp.mkdir('data', { recursive: true });
  await fsp.writeFile(OUT, JSON.stringify(allPlayers, null, 2));
  console.log(`✅ Saved ${allPlayers.length} players → ${OUT}`);
})();
