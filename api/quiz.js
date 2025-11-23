// quiz.js
// Football Spinner – Club knowledge helper for quiz modes
// Uses data/club_knowledge.normalized.json (generated from messy source)
//
// Public API (available as ES module exports *and* on window.FS_QUIZ):
//   await ensureClubKnowledgeLoaded()
//   const club = getClubEntryForContext(context)
//   const hints = getClubHintsForContext(context)
//
// Where `context` is e.g.:
//   {
//     kind: 'club',
//     name: 'Aston Villa',
//     leagueCode: 'EPL',        // optional but recommended
//     leagueName: 'Premier League', // optional
//     stadium: 'Villa Park'     // optional
//   }

const CLUB_KNOWLEDGE_URL = 'data/club_knowledge.normalized.json';

// In–memory store
let CLUB_KNOWLEDGE_RAW = null;      // whatever is in the JSON file (usually an array)
let CLUB_KNOWLEDGE_INDEX = new Map(); // key -> club object
let CLUB_KNOWLEDGE_LOADED = false;
let CLUB_KNOWLEDGE_LOADING = null;

/**
 * Normalise a club name for indexing / comparison.
 */
function normalizeName(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/ fc$/g, '')      // drop trailing "fc"
    .replace(/ football club$/g, '');
}

/**
 * Normalise a league code.
 */
function normalizeLeagueCode(code) {
  if (!code) return '';
  return String(code).trim().toUpperCase();
}

/**
 * Build the internal index from whatever the normalized JSON contains.
 *
 * We are deliberately defensive here: we accept either:
 *   - Array of clubs
 *   - Object keyed by club name
 *
 * and we accept both `name` / `club` and `leagueCode` / `league_code`.
 */
function buildClubIndex(raw) {
  CLUB_KNOWLEDGE_INDEX = new Map();

  if (!raw) {
    console.warn('[quiz] No raw club knowledge to index.');
    return;
  }

  const entries = [];

  if (Array.isArray(raw)) {
    entries.push(...raw);
  } else if (typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      // Skip any metadata keys accidentally left at top-level
      if (!value || typeof value !== 'object') continue;
      // In the messy original file we had fan_culture, trivia, etc as arrays at root.
      // Normalizer should already have removed these for the _normalized file,
      // but we stay defensive anyway.
      entries.push({ _rootKey: key, ...value });
    }
  } else {
    console.warn('[quiz] club knowledge JSON is neither array nor object:', typeof raw);
    return;
  }

  let inserted = 0;

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;

    const name =
      entry.name ||
      entry.club ||
      entry.club_name ||
      entry._rootKey; // fallback for objects keyed by club name

    const leagueCode =
      entry.leagueCode ||
      entry.league_code ||
      entry.league ||
      entry.leagueId ||
      null;

    if (!name || !leagueCode) {
      // Log once in a while if something looks off
      if (entry._rootKey && !['fan_culture','iconic_seasons','famous_wins','heartbreaking_moments','trivia'].includes(entry._rootKey)) {
        console.debug('[quiz] Skipping entry due to missing name/league:', {
          rootKey: entry._rootKey,
          hasName: !!name,
          hasLeague: !!leagueCode
        });
      }
      continue;
    }

    const key = `${normalizeName(name)}|${normalizeLeagueCode(leagueCode)}`;

    // Attach canonical fields we want for quiz usage
    const clubObj = {
      // canonical identifiers
      name,
      leagueCode: normalizeLeagueCode(leagueCode),
      // try to keep original values as well
      country: entry.country || entry.nation || null,
      city: entry.city || null,
      stadium: entry.stadium || null,
      colors: entry.colors || [],
      nicknames: entry.nicknames || [],
      rivals: entry.rivals || [],
      derbies: entry.derbies || [],
      trophies: entry.trophies || {},
      identity_keywords: entry.identity_keywords || entry.identityKeywords || [],
      fun_facts: entry.fun_facts || entry.funFacts || [],
      style_of_play: entry.style_of_play || entry.playing_style || [],
      fan_culture: entry.fan_culture || [],
      iconic_seasons: entry.iconic_seasons || [],
      famous_wins: entry.famous_wins || [],
      heartbreaking_moments: entry.heartbreaking_moments || [],
      trivia: entry.trivia || [],
      // keep the full raw entry in case we need anything else
      _raw: entry
    };

    CLUB_KNOWLEDGE_INDEX.set(key, clubObj);
    inserted++;
  }

  console.info(`[quiz] Indexed ${inserted} clubs from normalized knowledge.`);
}

/**
 * Ensure club knowledge is loaded and indexed.
 * Returns a promise that resolves when ready.
 */
export async function ensureClubKnowledgeLoaded() {
  if (CLUB_KNOWLEDGE_LOADED && CLUB_KNOWLEDGE_INDEX.size > 0) {
    return;
  }
  if (CLUB_KNOWLEDGE_LOADING) {
    return CLUB_KNOWLEDGE_LOADING;
  }

  CLUB_KNOWLEDGE_LOADING = (async () => {
    try {
      console.info('[quiz] Loading club knowledge from', CLUB_KNOWLEDGE_URL);
      const res = await fetch(CLUB_KNOWLEDGE_URL, { cache: 'no-cache' });
      if (!res.ok) {
        console.error('[quiz] Failed to fetch club knowledge:', res.status, res.statusText);
        CLUB_KNOWLEDGE_LOADED = false;
        return;
      }

      const json = await res.json();
      CLUB_KNOWLEDGE_RAW = json;
      console.info('[quiz] club_knowledge.normalized.json loaded.');

      buildClubIndex(json);

      if (CLUB_KNOWLEDGE_INDEX.size === 0) {
        console.warn('[quiz] Knowledge base is empty after indexing normalized file.');
      } else {
        CLUB_KNOWLEDGE_LOADED = true;
      }
    } catch (err) {
      console.error('[quiz] Error loading club knowledge:', err);
      CLUB_KNOWLEDGE_LOADED = false;
    } finally {
      CLUB_KNOWLEDGE_LOADING = null;
    }
  })();

  return CLUB_KNOWLEDGE_LOADING;
}

/**
 * Try various ways to derive a lookup key from the quiz context and the index.
 */
function buildContextKeys(context) {
  const keys = new Set();

  const ctxName = normalizeName(context.name || context.club || context.clubName);
  const ctxLeagueCode = normalizeLeagueCode(context.leagueCode || context.league || context.league_code);

  if (ctxName) {
    if (ctxLeagueCode) {
      keys.add(`${ctxName}|${ctxLeagueCode}`);
    }
    // sometimes leagueCode might be missing – we also try a few generic combos:
    keys.add(`${ctxName}|EPL`);
    keys.add(`${ctxName}|LLA`);
    keys.add(`${ctxName}|SA`);
    keys.add(`${ctxName}|BUN`);
    keys.add(`${ctxName}|L1`);
  }

  // Also try to guess by stadium if name is missing or weird
  const ctxStadium = normalizeName(context.stadium);
  if (ctxStadium) {
    for (const [key, club] of CLUB_KNOWLEDGE_INDEX.entries()) {
      if (normalizeName(club.stadium) === ctxStadium) {
        keys.add(key);
      }
    }
  }

  return [...keys];
}

/**
 * Get the club entry corresponding to a quiz context.
 *
 * Returns `null` if nothing matched.
 */
export function getClubEntryForContext(context) {
  if (!context || context.kind !== 'club') return null;

  if (!CLUB_KNOWLEDGE_INDEX || CLUB_KNOWLEDGE_INDEX.size === 0) {
    console.warn('[quiz] getClubEntryForContext called but knowledge base is empty.');
    return null;
  }

  const keys = buildContextKeys(context);

  for (const key of keys) {
    const club = CLUB_KNOWLEDGE_INDEX.get(key);
    if (club) {
      return club;
    }
  }

  console.warn('[quiz] No club entry found for context', context);
  return null;
}

/**
 * Build a pool of nice textual hints from a club object.
 * You can adjust this to control what appears in your hints UI.
 */
function buildHintsForClub(club) {
  if (!club) return [];

  const hints = [];

  if (club.city && club.country) {
    hints.push(`Based in ${club.city}, ${club.country}.`);
  } else if (club.city) {
    hints.push(`Based in ${club.city}.`);
  }

  if (club.stadium) {
    hints.push(`Home matches are played at ${club.stadium}.`);
  }

  if (Array.isArray(club.nicknames) && club.nicknames.length) {
    hints.push(`Known as: ${club.nicknames.join(', ')}.`);
  }

  if (Array.isArray(club.rivals) && club.rivals.length) {
    hints.push(`Major rivals include ${club.rivals.join(', ')}.`);
  }

  if (Array.isArray(club.derbies) && club.derbies.length) {
    hints.push(`Famous derbies: ${club.derbies.join('; ')}.`);
  }

  if (Array.isArray(club.identity_keywords) && club.identity_keywords.length) {
    hints.push(`Identity keywords: ${club.identity_keywords.join(', ')}.`);
  }

  if (Array.isArray(club.fun_facts) && club.fun_facts.length) {
    for (const fact of club.fun_facts) {
      hints.push(fact);
    }
  }

  // For non-EPL clubs that use fan_culture / style_of_play / trivia
  if (Array.isArray(club.fan_culture) && club.fan_culture.length) {
    for (const fc of club.fan_culture) {
      hints.push(fc);
    }
  }

  if (Array.isArray(club.style_of_play) && club.style_of_play.length) {
    hints.push(`Style of play: ${club.style_of_play.join(', ')}.`);
  } else if (Array.isArray(club._raw?.style_of_play) && club._raw.style_of_play.length) {
    // in case the normalizer didn't copy it up
    hints.push(`Style of play: ${club._raw.style_of_play.join(', ')}.`);
  }

  if (Array.isArray(club.trivia) && club.trivia.length) {
    for (const t of club.trivia) {
      hints.push(t);
    }
  }

  // De-duplicate while preserving order
  const seen = new Set();
  const uniqueHints = [];
  for (const h of hints) {
    const trimmed = String(h || '').trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    uniqueHints.push(trimmed);
  }

  return uniqueHints;
}

/**
 * Main helper for UI: get hints for a context.
 *
 * If you need N hints, just slice the array:
 *   const hints = (await getClubHintsForContext(ctx)).slice(0, 3);
 */
export async function getClubHintsForContext(context) {
  await ensureClubKnowledgeLoaded();
  const club = getClubEntryForContext(context);
  if (!club) return [];
  return buildHintsForClub(club);
}

// Attach to window for non-module usage.
if (typeof window !== 'undefined') {
  window.FS_QUIZ = window.FS_QUIZ || {};
  window.FS_QUIZ.ensureClubKnowledgeLoaded = ensureClubKnowledgeLoaded;
  window.FS_QUIZ.getClubEntryForContext = getClubEntryForContext;
  window.FS_QUIZ.getClubHintsForContext = getClubHintsForContext;
}

export default {
  ensureClubKnowledgeLoaded,
  getClubEntryForContext,
  getClubHintsForContext
};
