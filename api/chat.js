// Vercel Node.js serverless function backing the floating travel-agent
// chat widget. Ports agent-demo2.py's system prompt and conversation
// behavior into a stateless HTTP endpoint: the client sends the full
// message history each turn (same shape the CLI keeps in memory), and
// this function calls Claude and returns the reply.

import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-opus-4-8";
const MAX_TOKENS = 4096;

const SYSTEM_PROMPT = `You are an experienced, friendly travel agent. A user will give you their \
trip preferences (origin, destination style, dates/duration, budget, group \
size, and interests). Using that information:

1. Suggest 2-4 specific destinations that fit the brief, with a one- or \
   two-sentence reason for each.
2. For the destination(s) most likely to be chosen, sketch a rough day-by-day \
   itinerary outline and note the best time of year to visit if relevant.
3. Give flight guidance: likely route/connections from their origin, roughly \
   how far in advance to book, typical price range for the dates given, and \
   which airlines or booking strategies tend to work well for that route. You \
   don't have live flight data, so be explicit that prices are ballpark and \
   the user should confirm on a booking site (Google Flights, airline sites, \
   etc.) before purchasing.
4. Flag any practical considerations: visas, weather, budget fit, or booking \
   lead time.

Keep the response well-organized with headers, but don't pad it — be concrete \
and specific rather than generic. After your initial plan, continue the \
conversation naturally, refining suggestions as the user gives feedback.`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("messages must be a non-empty array");
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured on the server");
    }

    const client = new Anthropic({ apiKey });
    const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
    });

    const reply = response.content.find((b) => b.type === "text")?.text ?? "";
    res.status(200).json({ reply });
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? 502 : 400;
    res.status(status).json({ error: err.message });
  }
}
