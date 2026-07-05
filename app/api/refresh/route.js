// app/api/refresh/route.js
// Phase 5: the endpoint Vercel's cron job hits on a schedule.
// Does exactly what a page load does — fetch feeds, analyze unseen stories,
// save to DB — but headless. Keeps the DB warm even when nobody visits,
// so the daily brief always has fresh material.
//
// Protected by CRON_SECRET: Vercel sends it automatically as a Bearer token
// on cron invocations. Without the header, strangers can't burn our AI quota.

import { fetchHeadlines } from "../../../lib/news";
import { analyzeHeadlines } from "../../../lib/ai";
import { getSavedAnalysis, saveArticles, splitBySaved } from "../../../lib/db";

export async function GET(request) {
  // Reject if a secret is configured and the caller doesn't present it.
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const headlines = await fetchHeadlines(30);
  const saved = await getSavedAnalysis(headlines.map((h) => h.link));
  const { pending } = splitBySaved(headlines, saved);
  const fresh = pending.length > 0 ? await analyzeHeadlines(pending) : [];
  await saveArticles(pending, fresh);

  return Response.json({
    fetched: headlines.length,
    alreadyAnalyzed: saved.size,
    newlyAnalyzed: fresh ? pending.length : 0,
    aiOk: fresh !== null,
  });
}
