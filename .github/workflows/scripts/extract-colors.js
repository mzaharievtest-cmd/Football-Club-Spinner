#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const Vibrant = require('node-vibrant');

const ROOT = process.cwd();
const TEAMS_PATH = path.resolve(ROOT, 'teams.json');
const OUT_PATH = path.resolve(ROOT, 'data', 'colors.generated.json');

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function exists(p) { try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; } }

function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
function key(leagueCode, teamName) {
  return `${String(leagueCode || '').toUpperCase()}:${norm(teamName)}`;
}
function toHex(colorArray3) {
  // colorArray3 is [r,g,b]
  const [r, g, b] = colorArray3.map((n) => Math.max(0, Math.min(255, Math.round(n))));
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function extractLogoColor(logoPath) {
  try {
    const palette = await Vibrant.from(logoPath).getPalette();
    // Preference order: Vibrant → Muted → DarkVibrant → LightVibrant → DarkMuted → LightMuted
    const swatches = [
      palette.Vibrant,
      palette.Muted,
      palette.DarkVibrant,
      palette.LightVibrant,
      palette.DarkMuted,
      palette.LightMuted
    ].filter(Boolean);
    if (!swatches.length) return '';
    const rgb = swatches[0].getRgb();
    return toHex(rgb);
  } catch {
    return '';
  }
}

async function main() {
  if (!exists(TEAMS_PATH)) {
    console.error('teams.json not found in repo root.');
    process.exit(2);
  }
  const teams = readJSON(TEAMS_PATH);

  const out = {};
  let resolved = 0, missing = 0, skipped = 0;

  for (const t of teams) {
    const k = key(t.league_code, t.team_name);

    // Skip if we already have a valid primary_color; extraction is for missing ones
    if (typeof t.primary_color === 'string' && /^#?[0-9a-fA-F]{6}$/.test(t.primary_color.trim())) {
      skipped++;
      continue;
    }

    const logoRel = t.logo_url || '';
    const logoAbs = path.resolve(ROOT, logoRel);
    if (!exists(logoAbs)) { missing++; continue; }

    const hex = await extractLogoColor(logoAbs);
    if (hex) { out[k] = hex; resolved++; }
    else { missing++; }
  }

  const dir = path.dirname(OUT_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');

  console.log('Primary color extraction summary:');
  console.log(`- Extracted from logos: ${resolved}`);
  console.log(`- Already had valid color: ${skipped}`);
  console.log(`- Failed/missing logos:   ${missing}`);
  console.log(`- Mapping written to: ${OUT_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });
