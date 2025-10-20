/**
 * add_player_images.js (robust, accepts optional path)
 *
 * Usage:
 *   node scripts/add_player_images.js
 *   node scripts/add_player_images.js data/players.json
 *
 * - Searches upward for data/players.json if no explicit path provided.
 * - Scans public/players and public/ for images and slug-matches them to player names.
 * - Adds/updates image_url for each player and writes a backup data/players.json.bak.
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

function slugifyName(n) {
  return String(n || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}
function resolvePublicUrl(p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('/')) return p;
  return '/' + p;
}

const FALLBACK_SILHOUETTE = '/players/silhouette-player.png';
const PLAYER_IMAGE_MAP = {
  'bukayo saka': '/players/saka.png'
};

const argPath = process.argv[2];

const SCRIPT_DIR = __dirname;
const CANDIDATE_REL = path.join('data', 'players.json');

let DATA_PLAYERS = null;
if (argPath) {
  DATA_PLAYERS = path.resolve(argPath);
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
const repoRoot = path.dirname(path.dirname(DATA_PLAYERS)); // .../data -> repo root
const PUBLIC_PLAYERS_DIR = path.join(repoRoot, 'public', 'players');
const PUBLIC_ROOT = path.join(repoRoot, 'public');

console.log('Using data file:', DATA_PLAYERS);
console.log('Repo root:', repoRoot);
console.log('Looking for images in:', PUBLIC_PLAYERS_DIR, 'and', PUBLIC_ROOT);

function listImageFiles(dir) {
  try {
    return fs.readdirSync(dir).filter(f => /\.(png|jpe?g|webp|gif|avif)$/i.test(f));
  } catch (e) {
    return [];
  }
}

function buildCandidatesMap() {
  const map = new Map();
  const playersFiles = listImageFiles(PUBLIC_PLAYERS_DIR);
  playersFiles.forEach(f => map.set(path.parse(f).name.toLowerCase(), '/players/' + f));
  const rootFiles = listImageFiles(PUBLIC_ROOT);
  rootFiles.forEach(f => {
    const key = path.parse(f).name.toLowerCase();
    if (!map.has(key)) map.set(key, '/' + f);
  });
  return map;
}

function pickImageForPlayer(player, candidatesMap) {
  const name = (player.name || player.player_name || player.full_name || player.team_name || '').trim();
  if (!name) return FALLBACK_SILHOUETTE;
  const key = name.toLowerCase();
  if (PLAYER_IMAGE_MAP[key]) return resolvePublicUrl(PLAYER_IMAGE_MAP[key]);
  const slug = slugifyName(name);
  if (candidatesMap.has(slug)) return resolvePublicUrl(candidatesMap.get(slug));
  const alt = [
    `/players/${slug}.png`,
    `/players/${slug}.jpg`,
    `/players/${slug}.webp`,
    `/${slug}.png`,
    `/${slug}.jpg`,
    `/${slug}.webp`
  ];
  for (const c of alt) {
    const fsPath = path.join(repoRoot, 'public', c.replace(/^\//, ''));
    if (fs.existsSync(fsPath)) return resolvePublicUrl(c);
  }
  if (player.image_url) return resolvePublicUrl(player.image_url);
  if (player.image) return resolvePublicUrl(player.image);
  if (player.file_url) return resolvePublicUrl(player.file_url);
  if (player.file) return resolvePublicUrl(player.file);
  return FALLBACK_SILHOUETTE;
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

  const candidatesMap = buildCandidatesMap();
  console.log('Found candidate image count:', candidatesMap.size);

  let updatedCount = 0;
  const updated = players.map(p => {
    const img = pickImageForPlayer(p, candidatesMap);
    if (p.image_url !== img) updatedCount++;
    return Object.assign({}, p, { image_url: img });
  });

  fs.writeFileSync(DATA_PLAYERS, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  console.log(`Updated ${updatedCount} entries in ${DATA_PLAYERS}`);
  console.log('Example outputs:');
  console.log(updated.slice(0,6).map(x => ({ name: x.name || x.player_name || x.team_name, image_url: x.image_url })));
}

main();
