# Waypoint — AI Travel Agent (agent-demo)

A minimal travel-agent website with a floating chat widget that replicates
the `agent-demo2.py` CLI: it asks the same intake questions (origin,
destination style, dates, budget, travelers, interests), sends the resulting
trip brief to Claude, and then continues as free-form follow-up chat — same
system prompt, same conversation shape, just in the browser instead of a
terminal.

## Why not run the actual .py file in the browser?

Vercel serverless functions are stateless, one-request-at-a-time — there's no
persistent process to attach a terminal/stdin to. Instead, `agent-demo2.py`'s
system prompt and conversation logic were ported into `api/chat.js`, a
stateless endpoint: the frontend keeps the message history (like the CLI's
`messages` list) and resends it each turn.

The backend is Node.js rather than Python: Vercel's current Python builder
treats the whole project as a single app and swallows every route (including
static assets), whereas Node.js functions use the standard per-file `/api`
convention and coexist cleanly with the static frontend files.

## Structure

```
index.html        Landing page + floating chat widget markup
style.css         Styling for the page and widget
app.js            Widget state machine (intake questions -> free chat)
api/chat.js       Vercel Node.js serverless function calling the Claude API
api/rag.js        Knowledge-base retrieval: chunk, embed (Voyage AI), cosine search
package.json      Node deps for the serverless function (@anthropic-ai/sdk)
vercel.json       Overrides the project's Framework Preset (set to null)
```

## Agentic RAG (policy knowledge base)

When `VOYAGE_API_KEY` and `KNOWLEDGE_BASE_URL` are set, Claude also gets a
`search_travel_policies` tool covering cancellation, baggage, and travel
insurance policy — the same knowledge base and tool the `agent-demo2.py` CLI
uses. It's *agentic* retrieval: Claude decides whether a question needs the
tool rather than every message being forced through it.

The knowledge base itself (`knowledge_base.md`) lives in Vercel Blob storage,
not in this repo — see `agent-demo2/knowledge_base.md` and
`agent-demo2/scripts/upload_knowledge_base.js` for the canonical source and
the upload script. If either env var is missing (or the knowledge base fails
to load), the site keeps working for trip planning; it just can't answer
policy questions.

## Local development

```
npm install -g vercel      # if not already installed
vercel login
npm install
vercel dev
```

`vercel dev` serves the static files and runs `api/chat.js` locally. It reads
environment variables from a local `.env` file (already gitignored) — create
one with:

```
ANTHROPIC_API_KEY=sk-ant-...
VOYAGE_API_KEY=pa-...
KNOWLEDGE_BASE_URL=https://<store>.public.blob.vercel-storage.com/knowledge_base.md
```

## Deploying

```
vercel                     # first run: links/creates the project
vercel env add ANTHROPIC_API_KEY production
vercel env add VOYAGE_API_KEY production
vercel env add KNOWLEDGE_BASE_URL production
vercel --prod
```

Every key is stored as a Vercel environment variable, never committed to git
or shipped to the client.
