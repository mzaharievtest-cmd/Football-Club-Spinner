#!/usr/bin/env node
/**
 * Fetch Premier League squads from SportMonks and export as data/players.json
 * with player name, club, nationality, position, jersey number, and image URL.
 */

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
require("dotenv").config();

const TOKEN = process.env.SPORTMONKS_TOKEN;
const SEASON_ID = process.env.SEASON_ID || "25583";
const TEAM_IDS = (process.env.TEAM_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
const OUT = process.env.OUT || "data/players.json";

if (!TOKEN) {
  console.error("❌ Missing SPORTMONKS_TOKEN in .env");
  process.exit(1);
}

const BASE = "https://api.sportmonks.com/v3/football";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchSquad(teamId) {
  const url = `${BASE}/squads/teams/${teamId}?api_token=${TOKEN}&include=team;player.nationality;player.position`;
  try {
    const res = await axios.get(url, { timeout: 15000 });
    const data = res.data.data || res.data;
    const teamName = data.team?.name || `team-${teamId}`;

    const players = (data || [])
      .map((p) => {
        const pl = p.player || {};
        return {
          id: pl.id,
          name: pl.display_name || pl.name,
          club: teamName,
          nationality: pl.nationality?.name || null,
          number: p.jersey_number || null,
          position: pl.position?.name || null,
          image_url: pl.image_path || null,
          season: SEASON_ID
        };
      })
      .filter((p) => p.name);

    console.log(`✅ ${teamName} — ${players.length} players`);
    return players;
  } catch (err) {
    const code = err.response?.status;
    console.warn(`⚠️  ${teamId} failed (${code})`);
    return [];
  }
}

async function main() {
  console.log(`Fetching squads for ${TEAM_IDS.length} teams...`);
  const all = [];

  for (let i = 0; i < TEAM_IDS.length; i++) {
    const id = TEAM_IDS[i];
    const players = await fetchSquad(id);
    all.push(...players);
    await delay(400);
  }

  // Deduplicate
  const map = new Map();
  for (const p of all) map.set(p.id || `${p.name}-${p.club}`, p);

  fs.ensureDirSync(path.dirname(OUT));
  const backup = `${OUT}.${Date.now()}.bak`;
  if (fs.existsSync(OUT)) fs.copyFileSync(OUT, backup);

  fs.writeFileSync(OUT, JSON.stringify(Array.from(map.values()), null, 2));
  console.log(`\n✅ Done. Saved ${map.size} unique players → ${OUT}`);
}

main();
