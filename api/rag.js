// Minimal retrieval module for the travel-policy knowledge base — the JS
// mirror of agent-demo2/rag.py. Fetches knowledge_base.md from its Vercel
// Blob URL, chunks it along its markdown headings, embeds each chunk with
// Voyage AI (via direct REST call — no SDK dependency needed), and answers
// similarity searches with plain cosine similarity.
//
// Embeddings are cached at module scope, which Vercel keeps alive across
// warm invocations of the same function instance, so a typical run of
// consecutive requests only embeds once per cold start rather than once
// per request.

const EMBED_MODEL = "voyage-4-large";
const VOYAGE_EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings";

export function chunkMarkdown(text) {
  const chunks = [];
  let currentH2 = "";
  let currentH3 = "";
  let currentLines = [];

  const flush = () => {
    const content = currentLines.join("\n").trim();
    if (!content) return;
    const heading = [currentH2, currentH3].filter(Boolean).join(" > ");
    const textWithHeading = heading ? `${heading}\n${content}` : content;
    chunks.push({ heading, text: textWithHeading });
  };

  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("<!--")) continue;
    if (line.startsWith("# ") && !line.startsWith("## ")) continue; // skip H1 title
    if (line.startsWith("## ") && !line.startsWith("### ")) {
      flush();
      currentH2 = line.slice(3).trim();
      currentH3 = "";
      currentLines = [];
    } else if (line.startsWith("### ")) {
      flush();
      currentH3 = line.slice(4).trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  flush();
  return chunks;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function embed(texts, inputType, apiKey) {
  const res = await fetch(VOYAGE_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts, input_type: inputType }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage embeddings request failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
}

let cache = null; // { sourceUrl, chunks, embeddings }

export async function loadKnowledgeBase(sourceUrl, apiKey, blobToken) {
  if (cache && cache.sourceUrl === sourceUrl) {
    return cache;
  }
  // The knowledge base lives in a private Vercel Blob store — reads need
  // the same bearer token as writes, not just a plain GET.
  const headers = blobToken ? { Authorization: `Bearer ${blobToken}` } : {};
  const res = await fetch(sourceUrl, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch knowledge base (${res.status})`);
  }
  const text = await res.text();
  const chunks = chunkMarkdown(text);
  if (chunks.length === 0) {
    throw new Error("Knowledge base document has no chunkable '### ' sections");
  }
  const embeddings = await embed(
    chunks.map((c) => c.text),
    "document",
    apiKey
  );
  cache = { sourceUrl, chunks, embeddings };
  return cache;
}

export async function searchKnowledgeBase(kb, query, apiKey, k = 3) {
  const [queryEmbedding] = await embed([query], "query", apiKey);
  const scored = kb.chunks
    .map((chunk, i) => ({ chunk, score: cosineSimilarity(queryEmbedding, kb.embeddings[i]) }))
    .sort((a, b) => b.score - a.score);
  return scored
    .slice(0, k)
    .map((s) => s.chunk.text)
    .join("\n\n---\n\n");
}
