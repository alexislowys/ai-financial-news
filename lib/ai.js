// lib/ai.js
// Phase 2: send headlines to an LLM, get back per-story analysis:
// { summary, sentiment (bullish|bearish|neutral), tickers }.
//
// We use the `openai` npm package but point it at Google's Gemini API, which
// exposes an OpenAI-compatible endpoint. Free tier, no card needed.
// Key comes from .env.local (GEMINI_API_KEY) — never hardcode it.
//
// Design: ONE batched API call for all headlines, not one call each.
// Free tier limits requests per minute, so batching is what keeps us inside it.

import OpenAI from "openai";

// flash-lite: the free tier allows far more requests/day than full flash
// (20/day), and headline tagging doesn't need the bigger model.
const MODEL = "gemini-2.5-flash-lite";

const VALID_SENTIMENTS = new Set(["bullish", "bearish", "neutral"]);

// ---------------------------------------------------------------------------
// Pure helpers (no network) — tested in lib/ai.test.js
// ---------------------------------------------------------------------------

/**
 * Build the prompt for a batch of headlines. Numbered list in, JSON array out.
 */
export function buildPrompt(items) {
  const list = items
    .map((item, i) => `${i + 1}. ${item.title} — ${item.snippet || "(no snippet)"}`)
    .join("\n");

  return `You are a financial news analyst. For EACH numbered story below, return:
- "summary": one factual sentence, max 25 words
- "sentiment": exactly one of "bullish", "bearish", "neutral" (market impact, not tone)
- "tickers": array of affected stock ticker symbols (e.g. ["AAPL"]), empty array if none

Respond with ONLY a JSON array of ${items.length} objects, in the same order as the stories. No markdown, no commentary.

Stories:
${list}`;
}

/**
 * Parse the LLM's reply into exactly `count` analysis objects.
 * LLMs sometimes wrap JSON in \`\`\` fences or return slightly-off data,
 * so we defend: strip fences, validate shape, coerce bad values to safe ones.
 * Returns null if the reply is unusable (caller then renders without analysis).
 */
export function parseAnalysis(text, count) {
  if (!text) return null;

  // Strip markdown code fences if present: ```json ... ```
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

  let data;
  try {
    data = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length !== count) return null;

  return data.map((entry) => ({
    summary: typeof entry?.summary === "string" ? entry.summary.slice(0, 300) : "",
    sentiment: VALID_SENTIMENTS.has(entry?.sentiment) ? entry.sentiment : "neutral",
    tickers: Array.isArray(entry?.tickers)
      ? entry.tickers.filter((t) => typeof t === "string").map((t) => t.toUpperCase()).slice(0, 6)
      : [],
  }));
}

// ---------------------------------------------------------------------------
// Network call
// ---------------------------------------------------------------------------

// In-memory cache: if the same set of headlines is analyzed again within TTL,
// reuse the previous result instead of calling the API. Matters because dev
// mode re-renders per request — without this, health-check pings alone would
// burn the free-tier request quota. Phase 3 replaces this with the DB.
const CACHE_TTL_MS = 5 * 60 * 1000; // successful result
const FAIL_TTL_MS = 60 * 1000; // failed call — retry sooner, rate limits reset per minute
let cache = { key: null, at: 0, result: null };

/**
 * Analyze a batch of headlines. Returns an array parallel to `items`
 * (same order, same length), or null if no API key / the call failed.
 * Null means "render the page without sentiment" — never crash the page.
 */
export async function analyzeHeadlines(items) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || items.length === 0) return null;

  const key = items.map((i) => i.title).join("|");
  const fresh = Date.now() - cache.at;
  // Success: reuse only for the same headline set. Failure: block ALL retries
  // for a minute regardless of key — new headlines arriving must not bypass
  // the cooldown and re-hammer a rate-limited API.
  if (cache.result && cache.key === key && fresh < CACHE_TTL_MS) return cache.result;
  if (!cache.result && cache.at > 0 && fresh < FAIL_TTL_MS) return null;

  const client = new OpenAI({
    apiKey,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  });

  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: buildPrompt(items) }],
      temperature: 0.2, // low = consistent labels, not creative writing
    });
    const result = parseAnalysis(res.choices[0]?.message?.content, items.length);
    if (result) cache = { key, at: Date.now(), result };
    return result;
  } catch (err) {
    console.error("AI analysis failed:", err.message);
    // Cache the failure briefly too — otherwise every render retries and
    // hammers an already rate-limited API, making the 429 worse.
    cache = { key, at: Date.now(), result: null };
    return null;
  }
}
