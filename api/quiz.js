// /api/quiz.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { mode, difficulty = "auto", context } = req.body || {};
    const kind = context?.kind || (mode === "player" ? "player" : "club");

    const diffText =
      difficulty === "easy" ? "easy" :
      difficulty === "hard" ? "hard" : "medium";

    const systemPrompt = `
You are a football quiz generator.
Return ONE multiple-choice question (football knowledge) about the given club or player.
Output strictly JSON with:
{
  "question": "string",
  "answers": ["a","b","c","d"],
  "correctIndex": 0,
  "explanation": "short explanation"
}
No extra text.`;

    const userContext =
      kind === "player"
        ? `Player: ${context.name}
Team: ${context.clubName}
League: ${context.league}
Nationality: ${context.nationality || "unknown"}
Jersey: ${context.jersey || "-"}`
        : `Club: ${context.name}
League: ${context.leagueName || context.leagueCode}
Stadium: ${context.stadium || "unknown"}`;

    const userPrompt = `
Make a ${diffText} difficulty question about this ${kind}.

Constraints:
- Only one correct answer, 3 wrong options.
- Answers should be short (max ~50 characters).
- Do NOT mention that an AI is generating the question.

Context:
${userContext}
`;

    const completion = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      max_output_tokens: 250,
    });

    const raw =
      completion.output[0]?.content[0]?.text ||
      completion.output[0]?.content[0]?.value ||
      "";

    let payload = {};
    try {
      payload = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (e) {
      console.error("JSON parse error", e, raw);
      return res.status(500).json({ error: "Bad JSON from model" });
    }

    // Minimal sanity
    if (!Array.isArray(payload.answers) || payload.answers.length !== 4) {
      return res.status(500).json({ error: "Invalid answer array" });
    }
    if (typeof payload.correctIndex !== "number") {
      payload.correctIndex = 0;
    }

    return res.status(200).json({
      question: payload.question,
      answers: payload.answers.slice(0, 4),
      correctIndex: payload.correctIndex,
      explanation: payload.explanation || null,
    });
  } catch (err) {
    console.error("Quiz API error", err);
    return res.status(500).json({ error: "Quiz generation failed" });
  }
}
