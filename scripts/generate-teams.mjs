/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import Vibrant from "node-vibrant";

const ROOT = process.cwd();
const BASE_DIR = path.join(ROOT, "logos1", "vendor");
const OUTPUT = path.join(ROOT, "teams.json");
const MAP_FILE = path.join(ROOT, "data", "league-map.json");
const COLORS_FILE = path.join(ROOT, "data", "colors.json");     // optional overrides
const STADIUMS_FILE = path.join(ROOT, "data", "stadiums.json"); // optional overrides

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function isImage(file) {
  const ext = path.extname(file).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp"].includes(ext); // skip .svg for palette reliability
}

function nameFromFile(filename) {
  const base = filename.replace(/\.[^.]+$/, "");
  return base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function toHex(rgb) {
  if (!rgb) return "";
  const [r, g, b] = rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))));
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function extractColor(logoPath) {
  try {
    const palette = await Vibrant.from(logoPath).getPalette();
    // Prefer Vibrant, else fallback
    const sw = palette.Vibrant || palette.DarkVibrant || palette.Muted || palette.DarkMuted || palette.LightVibrant;
    return toHex(sw?.rgb);
  } catch {
    return "";
  }
}

async function main() {
  if (!fs.existsSync(BASE_DIR)) {
    console.error(`Missing directory: ${BASE_DIR}`);
    process.exit(1);
  }
  const leagueMap = readJson(MAP_FILE, []);
  if (!Array.isArray(leagueMap) || leagueMap.length === 0) {
    console.error(`Missing or empty league map: ${MAP_FILE}`);
    process.exit(1);
  }

  const colorOverrides = readJson(COLORS_FILE, {});      // { "Team Name": "#RRGGBB" }
  const stadiumOverrides = readJson(STADIUMS_FILE, {});  // { "Team Name": "Stadium" }

  const results = [];

  for (const { folder, league_code } of leagueMap) {
    const leaguePath = path.join(BASE_DIR, folder);
    if (!fs.existsSync(leaguePath) || !fs.statSync(leaguePath).isDirectory()) {
      console.warn(`Skipping missing league folder: ${leaguePath}`);
      continue;
    }

    const files = fs.readdirSync(leaguePath).filter(isImage);
    for (const file of files) {
      const team_name = nameFromFile(file);
      const logo_abs = path.join(leaguePath, file);
      const logo_url = path.join("logos1", "vendor", folder, file).split(path.sep).join("/");

      const primary_color =
        colorOverrides[team_name] ||
        await extractColor(logo_abs) ||
        "";

      const stadium = stadiumOverrides[team_name] || "";

      results.push({
        league_code,
        team_name,
        primary_color,
        logo_url,
        stadium
      });
    }
  }

  // Sort stably: by league_code then team_name
  results.sort((a, b) =>
    a.league_code === b.league_code
      ? a.team_name.localeCompare(b.team_name, "en")
      : a.league_code.localeCompare(b.league_code)
  );

  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2) + "\n");
  console.log(`Generated ${results.length} teams to ${path.relative(ROOT, OUTPUT)}`);
}

main();
