#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TEAMS_PATH = path.resolve(ROOT, 'teams.json');

// You maintain this mapping file:
const MAP_PATHS = [
  path.resolve(ROOT, 'data', 'stadiums.json'),
  path.resolve(ROOT, 'data', 'stadiums-extra.json') // optional, if you want to split
];

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function fileExists(p) {
  try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; }
}

// Normalize strings for matching
function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function key(leagueCode, teamName) {
  return `${(leagueCode || '').toUpperCase()}:${norm(teamName)}`;
}

function loadMappings() {
  const merged = {};
  for (const p of MAP_PATHS) {
    if (!fileExists(p)) continue;
    const obj = readJSON(p);
    for (const [k, v] of Object.entries(obj || {})) {
      if (typeof v === 'string' && v.trim()) merged[k] = v.trim();
    }
  }
  return merged;
}

function isEmptyStadium(v) {
  return v == null || String(v).trim() === '' || String(v).trim() === '-' || String(v).trim() === '—';
}

function main() {
  const argv = new Set(process.argv.slice(2));
  const write = argv.has('--write');
  const check = argv.has('--check');
  const failOnMissing = argv.has('--fail-on-missing');

  if (!fileExists(TEAMS_PATH)) {
    console.error(`ERROR: ${TEAMS_PATH} not found. Run from repo root where teams.json exists.`);
    process.exit(2);
  }

  const teams = readJSON(TEAMS_PATH);
  if (!Array.isArray(teams)) {
    console.error('ERROR: teams.json must be an array of team objects.');
    process.exit(2);
  }

  const mapping = loadMappings();

  // Also support fallback map by team name only: {"team:arsenal fc": "Emirates Stadium"}
  const fallbackTeamOnly = {};
  for (const [k, v] of Object.entries(mapping)) {
    if (k.startsWith('team:')) fallbackTeamOnly[k] = v;
  }

  let filled = 0;
  let already = 0;
  let missing = 0;

  for (const t of teams) {
    const lc = (t.league_code || '').toUpperCase();
    const tn = t.team_name || '';

    const k = key(lc, tn);
    const kFallback = `team:${norm(tn)}`;

    if (!isEmptyStadium(t.stadium)) {
      already++;
      continue;
    }

    let val = mapping[k];
    if (!val) val = fallbackTeamOnly[kFallback];

    if (val) {
      t.stadium = val;
      filled++;
    } else {
      missing++;
    }
  }

  if (write) {
    fs.writeFileSync(TEAMS_PATH, JSON.stringify(teams, null, 2) + '\n', 'utf8');
  }

  // Report
  console.log('Stadium fill summary:');
  console.log(`- Already present: ${already}`);
  console.log(`- Newly filled:    ${filled}`);
  console.log(`- Still missing:   ${missing}`);
  console.log(`- Mode: ${write ? 'write' : (check ? 'check' : 'dry-run')}`);

  if (check && failOnMissing && missing > 0) {
    console.error(`\nERROR: ${missing} teams are still missing stadium values. Add them to data/stadiums.json (or stadiums-extra.json) and re-run.`);
    process.exit(1);
  }
}

main();
