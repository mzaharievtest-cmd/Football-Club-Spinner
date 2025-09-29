#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TEAMS_PATH = path.resolve(ROOT, 'teams.json');

const MAP_FILES = [
  path.resolve(ROOT, 'data', 'stadiums.json'),
  path.resolve(ROOT, 'data', 'stadiums-extra.json') // optional
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
function isEmpty(val) {
  const s = String(val ?? '').trim();
  return s === '' || s === '-' || s === '—';
}

function loadMap() {
  const merged = {};
  for (const f of MAP_FILES) {
    if (!exists(f)) continue;
    const data = readJSON(f);
    for (const [k, v] of Object.entries(data || {})) {
      if (typeof v === 'string' && v.trim()) merged[k] = v.trim();
    }
  }
  return merged;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const write = args.has('--write');
  const check = args.has('--check');
  const failOnMissing = args.has('--fail-on-missing');

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
  const fallback = {};
  for (const [mk, mv] of Object.entries(map)) {
    if (mk.startsWith('team:')) fallback[mk] = mv;
  }

  let already = 0, filled = 0, missing = 0;

  for (const t of teams) {
    if (!isEmpty(t.stadium)) { already++; continue; }
    const exactKey = key(t.league_code || '', t.team_name || '');
    const fallbackKey = `team:${norm(t.team_name || '')}`;
    const val = map[exactKey] || fallback[fallbackKey];
    if (val) { t.stadium = val; filled++; } else { missing++; }
  }

  if (write) fs.writeFileSync(TEAMS_PATH, JSON.stringify(teams, null, 2) + '\n', 'utf8');

  console.log('Stadium fill summary:');
  console.log(`- Already present: ${already}`);
  console.log(`- Newly filled:    ${filled}`);
  console.log(`- Still missing:   ${missing}`);
  console.log(`- Mode: ${write ? 'write' : (check ? 'check' : 'dry-run')}`);

  if (check && failOnMissing && missing > 0) {
    console.error(`ERROR: ${missing} teams still missing stadiums. Add mappings and re-run.`);
    process.exit(1);
  }
}

main();
