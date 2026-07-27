// app/api/refresh/route.js
// Phase 5: the endpoint Vercel's cron job hits on a schedule.
// Does exactly what a page load does — fetch feeds, analyze unseen stories,
// save to DB — but headless. Keeps the DB warm even when nobody visits,
// so the daily brief always has fresh material.
//
// Protected by CRON_SECRET: Vercel sends it automatically as a Bearer token
// on cron invocations. Without the header, strangers can't burn our AI quota.

import { timingSafeEqual } from "node:crypto";
import { fetchHeadlines } from "../../../lib/news";
import { analyzeHeadlines } from "../../../lib/ai";
import {
  getSavedAnalysis,
  saveArticles,
  splitBySaved,
  getRecentArticles,
  saveBrief,
} from "../../../lib/db";
import { generateBrief } from "../../../lib/brief";

// This route owns every slow operation: RSS fetching, LLM analysis, and brief
// generation. Pages only read the results, so a page render can never block on
// a network call or exceed the serverless timeout.
export const maxDuration = 60;

/** Constant-time string compare — avoids leaking the secret via response timing. */
function safeEqual(a, b) {
  const bufA = Buffer.from(a ?? "", "utf8");
  const bufB = Buffer.from(b ?? "", "utf8");
  // timingSafeEqual throws on length mismatch, so compare lengths separately.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");

  // Fail CLOSED. A missing CRON_SECRET previously disabled the check entirely,
  // so one deleted env var would have silently exposed an endpoint that spends
  // AI quota and writes to the database. Outside development, no secret = no service.
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return Response.json({ error: "refresh endpoint not configured" }, { status: 503 });
    }
  } else if (!safeEqual(auth, `Bearer ${secret}`)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const headlines = await fetchHeadlines(30);
  const saved = await getSavedAnalysis(headlines.map((h) => h.link));
  const { pending } = splitBySaved(headlines, saved);
  const fresh = pending.length > 0 ? await analyzeHeadlines(pending) : [];
  await saveArticles(pending, fresh);

  // Regenerate the daily brief from everything analyzed in the last 24h and
  // store it, so the home page can render it without an LLM round trip.
  const recent = await getRecentArticles(24);
  const brief = await generateBrief(recent);
  await saveBrief(brief);

  return Response.json({
    fetched: headlines.length,
    alreadyAnalyzed: saved.size,
    newlyAnalyzed: fresh ? pending.length : 0,
    aiOk: fresh !== null,
    briefUpdated: Boolean(brief),
  });
}
