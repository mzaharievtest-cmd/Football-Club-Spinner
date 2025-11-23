// api/quiz.js
// Serverless function for AI Quiz (Vercel)
//
// - Uses club_knowledge.json as the single source of truth
// - NEVER invents facts; questions are built from that JSON.
// - OpenAI is only used to phrase the question text nicely.
//
// Expected request body (from app.js):
// { mode: 'team' | 'player', difficulty: 'auto' | 'easy' | 'medium' | 'hard', context: {...} }
//
// Response:
// { question: string, answers: string[4], correctIndex: number, explanation?: string }

const fs = require('fs/promises');
const path = require('path');

const MODEL = 'gpt-4o-mini'; // or gpt-4.1-mini if your account supports it

let KB_CACHE = null;

// --- Helpers for normalization ------------------------------------------------

const LEAGUE_CODE_MAP = {
  EPL: 'Premier League',
  BUN: 'Bundesliga',
  SA: 'Serie A',
  LLA: 'La Liga',
  L1: 'Ligue 1'
};

function norm(str = '') {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
}

function normalizeLeague(rawLeague, rawLeagueCode) {
  if (rawLeague && String(rawLeague).trim()) {
    return String(rawLeague).trim();
  }
  if (rawLeagueCode && LEAGUE_CODE_MAP[rawLeagueCode]) {
    return LEAGUE_CODE_MAP[rawLeagueCode];
  }
  // fallback: just return the code/string if we have nothing better
  return (rawLeagueCode || rawLeague || '').trim();
}

/**
 * Take the raw JSON (object or array) from club_knowledge.json and
 * normalize it into an ARRAY of club objects with:
 *   - name
 *   - league & league_name
 *   - stadium, country, city, etc. passed through
 */
function normalizeKnowledge(raw) {
  const clubs = [];

  // If it's already an array, just normalize each element
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const name =
        item.name ||
        item.club_name ||
        item.team_name ||
        '';

      const league = normalizeLeague(
        item.league || item.league_name,
        item.league_code || item.leagueCode
      );

      clubs.push({
        ...item,
        name: name.trim(),
        league,
        league_name: league,
        league_code: item.league_code || item.leagueCode || undefined
      });
    }
    return clubs;
  }

  // Otherwise it's an object with keys like "6", "29", "Bayern Munich", ...
  for (const [key, item] of Object.entries(raw)) {
    if (!item || typeof item !== 'object') continue;

    const name =
      item.name ||
      item.club_name ||
      item.team_name ||
      key; // fallback: key itself if it looks like a name

    const league = normalizeLeague(
      item.league || item.league_name,
      item.league_code || item.leagueCode
    );

    clubs.push({
      ...item,
      name: String(name).trim(),
      league,
      league_name: league,
      league_code: item.league_code || item.leagueCode || undefined
    });
  }

  return clubs;
}

// --- Load & cache club knowledge ----------------------------------------------

async function loadKnowledge() {
  if (KB_CACHE) return KB_CACHE;

  try {
    const filePath = path.join(process.cwd(), 'data', 'club_knowledge.json');
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);

    const normalized = normalizeKnowledge(parsed);
    KB_CACHE = normalized;
    console.log(`Loaded club_knowledge.json with ${normalized.length} clubs.`);
    return KB_CACHE;
  } catch (err) {
    console.error('Failed to load club_knowledge.json', err);
    throw err; // bubble up so we return 500 and can see it in logs
  }
}

function sample(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function shuffleWithCorrectFirst(answers) {
  // answers: plain strings where answers[0] MUST be the correct one initially
  const arr = answers.map((text, i) => ({ text, i }));
  // Fisher–Yates
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const finalAnswers = arr.map(a => a.text);
  const correctIndex = arr.findIndex(a => a.i === 0); // where original index was 0
  return { finalAnswers, correctIndex };
}

// ---- Build question payloads from knowledge base (no AI yet) ----

function buildClubQuestion(club, allClubs, difficulty = 'auto') {
  const league = club.league || club.league_name || '';
  const clubName = club.name || club.team_name || '';

  const sameLeague = allClubs.filter(
    c =>
      norm(c.name) !== norm(clubName) &&
      norm(c.league || c.league_name) === norm(league)
  );

  // Try stadium question first (requires at least 3 other clubs in same league)
  if (club.stadium && sameLeague.length >= 3) {
    const distractors = sample(sameLeague, 3).map(c => c.name);
    const answers = [clubName, ...distractors];
    const { finalAnswers, correctIndex } = shuffleWithCorrectFirst(answers);

    return {
      type: 'club_stadium',
      correctLabel: clubName,
      questionTemplate: `Which of the following clubs plays its home matches at ${club.stadium}?`,
      answers: finalAnswers,
      correctIndex,
      extra: { league, stadium: club.stadium }
    };
  }

  // Fallback: league question
  const leagues = Array.from(
    new Set(allClubs.map(c => c.league || c.league_name).filter(Boolean))
  ).filter(l => norm(l) !== norm(league));

  const distractorLeagues = sample(leagues, Math.min(3, leagues.length));
  const answers = [league, ...distractorLeagues];
  const { finalAnswers, correctIndex } = shuffleWithCorrectFirst(answers);

  return {
    type: 'club_league',
    correctLabel: league,
    questionTemplate: `In which league does ${clubName} currently compete?`,
    answers: finalAnswers,
    correctIndex,
    extra: { clubName }
  };
}

function buildPlayerQuestion(playerCtx, allClubs) {
  const { name, clubName, league = 'Premier League' } = playerCtx;
  if (!name || !clubName) return null;

  const sameLeagueClubs = allClubs.filter(
    c =>
      norm(c.name) !== norm(clubName) &&
      norm(c.league || c.league_name) === norm(league)
  );

  if (sameLeagueClubs.length < 3) return null;

  const distractors = sample(sameLeagueClubs, 3).map(c => c.name);
  const answers = [clubName, ...distractors];
  const { finalAnswers, correctIndex } = shuffleWithCorrectFirst(answers);

  return {
    type: 'player_club',
    correctLabel: clubName,
    questionTemplate: `For which club does ${name} currently play?`,
    answers: finalAnswers,
    correctIndex,
    extra: { playerName: name, league }
  };
}

// ---- OpenAI call (only to phrase the question nicely) ----

async function fetchQuestionText(apiKey, baseQuestion, meta) {
  // If OpenAI is misconfigured, just return the base question.
  if (!apiKey) return baseQuestion;

  const prompt = [
    `You are a football trivia writer.`,
    `Your job: take the base question and rephrase it in natural English, keeping the meaning identical.`,
    `Do NOT mention answer options in the text; just output the final question.`,
    `Do NOT add extra facts or numbers that weren't implied in the base question.`,
    ``,
    `Base question: "${baseQuestion}"`,
    meta
      ? `Context JSON (for flavour only, don't contradict it): ${JSON.stringify(meta)}`
      : ''
  ].join('\n');

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        max_tokens: 120,
        messages: [
          { role: 'system', content: 'You write short, clear football quiz questions.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!resp.ok) {
      console.error('OpenAI HTTP error', resp.status, await resp.text());
      return baseQuestion;
    }

    const json = await resp.json();
    const text = json.choices?.[0]?.message?.content?.trim();
    return text || baseQuestion;
  } catch (err) {
    console.error('OpenAI call failed', err);
    return baseQuestion;
  }
}

// ---- Main handler ------------------------------------------------------------

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    const { mode = 'team', difficulty = 'auto', context = {} } = body;

    const knowledge = await loadKnowledge();

    const kind = context.kind || (mode === 'player' ? 'player' : 'club');
    const name = (context.name || '').trim();
    const league = (context.leagueName || context.league || '').trim();

    // ---- Find matching club in KB ----
    let clubEntry = null;

    if (kind === 'club') {
      const key = norm(name);
      clubEntry =
        knowledge.find(
          c =>
            norm(c.name) === key &&
            (!league || norm(c.league || c.league_name) === norm(league))
        ) ||
        knowledge.find(c => norm(c.name) === key); // fallback just by name
    } else {
      // For players we only need their club + league for distractors
      const clubName = (context.clubName || '').trim();
      const clubKey = norm(clubName);
      clubEntry =
        knowledge.find(
          c =>
            norm(c.name) === clubKey &&
            (!league || norm(c.league || c.league_name) === norm(league))
        ) ||
        knowledge.find(c => norm(c.name) === clubKey);
    }

    if (!clubEntry) {
      console.warn('No club entry found for context', context);
      return res.status(400).json({ error: 'No knowledge for this team/player yet.' });
    }

    let base;
    if (kind === 'player') {
      base = buildPlayerQuestion(
        {
          name: context.name || '',
          clubName: context.clubName || '',
          league: league || 'Premier League'
        },
        knowledge
      );
    } else {
      base = buildClubQuestion(clubEntry, knowledge, difficulty);
    }

    if (!base) {
      return res.status(400).json({ error: 'Unable to build a question for this item.' });
    }

    const phrasedQuestion = await fetchQuestionText(
      apiKey,
      base.questionTemplate,
      { type: base.type, extra: base.extra }
    );

    return res.status(200).json({
      question: phrasedQuestion,
      answers: base.answers,
      correctIndex: base.correctIndex
      // explanation: could be added later if you want
    });
  } catch (err) {
    console.error('Quiz API error', err);
    return res.status(500).json({ error: 'Internal quiz error' });
  }
};
