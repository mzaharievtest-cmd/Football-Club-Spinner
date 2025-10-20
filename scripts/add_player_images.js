#!/usr/bin/env node
/**
 * scripts/add_player_images.js
 *
 * Adds image_path/image_url to players in players.json by matching files in an images folder.
 *
 * Usage examples (run from project root):
 *   node scripts/add_player_images.js
 *   node scripts/add_player_images.js --dry-run
 *   node scripts/add_player_images.js --players data/players.json --images public/players
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

// ---------- CLI args ----------
const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const DRY = args.includes("--dry-run");
const CLI_PLAYERS = getArg("--players");
const CLI_IMAGES = getArg("--images");

// ---------- Path discovery ----------
const CWD = process.cwd();
const HERE = __dirname;

// Try a list of candidates for players.json and images dir
const playerJsonCandidates = [
  CLI_PLAYERS, // explicit
  path.join(CWD, "data", "players.json"),
  path.join(CWD, "players.json"),
  path.join(HERE, "..", "data", "players.json"),
  path.join(HERE, "data", "players.json"),
].filter(Boolean);

const imagesDirCandidates = [
  CLI_IMAGES, // explicit
  path.join(CWD, "public", "players"),
  path.join(CWD, "players"),
  path.join(HERE, "..", "public", "players"),
  path.join(HERE, "public", "players"),
].filter(Boolean);

function pickExisting(paths, isDir = false) {
  for (const p of paths) {
    try {
      const st = fs.statSync(p);
      if ((isDir && st.isDirectory()) || (!isDir && st.isFile())) return p;
    } catch {}
  }
  return null;
}

const PLAYERS_JSON = pickExisting(playerJsonCandidates, false);
const IMG_DIR = pickExisting(imagesDirCandidates, true);

if (!PLAYERS_JSON) {
  console.error("data/players.json not found. Please ensure file exists.");
  console.error("Looked in:");
  playerJsonCandidates.forEach((p) => console.error("  -", p));
  process.exit(1);
}
if (!IMG_DIR) {
  console.error("Images folder not found. Please ensure public/players (or use --images) exists.");
  console.error("Looked in:");
  imagesDirCandidates.forEach((p) => console.error("  -", p));
  process.exit(1);
}

console.log("Players JSON:", path.relative(CWD, PLAYERS_JSON));
console.log("Images dir  :", path.relative(CWD, IMG_DIR));
if (DRY) console.log("(dry-run) — no files will be written.");

const exts = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"]);

// ---------- Helpers ----------
function normalize(s = "") {
  return String(s)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const tokenize = (s) => normalize(s).split(" ").filter(Boolean);
const slugContains = (a, b) =>
  (" " + normalize(a) + " ").includes(" " + normalize(b) + " ");
const tokenOverlap = (a, b) => {
  const setB = new Set(b);
  let c = 0;
  for (const t of a) if (setB.has(t)) c++;
  return c;
};
function scoreMatch({ fileBase, fileTokens, fileName, playerName, playerTokens, club }) {
  let score = 0;
  if (slugContains(fileBase, playerName) || slugContains(playerName, fileBase)) score += 60;
  score += 6 * tokenOverlap(playerTokens, fileTokens);
  if (club) {
    const clubNorm = normalize(club);
    if (slugContains(fileBase, clubNorm)) score += 18;
    else score += 2 * tokenOverlap(tokenize(clubNorm), fileTokens);
  }
  score += Math.max(0, 12 - Math.abs(fileTokens.length - fileTokens.length));
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg") score += 2;
  return score;
}

// ---------- Main ----------
(async function main() {
  // Load players
  let players;
  try {
    players = JSON.parse(await fsp.readFile(PLAYERS_JSON, "utf8"));
  } catch (e) {
    console.error("Invalid JSON:", PLAYERS_JSON);
    console.error(e.message);
    process.exit(1);
  }
  if (!Array.isArray(players)) {
    console.error("players.json must be an array.");
    process.exit(1);
  }

  // Scan images
  const allFiles = (await fsp.readdir(IMG_DIR)).filter((f) =>
    exts.has(path.extname(f).toLowerCase())
  );
  if (!allFiles.length) {
    console.error("No image files in", IMG_DIR);
    process.exit(1);
  }
  const fileMeta = allFiles.map((fileName) => {
    const base = path.basename(fileName, path.extname(fileName));
    return { fileName, fileBase: normalize(base), fileTokens: tokenize(base) };
    // Example: "Kai Havertz 2025.jpg" -> fileBase "kai havertz 2025"
  });

  // Match & update
  let matched = 0;
  const unmatched = [];
  for (const p of players) {
    // skip already mapped
    if (p.image_url || p.image_path) continue;

    const name = p.name || p.player_name || p.full_name || "";
    const club = p.club || p.team || p.current_team || "";
    const playerTokens = tokenize(name);

    let best = null;
    for (const fm of fileMeta) {
      const s = scoreMatch({
        fileBase: fm.fileBase,
        fileTokens: fm.fileTokens,
        fileName: fm.fileName,
        playerName: name,
        playerTokens,
        club,
      });
      if (!best || s > best.score) best = { ...fm, score: s };
    }

    if (!best || best.score < 20) {
      unmatched.push({ name, club });
      continue;
    }

    // public/players -> served at /players/...
    const url = "/players/" + best.fileName;
    p.image_path = url;
    p.image_url = url;
    matched++;
  }

  console.log(`\nScanned images : ${allFiles.length}`);
  console.log(`Total players  : ${players.length}`);
  console.log(`Matched        : ${matched}`);
  if (unmatched.length) {
    console.log(`Unmatched (${unmatched.length}):`);
    for (const u of unmatched.slice(0, 50)) {
      console.log(`  - ${u.name}${u.club ? ` (${u.club})` : ""}`);
    }
    if (unmatched.length > 50) {
      console.log(`  …and ${unmatched.length - 50} more`);
    }
  }

  if (DRY) return;

  // Backup then write
  const backup = PLAYERS_JSON.replace(/\.json$/i, ".backup.json");
  if (!fs.existsSync(backup)) {
    await fsp.copyFile(PLAYERS_JSON, backup);
    console.log(`Backup created : ${path.relative(CWD, backup)}`);
  } else {
    console.log(`Backup exists  : ${path.relative(CWD, backup)}`);
  }

  await fsp.writeFile(PLAYERS_JSON, JSON.stringify(players, null, 2) + "\n", "utf8");
  console.log(`Updated file   : ${path.relative(CWD, PLAYERS_JSON)}\n`);
})().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
