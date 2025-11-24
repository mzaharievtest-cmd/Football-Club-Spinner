// api/quiz.js
// Vercel Node serverless function: generates a football quiz question using OpenAI.
//
// IMPORTANT:
// - Set OPENAI_API_KEY in your Vercel project settings (Environment Variables).
// - Front-end calls: POST /api/quiz with JSON { mode, difficulty, category, context }.

export const config = {
  runtime: 'nodejs',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY on server' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { mode, difficulty = 'auto', category = 'mixed', context = {} } = body;

    const safeMode = mode === 'player' ? 'player' : 'team';
    const safeDifficulty = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'auto';

    const diffText =
      safeDifficulty === 'easy'
        ? 'EASY: basic facts most casual fans know.'
        : safeDifficulty === 'medium'
        ? 'MEDIUM: solid fan knowledge, but not super obscure.'
        : safeDifficulty === 'hard'
        ? 'HARD: advanced / hardcore fan knowledge, but still answerable.'
        : 'AUTO: pick a difficulty based on how famous this club/player is.';

    const categoryText =
      category === 'club'
        ? 'Focus on facts about the CLUB itself (history, trophies, nicknames, colours, legends, rivalries). Avoid only asking about the stadium; vary the angles.'
        : category === 'player'
        ? 'Focus on PLAYER-specific facts (position, achievements, stats, transfers, records, nationality, shirt numbers).'
        : category === 'manager'
        ? 'Focus on MANAGERS and coaching history (famous managers, key seasons, tactics, titles under specific managers).'
        : category === 'history'
        ? 'Focus on historical achievements (titles, iconic seasons, finals, famous matches, records).'
        : category === 'fans'
        ? 'Focus on fans, rivalries and derbies (fan culture, rivalries, derbies, atmospheres, chants).'
        : 'Category is MIXED. You MUST NOT ask about the home stadium or which stadium is the home ground. Use other aspects (trophies, years, nicknames, rivalries, positions, records, nationality, etc.).';

    const userContext = {
      mode: safeMode,
      difficulty: safeDifficulty,
      category,
      context,
    };

    const prompt = `
You are a football (soccer) quiz generator.

You receive structured context for a club or a player and must create ONE multiple-choice question with EXACTLY 4 answer options.

VERY IMPORTANT VARIETY RULES:
- You MUST NOT always ask about the stadium or "Which stadium is the home ground of X".
- If category = "mixed", you are FORBIDDEN to ask any question about stadiums or home grounds.
- Even when a stadium is mentioned in the context, you should prefer OTHER aspects:
  - For clubs: trophies, years, famous players, nicknames, rivalries, league performance, colours, records, European competitions, etc.
  - For players: position, nationality, shirt number, clubs played for, awards, goals, notable seasons, records, national team, etc.
- You should vary the wording and topic from call to call: not the same template, not always "Which of the following ... ?".

GENERAL RULES:
- The question MUST be about real-world football and be factually correct.
- Use the provided context if it is useful, but you may also rely on your football knowledge.
- Make sure exactly ONE correct answer exists.
- The wrong answers must be plausible but clearly incorrect.
- The question must be self-contained (do NOT say "this team"; use the actual club/player name).
- Return EXACTLY ONE question.

OUTPUT FORMAT (STRICT JSON, NO EXTRA TEXT):
You MUST respond with VALID JSON ONLY in this exact shape:

{
  "question": "string",
  "answers": ["A", "B", "C", "D"],
  "correctIndex": 0,
  "explanation": "string"
}

Where:
- "question": a single quiz question about football.
- "answers": array of 4 distinct answer strings.
- "correctIndex": integer 0–3, index into the answers array.
- "explanation": short explanation (1–2 sentences) why the answer is correct.

DIFFICULTY:
${diffText}

CATEGORY:
${categoryText}

CONTEXT (JSON):
${JSON.stringify(userContext, null, 2)}

EXAMPLES (DO NOT REUSE THESE EXACT WORDINGS, THEY ARE ONLY STYLE EXAMPLES):

Example 1 (club, mixed topic):
{
  "question": "Which nickname is commonly associated with Arsenal Football Club?",
  "answers": ["The Gunners", "The Magpies", "The Citizens", "The Reds"],
  "correctIndex": 0,
  "explanation": "Arsenal are famously known as 'The Gunners' due to the club's historical ties to the Royal Arsenal in Woolwich."
}

Example 2 (player, stats/position):
{
  "question": "Which of the following positions best describes Kevin De Bruyne?",
  "answers": ["Central attacking midfielder", "Goalkeeper", "Centre-back", "Left winger"],
  "correctIndex": 0,
  "explanation": "Kevin De Bruyne is primarily known as a central attacking midfielder who creates chances and dictates play."
}

Example 3 (club history, trophies):
{
  "question": "Which competition has Liverpool won the most times?",
  "answers": ["UEFA Champions League", "Premier League", "FA Cup", "League Cup"],
  "correctIndex": 0,
  "explanation": "Liverpool have a rich European history and have lifted the European Cup/Champions League multiple times."
}
`.trim();

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a strict JSON-only responder. Always return ONLY valid JSON with no extra text.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.85,
      }),
    });

    if (!openaiRes.ok) {
      const text = await openaiRes.text().catch(() => '');
      console.error('OpenAI error:', openaiRes.status, text);
      return res.status(500).json({ error: 'OpenAI request failed', status: openaiRes.status });
    }

    const data = await openaiRes.json();
    const content = data?.choices?.[0]?.message?.content?.trim();

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.error('Failed to parse JSON from OpenAI:', err, content);
      return res.status(500).json({ error: 'Invalid JSON returned from OpenAI' });
    }

    if (
      !parsed ||
      typeof parsed.question !== 'string' ||
      !Array.isArray(parsed.answers) ||
      parsed.answers.length !== 4 ||
      typeof parsed.correctIndex !== 'number'
    ) {
      return res.status(500).json({ error: 'Malformed quiz JSON from OpenAI' });
    }

    return res.status(200).json({
      question: parsed.question,
      answers: parsed.answers,
      correctIndex: parsed.correctIndex,
      explanation: parsed.explanation || '',
    });
  } catch (err) {
    console.error('Server /api/quiz error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
