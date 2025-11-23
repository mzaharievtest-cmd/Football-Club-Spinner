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

// ----- Normalization helpers -----

function rawNorm(str = '') {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
}

// Normalize club names so "Fulham" == "Fulham FC" == "Fulham F.C."
function normClubName(str = '') {
  let s = rawNorm(str);
  // strip trailing "fc", "cf", "sc", "afc" etc.
  s = s.replace(/(footballclub|futbolclub)$/g, '');
  s = s.replace(/(afc|fc|cf|sc)$/g, '');
  return s;
}

// Normalize league codes / names so "EPL" == "Premier League", etc.
function normLeague(str = '') {
  const s = rawNorm(str);
  if (!s) return '';

  if (s === 'epl' || s === 'premierleague' || s === 'englishpremierleague') return 'epl';
  if (s === 'bundesliga' || s === 'germanbundesliga') return 'bun';
  if (s === 'laliga' || s === 'primeradivision' || s === 'spanishleague') return 'lla';
  if (s === 'seriea' || s === 'italianseriea') return 'sa';
  if (s === 'ligue1' || s === 'franceligue1') return 'l1';

  // fallback – use raw
  return s;
}

// Convert raw JSON entry into a normalized club object
function normalizeClubEntry(entry, fallbackId) {
  const clubName =
    entry.name ||
    entry.club_name ||
    entry.team_name ||
    entry.clubName ||
    entry.team ||
    '';

  const leagueRaw =
    entry.league ||
    entry.league_name ||
    entry.league_code ||
    entry.leagueCode ||
    '';

  const stadium =
    entry.stadium ||
    entry.ground ||
    '';

  return {
    ...entry,
    id: entry.id || fallbackId || null,
    name: clubName,
    league: leagueRaw,
    stadium,
    _normName: normClubName(clubName),
    _normLeague: normLeague(leagueRaw)
  };
}

async function loadKnowledge() {
  if (KB_CACHE) return KB_CACHE;

  try {
    const filePath = path.join(process.cwd(), 'data', 'club_knowledge.json');
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);

    let entries;
    if (Array.isArray(parsed)) {
      entries = parsed;
    } else if (parsed && typeof parsed === 'object') {
      // object like { "6": {...}, "8": {...} }
      entries = Object.entries(parsed).map(([key, value]) => ({
        id: key,
        ...value
      }));
    } else {
      entries = [];
    }

    const normalized = entries.map((e, idx) => normalizeClubEntry(e, idx));
    KB_CACHE = normalized;
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
  const league = club.league || '';
  const clubName = club.name || '';

  const sameLeague = allClubs.filter(
    c => c._normName !== club._normName && c._normLeague === club._normLeague
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
    new Set(allClubs.map(c => c.league).filter(Boolean))
  ).filter(l => normLeague(l) !== club._normLeague);

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
  const { name, clubName, league } = playerCtx;
  if (!name || !clubName) return null;

  const clubKey = normClubName(clubName);
  const leagueKey = normLeague(league);

  const sameLeagueClubs = allClubs.filter(
    c => c._normName !== clubKey && c._normLeague === leagueKey
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

    // leagueName from context is usually "Premier League"; we normalize
    const leagueFromContext =
      (context.leagueName || context.league || context.leagueCode || '').trim();

    const normNameKey = normClubName(name);
    const normLeagueKey = normLeague(leagueFromContext);

    let clubEntry = null;

    if (kind === 'club') {
      // First, try exact name match (normalized)
      let candidates = knowledge.filter(c => c._normName === normNameKey);

      // If multiple, narrow by league if possible
      if (candidates.length > 1 && normLeagueKey) {
        const filtered = candidates.filter(c => c._normLeague === normLeagueKey);
        if (filtered.length > 0) candidates = filtered;
      }

      clubEntry = candidates[0] || null;
    } else {
      // Player context – we need their club
      const clubName = (context.clubName || '').trim();
      const clubKey = normClubName(clubName);
      const leagueKey = normLeague(leagueFromContext || 'Premier League');

      let candidates = knowledge.filter(c => c._normName === clubKey);
      if (candidates.length > 1 && leagueKey) {
        const filtered = candidates.filter(c => c._normLeague === leagueKey);
        if (filtered.length > 0) candidates = filtered;
      }

      clubEntry = candidates[0] || null;
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
          league: leagueFromContext || 'Premier League'
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
