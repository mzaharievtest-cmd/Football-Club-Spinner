#!/usr/bin/env node
/**
 * add_player_images.js (fuzzy filename matcher)
 *
 * Usage:
 *   node scripts/add_player_images.js
 *
 * Behavior:
 * - Finds data/players.json by searching upward from the script or current working directory.
 * - Scans public/players filenames (keeps original names with spaces/prefixes).
 * - Normalizes filenames and player names (strip leading digits, remove parentheses & punctuation, strip diacritics).
 * - Tries multiple heuristics to match a player to a filename:
 *     1) normalized full name substring in normalized filename
 *     2) normalized last name substring
 *     3) normalized "first last" substring
 *     4) club token match in filename
 * - If matched, sets image_url to '/players/<original-filename>'
 * - If no match, sets image_url to FALLBACK_SILHOUETTE ('/players/silhouette-player.png')
 * - Backs up data/players.json -> data/players.json.bak
 * - Writes pretty-printed JSON
 *
 * NOTE: This script is permissive; inspect data/players.json.bak if you need to revert.
 */

const fs = require('fs');
const path = require('path');

function findUp(startDir, relativePath) {
  let dir = path.resolve(startDir || process.cwd());
  const root = path.parse(dir).root;
  while (true) {
    const candidate = path.join(dir, relativePath);
    if (fs.existsSync(candidate)) return candidate;
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return null;
}

function normalizeText(s) {
  if (!s) return '';
  // Normalize Unicode, remove diacritics, toLowerCase
  let t = String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  // Remove leading digits and punctuation commonly used in your filenames: "1 ", "14-06-03-"
  t = t.replace(/^[\d\W_]+/, '');
  // Remove parentheses and contents, keep the rest
  t = t.replace(/\(.*?\)/g, ' ');
  // Replace non-alphanum with single space
  t = t.replace(/[^a-z0-9]+/gi, ' ');
  // Trim and collapse spaces
  t = t.trim().replace(/\s+/g, ' ').toLowerCase();
  return t;
}

const FALLBACK_SILHOUETTE = '/players/silhouette-player.png';

// Optional per-name overrides (lowercase key -> public path)
const PLAYER_IMAGE_MAP = {
  'bukayo saka': '/players/saka.png',
  // add exceptions here if needed
};

const SCRIPT_DIR = __dirname;
const ARG_PATH = process.argv[2];

const CANDIDATE_REL = path.join('data', 'players.json');

let DATA_PLAYERS = null;
if (ARG_PATH) {
  DATA_PLAYERS = path.resolve(ARG_PATH);
  if (!fs.existsSync(DATA_PLAYERS)) {
    console.error('Explicit path provided but file not found:', DATA_PLAYERS);
    process.exit(1);
  }
} else {
  DATA_PLAYERS = findUp(SCRIPT_DIR, CANDIDATE_REL) || findUp(process.cwd(), CANDIDATE_REL);
  if (!DATA_PLAYERS) {
    console.error('data/players.json not found. Run from repo root or provide explicit path:');
    console.error('  node scripts/add_player_images.js data/players.json');
    process.exit(1);
  }
}

const BACKUP_PLAYERS = DATA_PLAYERS + '.bak';
const repoRoot = path.dirname(path.dirname(DATA_PLAYERS));
const PUBLIC_PLAYERS_DIR = path.join(repoRoot, 'public', 'players');
const PUBLIC_ROOT = path.join(repoRoot, 'public');

console.log('Using data file:', DATA_PLAYERS);
console.log('Repo root:', repoRoot);
console.log('Looking for images in:', PUBLIC_PLAYERS_DIR, 'and', PUBLIC_ROOT);

function listFiles(dir) {
  try {
    return fs.readdirSync(dir).filter(f => !f.startsWith('.'));
  } catch (e) {
    return [];
  }
}

function buildFilenameIndex() {
  const index = [];
  // scan public/players first
  const playerFiles = listFiles(PUBLIC_PLAYERS_DIR);
  playerFiles.forEach(fname => {
    index.push({ src: `/players/${fname}`, file: fname, norm: normalizeText(fname) });
  });
  // also include public root images (avoid duplicates)
  const rootFiles = listFiles(PUBLIC_ROOT);
  rootFiles.forEach(fname => {
    if (playerFiles.includes(fname)) return;
    index.push({ src: `/${fname}`, file: fname, norm: normalizeText(fname) });
  });
  return index;
}

function bestMatchForPlayer(player, index) {
  const name = (player.name || player.player_name || player.full_name || player.team_name || '').trim();
  if (!name) return null;
  const club = (player.club || player.team || '').toString().trim();
  const nameKey = name.toLowerCase();
  if (PLAYER_IMAGE_MAP[nameKey]) return PLAYER_IMAGE_MAP[nameKey];

  const normName = normalizeText(name);        // e.g. "david raya"
  const tokens = normName.split(/\s+/).filter(Boolean); // ["david","raya"]
  const lastName = tokens.length ? tokens[tokens.length - 1] : '';
  const firstLast = tokens.length >= 2 ? `${tokens[0]} ${tokens[tokens.length-1]}` : normName;
  const normClub = normalizeText(club);

  // Priority matches
  // 1) normalized full name substring
  for (const f of index) {
    if (f.norm.includes(normName)) return f.src;
  }
  // 2) last name substring
  if (lastName) {
    for (const f of index) {
      if (f.norm.includes(lastName)) return f.src;
    }
  }
  // 3) first+last token match
  for (const f of index) {
    if (f.norm.includes(firstLast)) return f.src;
  }
  // 4) all tokens present (any order)
  for (const f of index) {
    let all = true;
    for (const t of tokens) {
      if (!t) continue;
      if (!f.norm.includes(t)) { all = false; break; }
    }
    if (all && tokens.length) return f.src;
  }
  // 5) club matching
  if (normClub) {
    for (const f of index) {
      if (f.norm.includes(normClub)) return f.src;
    }
  }

  // No match
  return null;
}

function main() {
  let raw;
  try {
    raw = fs.readFileSync(DATA_PLAYERS, 'utf8');
  } catch (e) {
    console.error('Failed to read data file:', DATA_PLAYERS, e.message);
    process.exit(1);
  }

  let players;
  try {
    players = JSON.parse(raw);
    if (!Array.isArray(players)) throw new Error('expected JSON array of players');
  } catch (e) {
    console.error('Failed to parse JSON:', e.message);
    process.exit(1);
  }

  // backup
  fs.writeFileSync(BACKUP_PLAYERS, raw, 'utf8');
  console.log('Backup saved to', BACKUP_PLAYERS);

  const index = buildFilenameIndex();
  console.log('Candidate files scanned:', index.length);

  let updatedCount = 0;
  const updated = players.map(p => {
    const match = bestMatchForPlayer(p, index);
    const image_url = match || FALLBACK_SILHOUETTE;
    if (p.image_url !== image_url) updatedCount++;
    return Object.assign({}, p, { image_url });
  });

  fs.writeFileSync(DATA_PLAYERS, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  console.log(`Updated ${updatedCount} entries in ${DATA_PLAYERS}`);
  console.log('Example outputs:');
  console.log(updated.slice(0,8).map(x => ({ name: x.name || x.player_name || x.team_name, image_url: x.image_url })));
}

main();
