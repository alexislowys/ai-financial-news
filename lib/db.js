// lib/db.js
// Phase 3: PostgreSQL persistence (Neon free tier).
//
// The point: analysis costs an API call. Once a story is analyzed, save it.
// Next page load reads the saved result instead of paying again.
// Key insight: an article's link is its identity — UNIQUE constraint on it.
//
// No DATABASE_URL set? Every function no-ops safely and the app behaves
// like Phase 2 (in-memory cache only). Nothing crashes.

import { neon } from "@neondatabase/serverless";

function getClient() {
  const url = process.env.DATABASE_URL;
  return url ? neon(url) : null;
}

// Create the table on first use. Module-level promise = runs once per process,
// concurrent requests await the same promise instead of racing.
let ready = null;
function ensureTable(sql) {
  if (!ready) {
    ready = sql`
      CREATE TABLE IF NOT EXISTS articles (
        id           SERIAL PRIMARY KEY,
        link         TEXT UNIQUE NOT NULL,
        title        TEXT NOT NULL,
        source       TEXT,
        published_at TIMESTAMPTZ,
        summary      TEXT,
        sentiment    TEXT,
        tickers      TEXT[],
        created_at   TIMESTAMPTZ DEFAULT now()
      )`;
  }
  return ready;
}

/**
 * Look up saved analysis for a list of article links.
 * Returns Map(link -> { summary, sentiment, tickers }). Empty Map without DB.
 */
export async function getSavedAnalysis(links) {
  const sql = getClient();
  if (!sql || links.length === 0) return new Map();

  try {
    await ensureTable(sql);
    const rows = await sql`
      SELECT link, summary, sentiment, tickers
      FROM articles
      WHERE link = ANY(${links})`;
    return new Map(
      rows.map((r) => [
        r.link,
        { summary: r.summary, sentiment: r.sentiment, tickers: r.tickers ?? [] },
      ])
    );
  } catch (err) {
    console.error("DB read failed:", err.message);
    return new Map();
  }
}

/**
 * Save freshly analyzed articles. ON CONFLICT DO NOTHING = a story that
 * sneaked in from a parallel request is silently skipped, not duplicated.
 */
export async function saveArticles(items, analysis) {
  const sql = getClient();
  if (!sql || !analysis || items.length === 0) return;

  try {
    await ensureTable(sql);
    // One INSERT per article. Fine at 30 items; batch if this ever grows.
    await Promise.all(
      items.map((item, i) => {
        const a = analysis[i];
        if (!a) return null;
        return sql`
          INSERT INTO articles (link, title, source, published_at, summary, sentiment, tickers)
          VALUES (${item.link}, ${item.title}, ${item.source},
                  ${item.publishedAt}, ${a.summary}, ${a.sentiment}, ${a.tickers})
          ON CONFLICT (link) DO NOTHING`;
      })
    );
  } catch (err) {
    console.error("DB write failed:", err.message);
  }
}

/**
 * Articles analyzed in the last `hours` (default 24) — feeds the daily brief.
 * Empty array without a DB.
 */
export async function getRecentArticles(hours = 24) {
  const sql = getClient();
  if (!sql) return [];

  try {
    await ensureTable(sql);
    return await sql`
      SELECT title, summary, sentiment, tickers
      FROM articles
      WHERE created_at > now() - make_interval(hours => ${hours})
      ORDER BY created_at DESC
      LIMIT 60`;
  } catch (err) {
    console.error("DB read failed:", err.message);
    return [];
  }
}

/**
 * Pure helper (no network): split headlines into ones we already have
 * analysis for vs ones that still need the AI call.
 * `saved` is the Map from getSavedAnalysis.
 */
export function splitBySaved(headlines, saved) {
  const done = [];
  const pending = [];
  for (const h of headlines) {
    if (saved.has(h.link)) done.push(h);
    else pending.push(h);
  }
  return { done, pending };
}

/**
 * Pure helper: build the per-headline analysis array the page renders from,
 * combining saved results and fresh AI results (parallel to `pending`).
 * Returns array aligned with `headlines`; entries may be null (no analysis).
 */
export function mergeAnalysis(headlines, saved, pending, freshAnalysis) {
  const freshByLink = new Map();
  if (freshAnalysis) {
    pending.forEach((h, i) => {
      if (freshAnalysis[i]) freshByLink.set(h.link, freshAnalysis[i]);
    });
  }
  return headlines.map(
    (h) => saved.get(h.link) ?? freshByLink.get(h.link) ?? null
  );
}
