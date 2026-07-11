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
system prompt and conversation logic were ported into `api/chat.py`, a
stateless endpoint: the frontend keeps the message history (like the CLI's
`messages` list) and resends it each turn.

## Structure

```
index.html      Landing page + floating chat widget markup
style.css       Styling for the page and widget
app.js          Widget state machine (intake questions -> free chat)
api/chat.py     Vercel Python serverless function calling the Claude API
requirements.txt  Python deps for the serverless function (anthropic)
vercel.json     Pins the Python runtime for api/chat.py
```

## Local development

```
npm install -g vercel      # if not already installed
vercel login
vercel dev
```

`vercel dev` serves the static files and runs `api/chat.py` locally. It reads
environment variables from a local `.env` file (already gitignored) — create
one with:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Deploying

```
vercel                     # first run: links/creates the project
vercel env add ANTHROPIC_API_KEY production
vercel --prod
```

The API key is stored as a Vercel environment variable, never committed to
git or shipped to the client.
