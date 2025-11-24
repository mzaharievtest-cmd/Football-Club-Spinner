// api/quiz.js
//
// AI-powered quiz endpoint for Football Spinner.
//
// Expects POST JSON body:
// {
//   mode: "team" | "player",
//   difficulty: "auto" | "easy" | "medium" | "hard",
//   category: "mixed" | "club" | "player" | "manager" | "history" | "fans",
//   context: {
//     kind: "club" | "player",
//     name: string,          // club name or player name
//     clubName?: string,     // for players
//     league?: string,       // "Premier League" or full league name
//     leagueCode?: string,
//     stadium?: string,
//     nationality?: string,
//     jersey?: string
//   },
//   previousQuestions?: string[]   // all questions asked in this session so far
// }
//
// Returns JSON:
// {
//   question: string,
//   answers: string[4],
//   correctIndex: number (0..3),
//   explanation?: string,
//   difficulty?: string
// }

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('[quiz] Missing OPENAI_API_KEY env variable');
    res.status(500).json({ error: 'Server misconfigured: missing OpenAI API key' });
    return;
  }

  try {
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    const mode       = body.mode === 'player' ? 'player' : 'team';
    const difficulty = body.difficulty || 'auto';
    const category   = body.category || 'mixed';
    const context    = body.context || {};
    const prevQs     = Array.isArray(body.previousQuestions)
      ? body.previousQuestions
          .map(q => (q || '').toString().trim())
          .filter(q => q.length > 0)
      : [];

    const kind = context.kind || (mode === 'player' ? 'player' : 'club');
    const name = (context.name || '').trim();

    if (!name) {
      return res.status(400).json({ error: 'Missing club/player name in context' });
    }

    const league =
      context.league ||
      context.leagueName ||
      (context.leagueCode || '').toString();

    const clubName    = context.clubName || '';
    const stadium     = context.stadium || '';
    const nationality = context.nationality || '';
    const jersey      = context.jersey || '';

    // Build a compact context string for the model
    const contextSummary = [
      `kind: ${kind}`,
      `name: ${name}`,
      league ? `league: ${league}` : null,
      clubName ? `club: ${clubName}` : null,
      stadium ? `stadium: ${stadium}` : null,
      nationality ? `nationality: ${nationality}` : null,
      jersey ? `jersey: ${jersey}` : null
    ]
      .filter(Boolean)
      .join(' · ');

    // Difficulty hint
    const difficultyHint = (() => {
      switch (difficulty) {
        case 'easy':
          return 'Make it EASY: very well-known fact, obvious to casual fans.';
        case 'medium':
          return 'Make it MEDIUM: known to regular football fans but not total beginners.';
        case 'hard':
          return 'Make it HARD: trickier detail, but still answerable by dedicated fans.';
        default:
          return 'Pick a reasonable difficulty for average fans (between easy and medium).';
      }
    })();

    // Category / style hint
    const categoryHint = (() => {
      switch (category) {
        case 'club':
          return 'Ask specifically about this club (history, trophies, stadium, nicknames, rivalries, etc.).';
        case 'player':
          return 'Ask specifically about this player (club career, position, nationality, achievements, etc.).';
        case 'manager':
          return 'Ask about managers connected to this club or this player.';
        case 'history':
          return 'Ask about historical achievements, trophies, or famous moments.';
        case 'fans':
          return 'Ask about fan culture, derbies, or rivalries.';
        case 'mixed':
        default:
          return 'You may ask about stadium, history, famous players, trophies, rivals, or fan culture.';
      }
    })();

    // Previous questions block (to avoid repetition in this session)
    let avoidBlock = '';
    if (prevQs.length) {
      const trimmed = prevQs.slice(-10).map(q => q.slice(0, 140));
      avoidBlock =
        'These questions have ALREADY been used in this session. DO NOT repeat them or very close paraphrases:\n' +
        trimmed.map(q => `- ${q}`).join('\n') +
        '\n\n';
    }

    const varietyHint = `
Avoid repeating the same pattern every time. Do NOT always ask about the same fact
(e.g. always stadium, always same trophy question).
Vary topics: trophies, famous matches, rivals, players, managers, seasons, city/country, etc.
If a previous question in this session was about the same fact, choose a different fact.
    `.trim();

    const userPrompt = `
Generate ONE multiple-choice football quiz question based on this context:

${contextSummary}

${difficultyHint}
${categoryHint}

${avoidBlock}${varietyHint}

Requirements:
- Question must be about THIS specific club/player or something directly related to them.
- Provide EXACTLY four answer options (A, B, C, D) as a JSON array of strings.
- One and only one answer must be correct.
- Make distractors plausible but clearly wrong to knowledgeable fans.
- If you mention a number (years, trophies, goals), be consistent with football knowledge as much as possible.

Return ONLY valid JSON with this shape:

{
  "question": "string",
  "answers": ["string", "string", "string", "string"],
  "correctIndex": 0,
  "explanation": "short explanation why the correct answer is right",
  "difficulty": "easy | medium | hard"
}
    `.trim();

    const completionResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        temperature: 0.8,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are an assistant that writes accurate and fun football quiz questions. Always respond with valid JSON only.'
          },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!completionResp.ok) {
      const text = await completionResp.text().catch(() => '');
      console.error('[quiz] OpenAI error:', completionResp.status, text);
      return res.status(502).json({ error: 'OpenAI API error', details: text.slice(0, 300) });
    }

    const completion = await completionResp.json();
    const content = completion?.choices?.[0]?.message?.content;

    if (!content || typeof content !== 'string') {
      console.error('[quiz] Missing content from OpenAI response');
      return res.status(502).json({ error: 'Invalid response from OpenAI' });
    }

    let quiz;
    try {
      quiz = JSON.parse(content);
    } catch (e) {
      console.error('[quiz] Failed to parse JSON from OpenAI content:', e, content);
      return res.status(502).json({ error: 'Failed to parse quiz JSON from OpenAI' });
    }

    if (!quiz || typeof quiz !== 'object') {
      return res.status(502).json({ error: 'Quiz JSON malformed' });
    }

    const question = String(quiz.question || '').trim();
    let answers = Array.isArray(quiz.answers) ? quiz.answers : [];
    let correctIndex = Number.isInteger(quiz.correctIndex) ? quiz.correctIndex : 0;

    if (!question || answers.length !== 4) {
      return res.status(502).json({ error: 'Quiz missing question or answers' });
    }

    answers = answers.map(a => String(a || ''));

    if (correctIndex < 0 || correctIndex > 3) {
      correctIndex = 0;
    }

    const explanation = quiz.explanation ? String(quiz.explanation) : '';
    const outDifficulty = quiz.difficulty || difficulty;

    const payload = {
      question,
      answers,
      correctIndex,
      explanation,
      difficulty: outDifficulty
    };

    if (process.env.NODE_ENV !== 'production') {
      console.log('[quiz] Generated question:', JSON.stringify(payload, null, 2));
    }

    res.status(200).json(payload);
  } catch (err) {
    console.error('[quiz] Handler error:', err);
    res.status(500).json({ error: 'Unexpected server error' });
  }
}
