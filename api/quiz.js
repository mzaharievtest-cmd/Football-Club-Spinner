// api/quiz.js
// Vercel serverless function for Football Spinner AI quiz

const fs = require('fs').promises;
const path = require('path');
const OpenAI = require('openai');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let CLUBS_CACHE = null;

/**
 * Load club knowledge JSON once and cache.
 * Expected structure: array of clubs with at least:
 * - team_id
 * - team_name
 * - league_code (EPL, SA, BUN, L1, LLA)
 * - plus extra fields (stadium, city, founded, trophies, rivals, legends, fun_facts, ...)
 */
async function loadClubs() {
  if (CLUBS_CACHE) return CLUBS_CACHE;

  const filePath = path.join(__dirname, '..', 'data', 'club_knowledge.json');
  const raw = await fs.readFile(filePath, 'utf8');
  const json = JSON.parse(raw);

  // Optional: normalize names and codes
  CLUBS_CACHE = (json || []).map((c) => ({
    ...c,
    team_name: c.team_name || c.name || '',
    league_code: c.league_code || c.leagueCode || '',
  }));

  return CLUBS_CACHE;
}

/**
 * Try to find the correct club entry based on context from the client.
 * context.kind === 'club' | 'player'
 */
function findClubEntry(clubs, context) {
  const rawClubName =
    (context.kind === 'club' ? context.name : context.clubName) || '';
  const leagueCode = (context.leagueCode || context.league || '').toUpperCase();

  const nameLc = rawClubName.toLowerCase().trim();

  // 1) exact name match
  let candidates = clubs.filter(
    (c) => c.team_name && c.team_name.toLowerCase().trim() === nameLc
  );

  // 2) if leagueCode known, prefer clubs in that league
  if (leagueCode && candidates.length > 1) {
    const narrowed = candidates.filter(
      (c) => c.league_code && c.league_code.toUpperCase() === leagueCode
    );
    if (narrowed.length) candidates = narrowed;
  }

  // 3) fallback: fuzzy contains
  if (!candidates.length && rawClubName) {
    candidates = clubs.filter((c) =>
      (c.team_name || '').toLowerCase().includes(nameLc)
    );
  }

  return candidates[0] || null;
}

/**
 * Build a small "world" around the chosen club:
 *  - the club itself
 *  - a few other clubs from same league (for distractors)
 */
function buildClubQuizContext(allClubs, club) {
  const leagueCode = (club.league_code || '').toUpperCase();
  const sameLeague = allClubs.filter(
    (c) =>
      c.league_code &&
      c.league_code.toUpperCase() === leagueCode &&
      c.team_name !== club.team_name
  );

  // take a few for wrong answers
  const shuffled = sameLeague.sort(() => Math.random() - 0.5);
  const rivals = Array.isArray(club.rivals) ? club.rivals : [];
  const legends = Array.isArray(club.legends) ? club.legends : [];

  return {
    club: {
      team_id: club.team_id,
      team_name: club.team_name,
      league_code: club.league_code,
      country: club.country,
      city: club.city,
      founded: club.founded,
      stadium: club.stadium,
      capacity: club.capacity,
      manager: club.manager,
      nicknames: club.nicknames,
      colours: club.colours,
      trophies: club.trophies,
      rivals,
      legends,
      fun_facts: club.fun_facts,
    },
    otherClubsSameLeague: shuffled.slice(0, 10).map((c) => ({
      team_name: c.team_name,
      stadium: c.stadium,
      city: c.city,
      country: c.country,
    })),
  };
}

/**
 * Build prompt for OpenAI.
 * We LIMIT the model strictly to the provided club data.
 */
function buildPrompt({ difficulty, category, clubContext }) {
  return [
    {
      role: 'system',
      content:
        'You are a football trivia generator. ' +
        'You must ONLY use the facts given in the JSON below. ' +
        'Do NOT invent seasons, stats, managers, trophies or rivals that are not present in the JSON. ' +
        'If a specific detail is not present, you MUST NOT ask about it. ' +
        'You output ONLY a single JSON object, nothing else.',
    },
    {
      role: 'user',
      content:
        'Generate ONE 4-option multiple-choice trivia question about this club.\n' +
        '- Use ONLY data from the provided JSON.\n' +
        '- The question must be answerable from this JSON alone.\n' +
        '- Difficulty: ' +
        difficulty +
        '\n' +
        '- Topic preference (if possible): ' +
        category +
        ' (but ignore if not supported by the data).\n' +
        '- Answers: exactly 4 options.\n' +
        '- Mark correct answer with correctIndex 0–3.\n' +
        '- You MAY use otherClubsSameLeague for plausible wrong answers (e.g. other stadiums / cities / clubs).\n' +
        '\n' +
        'Return STRICTLY this JSON shape:\n' +
        '{\n' +
        '  "question": "string",\n' +
        '  "answers": ["a","b","c","d"],\n' +
        '  "correctIndex": 0,\n' +
        '  "explanation": "string (short, optional but recommended)"\n' +
        '}\n' +
        '\n' +
        'Here is the data:\n' +
        JSON.stringify(clubContext),
    },
  ];
}

/**
 * Fallback question if OpenAI fails or data is missing.
 * SUPER SAFE, only uses provided context fields.
 */
function buildFallbackQuestion(context, clubEntry) {
  const name =
    (context.kind === 'club' ? context.name : context.clubName) ||
    clubEntry?.team_name ||
    'this club';

  const league =
    context.leagueName ||
    context.league ||
    clubEntry?.league_name ||
    clubEntry?.league_code ||
    'a top European league';

  const country = clubEntry?.country || 'Europe';

  const question = `In which country is ${name} based?`;

  const correct = country;
  const pool = ['England', 'Spain', 'Italy', 'Germany', 'France', 'Portugal'];
  const others = pool.filter(
    (c) => c.toLowerCase() !== correct.toLowerCase()
  );

  const shuffled = [correct, ...others.sort(() => Math.random() - 0.5).slice(0, 3)]
    .sort(() => Math.random() - 0.5);

  const correctIndex = shuffled.indexOf(correct);

  return {
    question,
    answers: shuffled,
    correctIndex: correctIndex >= 0 ? correctIndex : 0,
    explanation: `The correct answer is ${correct}.`,
  };
}

/**
 * Main handler
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { mode, difficulty = 'auto', context = {}, category = 'mixed' } =
      req.body || {};

    const clubs = await loadClubs();

    let quiz;

    // Only club-based quiz for now; player quiz can be added later with player_knowledge.json
    if (context.kind === 'club' || mode === 'team') {
      const clubEntry = findClubEntry(clubs, { ...context, kind: 'club' });

      if (!clubEntry) {
        // No match → safe fallback
        quiz = buildFallbackQuestion(context, null);
      } else {
        const clubContext = buildClubQuizContext(clubs, clubEntry);

        const messages = buildPrompt({
          difficulty,
          category,
          clubContext,
        });

        const completion = await client.chat.completions.create({
          model: 'gpt-4.1-mini',
          messages,
          temperature: 0.7,
        });

        const raw = (completion.choices[0]?.message?.content || '').trim();

        // Extract JSON (in case model ever wraps it)
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        let parsed;
        if (start !== -1 && end !== -1 && end > start) {
          const jsonText = raw.slice(start, end + 1);
          parsed = JSON.parse(jsonText);
        } else {
          throw new Error('Model did not return JSON');
        }

        // Basic shape validation
        if (
          !parsed ||
          typeof parsed.question !== 'string' ||
          !Array.isArray(parsed.answers) ||
          parsed.answers.length !== 4 ||
          typeof parsed.correctIndex !== 'number'
        ) {
          throw new Error('Invalid quiz payload from model');
        }

        quiz = {
          question: parsed.question,
          answers: parsed.answers,
          correctIndex: parsed.correctIndex,
          explanation: parsed.explanation || '',
        };
      }
    } else {
      // Player mode not wired yet → generic fallback
      quiz = buildFallbackQuestion(context, null);
    }

    return res.status(200).json(quiz);
  } catch (err) {
    console.error('[api/quiz] error:', err);
    // Last resort fallback
    return res.status(200).json({
      question: 'Which country is this club from?',
      answers: ['England', 'Spain', 'Germany', 'Italy'],
      correctIndex: 0,
      explanation:
        'Fallback question used because AI quiz could not be generated.',
    });
  }
};
