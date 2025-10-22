// scripts/fetch_players_apifootball_free.js
import fetch from "node-fetch";
import fs from "fs/promises";

const KEY    = process.env.APIFOOTBALL_KEY;
const LEAGUE = process.env.LEAGUE_ID || 39;      // Premier League
const SEASON = process.env.SEASON   || 2023;     // Free-plan friendly
const OUT    = process.env.OUT      || "data/players.json";
if (!KEY) throw new Error("Missing APIFOOTBALL_KEY in env");

const BASE = "https://v3.football.api-sports.io";
const H = { "x-apisports-key": KEY };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, { headers: H });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path} :: ${text}`);
  return JSON.parse(text);
}

async function listTeams() {
  const data = await get(`/teams?league=${LEAGUE}&season=${SEASON}`);
  return data.response.map(r => r.team.id);
}

async function getPlayersForTeam(teamId) {
  // /players is paginated. Use per-page=50 and loop.
  const players = [];
  for (let page = 1; page < 50; page++) {
    const data = await get(`/players?team=${teamId}&season=${SEASON}&page=${page}`);
    const chunk = (data.response || []).map(p => ({
      name: p.player?.name,
      age: p.player?.age,
      nationality: p.player?.nationality,
      height: p.player?.height,
      weight: p.player?.weight,
      photo: p.player?.photo,    // <- image URL you want
      team_id: teamId,
      season: SEASON,
      position: p.statistics?.[0]?.games?.position || null,
      number: p.statistics?.[0]?.games?.number || null,
      club: p.statistics?.[0]?.team?.name || null
    }));
    players.push(...chunk);
    if ((data.response || []).length === 0) break;
    await sleep(300); // keep it polite for free tier
  }
  return players;
}

(async () => {
  console.log(`Season: ${SEASON}`);
  let teams = [];
  try {
    teams = await listTeams();
  } catch (e) {
    // If teams blocked for the chosen season, suggest switching seasons
    console.error("Could not list teams for this season on the free plan.");
    console.error("Tip: set SEASON=2023 in your .env");
    throw e;
  }

  const all = [];
  for (let i = 0; i < teams.length; i++) {
    const id = teams[i];
    process.stdout.write(`[${i + 1}/${teams.length}] team=${id} … `);
    try {
      const players = await getPlayersForTeam(id);
      console.log(`+${players.length}`);
      all.push(...players);
    } catch (e) {
      console.log("fail");
      console.error(e.message);
    }
    await sleep(300);
  }

  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(all, null, 2));
  console.log(`Done. Wrote ${all.length} players to ${OUT}`);
})();
