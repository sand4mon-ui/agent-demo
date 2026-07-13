// Vercel Node.js serverless function backing the floating travel-agent
// chat widget. Ports agent-demo2.py's system prompt and conversation
// behavior into a stateless HTTP endpoint: the client sends the full
// message history each turn (same shape the CLI keeps in memory), and
// this function calls Claude and returns the reply.
//
// When VOYAGE_API_KEY and KNOWLEDGE_BASE_URL are configured, Claude also
// gets a search_travel_policies tool (Agentic RAG: Claude decides if/when
// a question needs the cancellation/baggage/insurance knowledge base,
// rather than every message being forced through retrieval). The tool-use
// round trip happens entirely inside this one request/response cycle —
// the browser only ever sees the final text reply, never the raw tool
// calls, so the client's conversation history stays plain text turns.

import Anthropic from "@anthropic-ai/sdk";
import { loadKnowledgeBase, searchKnowledgeBase } from "./rag.js";

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
conversation naturally, refining suggestions as the user gives feedback.

You also have a search_travel_policies tool that searches this operator's \
official cancellation, baggage, and travel-insurance policy documents. Use \
it whenever the user asks about cancelling or changing a booking, refunds, \
baggage allowances or fees, lost or delayed luggage, or travel insurance \
coverage — don't answer those questions from general knowledge, since \
policies vary by operator. Cite what the retrieved policy text actually \
says rather than paraphrasing loosely, and say so plainly if the retrieved \
text doesn't answer the question.`;

const SEARCH_TOOL = {
  name: "search_travel_policies",
  description:
    "Search the operator's official cancellation, baggage, and " +
    "travel-insurance policy documents. Call this whenever the user asks " +
    "about cancelling/changing a booking, refunds, baggage allowances or " +
    "fees, lost or delayed luggage, or travel insurance coverage.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "A short, specific question to search the policy documents for, " +
          "e.g. 'refund for cancellation 48 hours before departure'.",
      },
    },
    required: ["query"],
  },
};

async function runConversationTurn(client, model, messages, tools, kb, voyageApiKey) {
  while (true) {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      return response.content.find((b) => b.type === "text")?.text ?? "";
    }

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      let resultText;
      if (block.name === "search_travel_policies" && kb) {
        resultText = await searchKnowledgeBase(kb, block.input?.query ?? "", voyageApiKey);
      } else if (block.name === "search_travel_policies") {
        resultText = "The policy knowledge base is not configured right now.";
      } else {
        resultText = `Unknown tool: ${block.name}`;
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
    }
    messages.push({ role: "user", content: toolResults });
  }
}

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

    const voyageApiKey = process.env.VOYAGE_API_KEY;
    const kbUrl = process.env.KNOWLEDGE_BASE_URL;
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    let kb = null;
    let tools = [];
    if (voyageApiKey && kbUrl) {
      try {
        kb = await loadKnowledgeBase(kbUrl, voyageApiKey, blobToken);
        tools = [SEARCH_TOOL];
      } catch (err) {
        console.warn(`Knowledge base unavailable, continuing without it: ${err.message}`);
      }
    }

    const client = new Anthropic({ apiKey });
    const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

    const reply = await runConversationTurn(client, model, messages, tools, kb, voyageApiKey);
    res.status(200).json({ reply });
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? 502 : 400;
    res.status(status).json({ error: err.message });
  }
}
