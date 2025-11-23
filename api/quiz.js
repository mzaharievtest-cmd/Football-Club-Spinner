// api/quiz.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { mode, difficulty, context } = req.body || {};

    if (!mode || !context || !context.kind) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY missing on server' });
    }

    const kind = context.kind; // "player" or "club"

    let subject = '';
    let extra = '';

    if (kind === 'player') {
      subject = `a football player: ${context.name || 'unknown player'}`;
      extra = `
Club: ${context.clubName || ''}
League: ${context.league || 'Premier League'}
Nationality: ${context.nationality || ''}
Shirt number: ${context.jersey || ''}
      `.trim();
    } else {
      subject = `a football club: ${context.name || 'unknown club'}`;
      extra = `
League: ${context.leagueName || context.leagueCode || ''}
Stadium: ${context.stadium || ''}
      `.trim();
    }

    const diffLabel = difficulty === 'easy' || difficulty === 'hard'
      ? difficulty
      : 'normal';

    const prompt = `
Generate ONE multiple-choice football quiz question about ${subject}.
Use real football knowledge (history, titles, rivalries, legends, managers, etc.).

Extra context from the app (optional, don't repeat it literally if not needed):
${extra}

Rules:
- Exactly ONE question.
- Exactly FOUR answers.
- Only ONE correct answer.
- Answers must be short (max ~40 characters).
- Difficulty: ${diffLabel} (easy / normal / hard).
- Make it interesting for football fans.

Respond as STRICT JSON, NO extra text, in this shape:

{
  "question": "...",
  "answers": ["...", "...", "...", "..."],
  "correctIndex": 0,
  "explanation": "Short one-sentence explanation."
}
`;

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: 'You are a precise football trivia generator that always returns valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.9,
        max_tokens: 400
      })
    });

    if (!openaiRes.ok) {
      const txt = await openaiRes.text().catch(() => '');
      console.error('OpenAI error:', openaiRes.status, txt);
      return res.status(502).json({ error: 'OpenAI API error' });
    }

    const data = await openaiRes.json();
    const content = data.choices?.[0]?.message?.content || '';

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error('Failed to parse AI JSON. Raw content:', content);
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    // Basic sanity checks / fallback
    if (
      !parsed ||
      typeof parsed.question !== 'string' ||
      !Array.isArray(parsed.answers) ||
      parsed.answers.length !== 4 ||
      typeof parsed.correctIndex !== 'number'
    ) {
      console.error('Invalid quiz JSON from AI:', parsed);
      return res.status(500).json({ error: 'AI returned invalid quiz format' });
    }

    const safe = {
      question: parsed.question,
      answers: parsed.answers.slice(0, 4).map(String),
      correctIndex: Math.max(0, Math.min(3, parsed.correctIndex | 0)),
      explanation: parsed.explanation || ''
    };

    return res.status(200).json(safe);
  } catch (err) {
    console.error('Quiz handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
