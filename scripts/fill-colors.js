#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TEAMS_PATH = path.resolve(ROOT, 'teams.json');

// Merge in this order (later overrides earlier):
// 1) data/colors.json           — manual curated values
// 2) data/colors-extra.json     — optional overrides
// 3) data/colors.generated.json — extracted this run
const MAP_FILES = [
  path.resolve(ROOT, 'data', 'colors.json'),
  path.resolve(ROOT, 'data', 'colors-extra.json'),
  path.resolve(ROOT, 'data', 'colors.generated.json')
];

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
function toSharpHex(v) {
  const s = v.trim().replace('#', '');
  return ('#' + s).toUpperCase();
}

function loadMap() {
  const merged = {};
  for (const f of MAP_FILES) {
    if (!exists(f)) continue;
    const data = readJSON(f);
    for (const [k, v] of Object.entries(data || {})) {
      if (isValidHex(v)) merged[k] = toSharpHex(v);
    }
  }
  return merged;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const write = args.has('--write');
  const check = args.has('--check');
  const failOnMissing = args.has('--fail-on-missing');
  const force = args.has('--force'); // overwrite even if a valid primary_color exists

  if (!exists(TEAMS_PATH)) {
    console.error(`ERROR: ${TEAMS_PATH} not found in repo root.`);
    process.exit(2);
  }

  const teams = readJSON(TEAMS_PATH);
  if (!Array.isArray(teams)) {
    console.error('ERROR: teams.json must be an array.');
    process.exit(2);
  }

  const map = loadMap();
  let already = 0, filled = 0, missing = 0, overwritten = 0;

  for (const t of teams) {
    const k = key(t.league_code, t.team_name);
    const target = map[k];

    if (force) {
      if (target) {
        if (isValidHex(t.primary_color || '')) overwritten++;
        t.primary_color = target;
        filled++;
      } else {
        if (!isValidHex(t.primary_color || '')) missing++;
        else already++;
      }
      continue;
    }

    // Only fill if missing or invalid
    if (!isValidHex(t.primary_color || '')) {
      if (target) { t.primary_color = target; filled++; }
      else { missing++; }
    } else {
      already++;
    }
  }

  if (write) {
    fs.writeFileSync(TEAMS_PATH, JSON.stringify(teams, null, 2) + '\n', 'utf8');
  }

  console.log('Primary color fill summary:');
  console.log(`- Already valid:   ${already}`);
  console.log(`- Newly filled:    ${filled}`);
  if (overwritten) console.log(`- Overwritten (via --force): ${overwritten}`);
  console.log(`- Still missing:   ${missing}`);
  console.log(`- Mode: ${write ? 'write' : (check ? 'check' : 'dry-run')}`);
  if (force) console.log('- Force overwrite: ON');

  if (check && failOnMissing && missing > 0) {
    console.error(`ERROR: ${missing} teams still missing primary colors.`);
    process.exit(1);
  }
}

main();
