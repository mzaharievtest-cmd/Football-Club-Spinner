// scripts/normalize_club_knowledge.js
// Run with: node scripts/normalize_club_knowledge.js

const fs = require('fs');
const path = require('path');

const RAW_PATH = path.join(__dirname, '..', 'data', 'club_knowledge.json');
const OUT_PATH = path.join(__dirname, '..', 'data', 'club_knowledge.normalized.json');

function main() {
  const rawText = fs.readFileSync(RAW_PATH, 'utf8');
  let raw;

  try {
    raw = JSON.parse(rawText);
  } catch (err) {
    console.error('[normalize] Failed to parse data/club_knowledge.json:', err.message);
    process.exit(1);
  }

  // Your current file is like: [ { "6": {...}, "8": {...}, "Bayern Munich": {...}, ... }, "Bayern Munich", ":", { ... }, ... ]
  // We only care about the FIRST big object that has all the clubs as keys.
  const rootObj = Array.isArray(raw) ? raw[0] : raw;

  if (!rootObj || typeof rootObj !== 'object') {
    console.error('[normalize] Unexpected structure – root is not an object.');
    process.exit(1);
  }

  const normalized = [];

  for (const [key, val] of Object.entries(rootObj)) {
    if (!val || typeof val !== 'object') {
      // Skip junk like stray strings etc. (shouldn’t happen in rootObj, but just in case)
      continue;
    }

    // Determine the club name:
    // - for EPL numeric ids we have val.club already
    // - for named keys ("Bayern Munich", "Juventus", …) val.club might be missing
    const clubName = val.club || key;
    const leagueCode = val.league_code || val.leagueCode;

    if (!clubName || !leagueCode) {
      // If something is really malformed, log and skip
      console.warn('[normalize] Skipping key due to missing club/league:', key, '->', Object.keys(val));
      continue;
    }

    // Build the output object:
    // - preserve everything from val
    // - enforce canonical "name", "club", "league_code"
    const out = {
      ...val,
      club: clubName,          // ensure club is present
      name: clubName,          // canonical name used by quiz.js
      league_code: leagueCode  // normalize key name
    };

    normalized.push(out);
  }

  // Optional: sort alphabetically by league_code then name for sanity
  normalized.sort((a, b) => {
    if (a.league_code !== b.league_code) {
      return a.league_code.localeCompare(b.league_code);
    }
    return a.name.localeCompare(b.name);
  });

  fs.writeFileSync(OUT_PATH, JSON.stringify(normalized, null, 2), 'utf8');
  console.log(`[normalize] Wrote ${normalized.length} clubs to data/club_knowledge.normalized.json`);
}

main();
