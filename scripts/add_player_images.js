/**
 * Add image_url fields to data/players.json using images found in public/players.
 *
 * Usage:
 *   node add_player_images.js
 *
 * Behavior:
 * - Looks for images in ./public/players (PNG/JPG/JPEG/WebP), and also accepts top-level /public files.
 * - Slugifies player names and attempts to match files like '<slug>.png' or '<slug>.jpg'.
 * - Honors PLAYER_IMAGE_MAP for special case name -> filename mappings (you can extend it).
 * - If no match is found, sets image_url to FALLBACK_SILHOUETTE.
 * - Backups original data/players.json to data/players.json.bak before writing.
 */

const fs = require('fs');
const path = require('path');

const DATA_PLAYERS = path.join(__dirname, 'data', 'players.json');
const BACKUP_PLAYERS = path.join(__dirname, 'data', 'players.json.bak');
const PUBLIC_PLAYERS_DIR = path.join(__dirname, 'public', 'players');
const PUBLIC_ROOT = path.join(__dirname, 'public');

const FALLBACK_SILHOUETTE = '/players/silhouette-player.png';

// Special-case map: lowercased player name -> public path (relative to site root)
const PLAYER_IMAGE_MAP = {
  'bukayo saka': '/players/saka.png',
  // add more special mappings here, e.g.
  // 'kai havertz': '/players/havertz.png'
};

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

function listImageFiles(dir) {
  try {
    const files = fs.readdirSync(dir);
    return files.filter(f => /\.(png|jpe?g|webp|gif|avif)$/i.test(f));
  } catch (e) {
    return [];
  }
}

function buildCandidatesMap() {
  const map = new Map(); // slug -> filename (first match)
  // scan public/players
  const playersFiles = listImageFiles(PUBLIC_PLAYERS_DIR);
  playersFiles.forEach(f => {
    const name = path.parse(f).name;
    map.set(name.toLowerCase(), '/players/' + f);
  });

  // also scan public root (some setups keep images directly under /public)
  const rootFiles = listImageFiles(PUBLIC_ROOT);
  rootFiles.forEach(f => {
    const name = path.parse(f).name;
    // avoid clobbering players/ prefixed entries if already present
    if (!map.has(name.toLowerCase())) map.set(name.toLowerCase(), '/' + f);
  });

  return map;
}

function pickImageForPlayer(player, candidatesMap) {
  const name = (player.name || player.player_name || player.full_name || player.team_name || '').trim();
  if (!name) return FALLBACK_SILHOUETTE;

  const key = name.toLowerCase();
  if (PLAYER_IMAGE_MAP[key]) return resolvePublicUrl(PLAYER_IMAGE_MAP[key]);

  const slug = slugifyName(name);
  // common candidate paths
  const tried = [];

  // first try exact slug match in candidates map
  if (candidatesMap.has(slug)) return resolvePublicUrl(candidatesMap.get(slug));

  // try slug + variants
  const altCandidates = [
    `/players/${slug}.png`,
    `/players/${slug}.jpg`,
    `/${slug}.png`,
    `/${slug}.jpg`,
    `/players/${slug}.webp`,
    `/${slug}.webp`
  ];
  for (const c of altCandidates) {
    const fsPath = path.join(__dirname, c.replace(/^\//, 'public/'));
    tried.push(fsPath);
    if (fs.existsSync(fsPath)) return resolvePublicUrl(c);
  }

  // last resort: if player has an explicit image field in JSON, use it
  if (player.image_url) return resolvePublicUrl(player.image_url);
  if (player.image) return resolvePublicUrl(player.image);
  if (player.file_url) return resolvePublicUrl(player.file_url);
  if (player.file) return resolvePublicUrl(player.file);

  // fallback
  return FALLBACK_SILHOUETTE;
}

function main() {
  if (!fs.existsSync(DATA_PLAYERS)) {
    console.error('data/players.json not found. Please ensure file exists.');
    process.exit(1);
  }

  // read players JSON
  const raw = fs.readFileSync(DATA_PLAYERS, 'utf8');
  let players;
  try {
    players = JSON.parse(raw);
    if (!Array.isArray(players)) throw new Error('players.json is not an array');
  } catch (e) {
    console.error('Failed to parse data/players.json:', e.message);
    process.exit(1);
  }

  // backup
  fs.writeFileSync(BACKUP_PLAYERS, raw, 'utf8');
  console.log('Backup written to', BACKUP_PLAYERS);

  const candidatesMap = buildCandidatesMap();

  // update each player
  let updatedCount = 0;
  const updated = players.map(p => {
    const img = pickImageForPlayer(p, candidatesMap);
    if (p.image_url !== img) updatedCount++;
    return Object.assign({}, p, { image_url: img });
  });

  // write back (pretty)
  fs.writeFileSync(DATA_PLAYERS, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  console.log(`Updated ${updatedCount} entries in data/players.json (image_url field set).`);
  console.log('Sample entries:');
  console.log(updated.slice(0,6).map(x => ({ name: x.name || x.player_name || x.team_name, image_url: x.image_url })));
}

main();
