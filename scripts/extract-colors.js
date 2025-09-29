#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

// This script scans teams.json, extracts a primary color from each team's logo,
// and writes a mapping to data/colors.generated.json.
// It does NOT edit teams.json directly. Use scripts/fill-colors.js --write to merge.

const ROOT = process.cwd();
const TEAMS_PATH = path.resolve(ROOT, 'teams.json');
const OUT_PATH = path.resolve(ROOT, 'data', 'colors.generated.json');

function exists(p) { try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; } }
function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

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
function isValidHex(v) { return typeof v === 'string' && /^#?[0-9a-fA-F]{6}$/.test(v.trim()); }
function toHex([r, g, b]) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return '#' + [clamp(r), clamp(g), clamp(b)].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function extractColorForLogo(logoAbsPath) {
  // node-vibrant prefers a file path or buffer. We try both if needed.
  let Vibrant;
  try {
    Vibrant = require('node-vibrant');
  } catch (e) {
    console.error('Missing dependency: node-vibrant. Install with:');
    console.error('  npm install --no-save node-vibrant@3 sharp@0.33.4');
    return '';
  }
  try {
    const v = await Vibrant.from(logoAbsPath).getPalette();
    const swatches = [
      v.Vibrant, v.Muted, v.DarkVibrant, v.LightVibrant, v.DarkMuted, v.LightMuted
    ].filter(Boolean);
    if (!swatches.length) return '';
    return toHex(swatches[0].getRgb());
  } catch {
    // Fallback: try buffer (in case of path issues)
    try {
      const buf = fs.readFileSync(logoAbsPath);
      const v = await Vibrant.from(buf).getPalette();
      const swatches = [
        v.Vibrant, v.Muted, v.DarkVibrant, v.LightVibrant, v.DarkMuted, v.LightMuted
      ].filter(Boolean);
      if (!swatches.length) return '';
      return toHex(swatches[0].getRgb());
    } catch {
      return '';
    }
  }
}

async function main() {
  if (!exists(TEAMS_PATH)) {
    console.error('teams.json not found at repo root.');
    process.exit(2);
  }
  const teams = readJSON(TEAMS_PATH);
  if (!Array.isArray(teams)) {
    console.error('teams.json must be an array.');
    process.exit(2);
  }

  const out = {};
  let extracted = 0, skipped = 0, missing = 0;

  for (const t of teams) {
    const k = key(t.league_code, t.team_name);

    // Skip if already has a valid primary_color (we only fill missing/invalid here)
    if (isValidHex(t.primary_color || '')) { skipped++; continue; }

    const rel = t.logo_url || '';
    const abs = path.resolve(ROOT, rel);
    if (!exists(abs)) { missing++; continue; }

    const hex = await extractColorForLogo(abs);
    if (hex) { out[k] = hex; extracted++; } else { missing++; }
  }

  const dir = path.dirname(OUT_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');

  console.log('Primary color extraction summary:');
  console.log(`- Extracted from logos: ${extracted}`);
  console.log(`- Already had valid color: ${skipped}`);
  console.log(`- Failed or missing logos: ${missing}`);
  console.log(`- Mapping written to: ${OUT_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });
