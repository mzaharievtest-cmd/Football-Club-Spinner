// api/quiz.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { mode, kind, payload, difficulty } = req.body || {};

    if (!mode || !payload || (!payload.team && !payload.player)) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY on server' });
    }

    const subject =
      mode === 'player'
        ? `a football player: ${payload.player?.name || payload.player?.team_name || 'unknown'}`
        : `a football club: ${payload.team?.name || payload.team?.team_name || 'unknown'}`;

    const extraContext =
      mode === 'player'
        ? `Club: ${payload.player?.clubName || ''}, Nationality: ${payload.player?.nationality || ''}, Shirt number: ${payload.player?.jersey || ''}`
        : `League: ${payload.team?.league || payload.team?.league_code || ''}, Country: ${payload.team?.country || ''}`;

    const diffLabel = difficulty || 'normal';

    const prompt = `
Generate one multiple-choice football quiz question about ${subject}.
Use any *real* football knowledge you have (past and present, players, titles, rivalries, stadium, legends, etc.).

Context from the app:
${extraContext}

The question:
- Must have exactly 4 options labelled A, B, C, D.
- Only ONE correct answer.
- Answers must be short (max ~40 characters).
- Difficulty: ${diffLabel} (easy/normal/hard).

Respond as strict JSON, NO extra text, in this shape:

{
  "question": "...",
  "options": [
    {"label":"A","text":"..."},
    {"label":"B","text":"..."},
    {"label":"C","text":"..."},
    {"label":"D","text":"..."}
  ],
  "correct": "A",
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
          { role: 'system', content: 'You are a football trivia generator.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.9,
        max_tokens: 400
      })
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text().catch(() => '');
      console.error('OpenAI error:', openaiRes.status, errText);
      return res.status(502).json({ error: 'OpenAI API error' });
    }

    const data = await openaiRes.json();
    const content = data.choices?.[0]?.message?.content || '';

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error('Parsing error, raw content:', content);
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
