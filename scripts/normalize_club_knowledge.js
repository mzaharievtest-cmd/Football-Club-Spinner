// scripts/normalize_club_knowledge.js
// Usage: node scripts/normalize_club_knowledge.js

const fs = require('fs');
const path = require('path');

const INPUT = path.join(__dirname, '..', 'data', 'club_knowledge.json');
const OUTPUT = path.join(__dirname, '..', 'data', 'club_knowledge.normalized.json');

function isClubLike(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  // Real club entries always have league_code + some metadata
  if ('league_code' in value) return true;
  if ('club' in value && 'league_code' in value) return true;

  return false;
}

function normalizeClub(key, value) {
  const name = value.name || value.club || key;
  const league_code =
    value.league_code ||
    value.leagueCode ||
    value.league ||
    null;

  if (!name || !league_code) {
    return null;
  }

  // Copy everything, but ensure consistent `name` and `league_code`
  const out = { ...value, name, league_code };

  // `club` is just duplicate of name in your EPL block → drop it
  delete out.club;

  return out;
}

function main() {
  const rawText = fs.readFileSync(INPUT, 'utf8');

  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch (err) {
    console.error('❌ Failed to parse JSON from', INPUT);
    console.error(err.message);
    process.exit(1);
  }

  let dict = null;

  if (Array.isArray(raw)) {
    // Case 1: your current shape → [ { "6": {...}, "8": {...}, "Bayern Munich": {...}, ... } ]
    if (raw.length === 1 && raw[0] && typeof raw[0] === 'object' && !Array.isArray(raw[0])) {
      dict = raw[0];
    } else {
      // Case 2: already "almost fine" → array of things, just normalize what looks like clubs
      console.log(`[normalize] Input is array of length ${raw.length}, normalizing entries that look like clubs...`);
      const clubs = [];
      for (const entry of raw) {
        if (!isClubLike(entry)) continue;
        const keyForName = entry.name || entry.club || 'Unknown';
        const club = normalizeClub(keyForName, entry);
        if (club) clubs.push(club);
      }

      clubs.sort((a, b) => {
        if (a.league_code === b.league_code) {
          return a.name.localeCompare(b.name);
        }
        return a.league_code.localeCompare(b.league_code);
      });

      fs.writeFileSync(OUTPUT, JSON.stringify(clubs, null, 2), 'utf8');
      console.log(`✅ Wrote ${clubs.length} clubs to ${OUTPUT}`);
      return;
    }
  } else if (raw && typeof raw === 'object') {
    // Case 3: root is already an object with keys like "Bayern Munich"
    dict = raw;
  } else {
    console.error('❌ Unexpected JSON shape in club_knowledge.json');
    process.exit(1);
  }

  const clubs = [];
  const skipped = [];

  for (const [key, value] of Object.entries(dict)) {
    if (!isClubLike(value)) {
      skipped.push(key);
      continue;
    }

    const club = normalizeClub(key, value);
    if (!club) {
      skipped.push(key);
      continue;
    }

    clubs.push(club);
  }

  clubs.sort((a, b) => {
    if (a.league_code === b.league_code) {
      return a.name.localeCompare(b.name);
    }
    return a.league_code.localeCompare(b.league_code);
  });

  fs.writeFileSync(OUTPUT, JSON.stringify(clubs, null, 2), 'utf8');

  console.log(`✅ Wrote ${clubs.length} normalized clubs to ${OUTPUT}`);
  if (skipped.length) {
    console.log(`ℹ️ Skipped ${skipped.length} non-club keys:`);
    console.log('   ' + skipped.join(', '));
  }
}

main();
