// lib/brief.js
// Phase 4: the daily market brief — one LLM call that digests the last 24h
// of ALREADY-ANALYZED articles (from the DB) into a short "what moved markets
// today" paragraph. No re-analysis: input is our stored summaries, so this
// costs one call per cache window regardless of article count.

import OpenAI from "openai";

// Same model as lib/ai.js — free tier gives flash-lite far more requests/day.
const MODEL = "gemini-2.5-flash-lite";

// One brief per ~30 min is plenty. Keyed by date + article count so a burst
// of new stories invalidates it early.
const BRIEF_TTL_MS = 30 * 60 * 1000;
// After a FAILED call, block retries for a minute NO MATTER what the key is —
// otherwise every article saved changes the key and re-hammers a rate-limited
// API on each render.
const FAIL_TTL_MS = 60 * 1000;
let cache = { key: null, at: 0, text: null };

// ---------------------------------------------------------------------------
// Pure helpers (tested in lib/brief.test.js)
// ---------------------------------------------------------------------------

/**
 * Count sentiments for the overview bar.
 * Accepts anything with a `sentiment` field; unknown values count as neutral.
 */
export function sentimentCounts(entries) {
  const counts = { bullish: 0, bearish: 0, neutral: 0 };
  for (const e of entries) {
    if (!e) continue;
    counts[e.sentiment in counts ? e.sentiment : "neutral"]++;
  }
  return counts;
}

/**
 * Build the digest prompt from stored article rows.
 */
export function buildBriefPrompt(articles) {
  const list = articles
    .map((a) => `- [${a.sentiment}] ${a.title}: ${a.summary}`)
    .join("\n");

  return `You are a financial news analyst writing a daily market brief.
Below are today's analyzed stories with sentiment labels.

Write ONE paragraph (max 120 words) summarizing what moved markets today:
the dominant themes, notable movers, and overall mood. Plain text only,
no markdown, no preamble like "Here is the brief".

Stories:
${list}`;
}

// ---------------------------------------------------------------------------
// Network call
// ---------------------------------------------------------------------------

/**
 * Generate (or reuse) today's brief. Returns a string or null (no key,
 * no articles, or the call failed — page renders without the brief box).
 */
export async function generateBrief(articles) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || articles.length === 0) return null;

  const key = `${new Date().toDateString()}:${articles.length}`;
  const fresh = Date.now() - cache.at;
  if (cache.text && cache.key === key && fresh < BRIEF_TTL_MS) return cache.text;
  if (!cache.text && cache.at > 0 && fresh < FAIL_TTL_MS) return null;

  const client = new OpenAI({
    apiKey,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  });

  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: buildBriefPrompt(articles) }],
      temperature: 0.4,
    });
    const text = res.choices[0]?.message?.content?.trim() || null;
    cache = { key, at: Date.now(), text };
    return text;
  } catch (err) {
    console.error("Brief generation failed:", err.message);
    cache = { key, at: Date.now(), text: null };
    return null;
  }
}
