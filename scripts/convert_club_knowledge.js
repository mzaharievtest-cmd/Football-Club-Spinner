// scripts/convert_club_knowledge.js
//
// Usage:
//   node scripts/convert_club_knowledge.js
//
// Reads data/club_knowledge_raw.json and writes data/club_knowledge.json
// in the clean, flat format that quiz.js expects.

const fs = require('fs');
const path = require('path');

const INPUT = path.join(__dirname, '..', 'data', 'club_knowledge_raw.json');
const OUTPUT = path.join(__dirname, '..', 'data', 'club_knowledge.json');

const LEAGUE_NAME_BY_CODE = {
  EPL: 'Premier League',
  BUN: 'Bundesliga',
  SA: 'Serie A',
  LLA: 'La Liga',
  L1: 'Ligue 1'
};

// Basic normalizer used only for debugging if needed
function norm(str = '') {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
}

function loadRaw() {
  const rawText = fs.readFileSync(INPUT, 'utf8');
  const json = JSON.parse(rawText);

  // Your current file is basically:
  // [ { "6": {...}, "8": {...}, "Bayern Munich": {...}, ... } ]
  // plus lots of similar structures.
  //
  // So we flatten ALL object entries at any level into a single list of club objects.

  let entries = [];

  function collect(obj) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach(collect);
      return;
    }

    // obj is a plain object: treat each value as a potential club
    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        entries.push({ key, ...value });
      }
    }
  }

  collect(json);

  return entries;
}

function transform() {
  const rawEntries = loadRaw();

  const clubs = rawEntries
    .map((entry) => {
      // entry.key is either an id ("6") or club name ("Bayern Munich")
      const keyName = entry.key;

      const leagueCode =
        entry.leagueCode ||
        entry.league_code ||
        entry.leaguecode ||
        entry.league ||
        null;

      const league =
        entry.league ||
        LEAGUE_NAME_BY_CODE[leagueCode] ||
        leagueCode ||
        null;

      const name =
        entry.name ||
        entry.club ||
        entry.club_name ||
        entry.team_name ||
        (isNaN(Number(keyName)) ? keyName : null); // if key is not numeric, treat as name

      if (!name || !leagueCode) {
        // Not fatal, but skip garbage
        console.warn(
          '[convert] Skipping entry with key=',
          keyName,
          'because it has no name or league_code. Available keys:',
          Object.keys(entry).join(', ')
        );
        return null;
      }

      return {
        // Canonical fields the quiz expects:
        name,
        league,
        leagueCode,

        // Keep all the original details:
        country: entry.country || null,
        city: entry.city || null,
        stadium: entry.stadium || null,
        founded: entry.founded || null,
        colors: entry.colors || null,
        nicknames: entry.nicknames || null,
        rivals: entry.rivals || null,
        derbies: entry.derbies || null,
        notable_managers: entry.notable_managers || null,
        legends: entry.legends || null,
        trophies: entry.trophies || null,
        playing_style: entry.playing_style || entry.style_of_play || null,
        identity_keywords: entry.identity_keywords || null,
        fun_facts: entry.fun_facts || entry.trivia || null,
        // Plus keep a reference to the original key for debugging if needed
        _sourceKey: keyName
      };
    })
    .filter(Boolean);

  // Deduplicate by normalized name + leagueCode, in case the same club appears multiple times
  const seen = new Set();
  const deduped = [];

  for (const c of clubs) {
    const sig = `${norm(c.name)}|${c.leagueCode}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    deduped.push(c);
  }

  console.log('[convert] Raw entries:', rawEntries.length);
  console.log('[convert] Valid clubs:', clubs.length);
  console.log('[convert] After dedupe:', deduped.length);

  fs.writeFileSync(OUTPUT, JSON.stringify(deduped, null, 2), 'utf8');
  console.log('[convert] Written', OUTPUT);
}

transform();
