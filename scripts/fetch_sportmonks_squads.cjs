#!/usr/bin/env node
/**
 * Fetch Premier League squads from SportMonks and write a flat players list.
 * No fs-extra / axios — only Node built-ins (+ dotenv if installed).
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Optional: load .env if dotenv is available; otherwise do a tiny fallback
(function loadEnv() {
  try {
    require('dotenv').config();
  } catch {
    // Fallback: very small .env loader (KEY=VALUE per line)
    try {
      const p = path.resolve(process.cwd(), '.env');
      if (fs.existsSync(p)) {
        const txt = fs.readFileSync(p, 'utf8');
        for (const line of txt.split(/\r?\n/)) {
          const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
          if (m) {
            const k = m[1], v = m[2].replace(/^['"]|['"]$/g, '');
            if (!process.env[k]) process.env[k] = v;
          }
        }
      }
    } catch {}
  }
})();

const TOKEN = process.env.SPORTMONKS_TOKEN;
const SEASON_ID = process.env.SEASON_ID || '25583';
const TEAM_IDS = (process.env.TEAM_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const OUT = process.env.OUT || 'data/players.json';

if (!TOKEN) {
  console.error('❌ Missing SPORTMONKS_TOKEN in .env');
  process.exit(1);
}
if (TEAM_IDS.length === 0) {
  console.error('❌ TEAM_IDS is empty. Add comma-separated team IDs to .env');
  process.exit(1);
}

const BASE = 'https://api.sportmonks.com/v3/football';
const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function getJSON(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const slim = body && body.length > 600 ? body.slice(0,600)+'…' : body;
    throw new Error(`HTTP ${res.status} for ${url}\n${slim}`);
  }
  return res.json();
}

function normArray(x) {
  if (Array.isArray(x)) return x;
  if (x && Array.isArray(x.data)) return x.data;
  return [];
}

async function fetchSquad(teamId) {
  const url =
    `${BASE}/squads/teams/${encodeURIComponent(teamId)}`
    + `?api_token=${encodeURIComponent(TOKEN)}`
    + `&include=team;player.nationality;player.position`;
  try {
    const json = await getJSON(url);
    const rows = normArray(json);
    // some tenants return an object with team field at array[0], sometimes per row
    const teamName =
      (rows[0]?.team?.name) ||
      (json?.team?.name) ||
      `team-${teamId}`;

    const players = rows.map(row => {
      const pl = row.player || {};
      const nat = pl.nationality?.name || null;
      const pos = pl.position?.name || null;

      return {
        id: pl.id ?? null,
        name: pl.display_name || pl.name || 'Player',
        club: teamName,
        nationality: nat,
        number: row.jersey_number ?? null,
        position: pos,
        image_url: pl.image_path || null,
        season: SEASON_ID
      };
    }).filter(p => p.name);

    console.log(`✅ ${teamName} — ${players.length} players`);
    return players;
  } catch (err) {
    console.warn(`⚠️  team ${teamId} failed: ${err.message.split('\n')[0]}`);
    return [];
  }
}

async function ensureDir(p) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
}

async function main() {
  console.log(`Season: ${SEASON_ID}`);
  console.log(`Teams : ${TEAM_IDS.length}`);
  console.log('———————');

  const all = [];
  for (let i = 0; i < TEAM_IDS.length; i++) {
    const id = TEAM_IDS[i];
    console.log(`[${i+1}/${TEAM_IDS.length}] team=${id}`);
    const players = await fetchSquad(id);
    all.push(...players);
    // be nice to the API
    await delay(350);
  }

  // Deduplicate by id (fallback to name+club if id missing)
  const dedup = new Map();
  for (const p of all) {
    const key = p.id ? `id:${p.id}` : `nk:${p.name}-${p.club}`.toLowerCase();
    if (!dedup.has(key)) dedup.set(key, p);
  }

  const arr = Array.from(dedup.values());
  await ensureDir(OUT);

  // backup if exists
  if (fs.existsSync(OUT)) {
    const backup = `${OUT}.${Date.now()}.bak`;
    await fsp.copyFile(OUT, backup);
  }

  await fsp.writeFile(OUT, JSON.stringify(arr, null, 2), 'utf8');
  console.log(`\n✅ Done. Saved ${arr.length} unique players → ${OUT}`);
}

main().catch(err => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
