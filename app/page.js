// app/page.js
// Server component: fetches news, runs AI analysis (DB-cached), and renders.
//
// Phase 4 additions:
// - Daily brief: one LLM digest of the last 24h of analyzed articles.
// - Sentiment bar: today's bullish/bearish/neutral ratio at a glance.
// - Ticker filter: click a ticker tag to see only that ticker's stories
//   (?ticker=AAPL in the URL — server component reads searchParams).

import Link from "next/link";
import { fetchHeadlines } from "../lib/news";
import { analyzeHeadlines } from "../lib/ai";
import {
  getSavedAnalysis,
  saveArticles,
  splitBySaved,
  mergeAnalysis,
  getRecentArticles,
} from "../lib/db";
import { generateBrief, sentimentCounts } from "../lib/brief";

// Re-fetch feeds at most every 5 minutes (Next.js caches the page in between).
export const revalidate = 300;

function timeAgo(dateString) {
  if (!dateString) return "";
  const mins = Math.floor((Date.now() - new Date(dateString)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function SentimentBar({ counts }) {
  const total = counts.bullish + counts.bearish + counts.neutral;
  if (total === 0) return null;
  const pct = (n) => `${(n / total) * 100}%`;
  return (
    <div className="sentiment-overview">
      <div className="sentiment-bar">
        <div className="bar-bullish" style={{ width: pct(counts.bullish) }} />
        <div className="bar-neutral" style={{ width: pct(counts.neutral) }} />
        <div className="bar-bearish" style={{ width: pct(counts.bearish) }} />
      </div>
      <div className="sentiment-legend">
        <span className="tag tag-bullish">{counts.bullish} bullish</span>
        <span className="tag tag-neutral">{counts.neutral} neutral</span>
        <span className="tag tag-bearish">{counts.bearish} bearish</span>
      </div>
    </div>
  );
}

export default async function Home({ searchParams }) {
  const { ticker } = await searchParams;
  const headlines = await fetchHeadlines(30);

  // Phase 3 flow: check DB first, only send UNSEEN stories to the AI.
  const saved = await getSavedAnalysis(headlines.map((h) => h.link));
  const { pending } = splitBySaved(headlines, saved);
  const fresh = pending.length > 0 ? await analyzeHeadlines(pending) : [];
  await saveArticles(pending, fresh);
  const analysis = mergeAnalysis(headlines, saved, pending, fresh);
  const hasAnalysis = analysis.some(Boolean);

  // Phase 4: brief + sentiment ratio from the last 24h of stored articles.
  // Falls back to the current page's analysis when the DB is empty/absent.
  const recent = await getRecentArticles(24);
  const briefSource = recent.length > 0 ? recent : analysis.filter(Boolean);
  const [brief, counts] = [
    await generateBrief(briefSource),
    sentimentCounts(briefSource),
  ];

  // Ticker filter: keep only rows whose analysis mentions the ticker.
  const rows = headlines
    .map((item, i) => ({ item, ai: analysis[i] }))
    .filter(
      (r) => !ticker || r.ai?.tickers.includes(ticker.toUpperCase())
    );

  return (
    <main className="container">
      <header>
        <h1>AI Financial News Summarizer</h1>
        <p className="subtitle">
          Live market headlines with AI summaries &amp; sentiment.
          {!hasAnalysis && " (AI analysis off — set GEMINI_API_KEY in .env.local)"}
        </p>
        {/* Plain GET form — /search normalizes and redirects to /stock/TICKER */}
        <form action="/search" className="search-form">
          <input
            type="text"
            name="q"
            placeholder="Find a stock… (e.g. AAPL)"
            maxLength={10}
            autoComplete="off"
          />
          <button type="submit">Search</button>
        </form>
      </header>

      {brief && (
        <section className="brief">
          <h2>Today&apos;s market brief</h2>
          <p>{brief}</p>
          <SentimentBar counts={counts} />
        </section>
      )}

      {ticker && (
        <p className="filter-notice">
          Showing stories tagged <strong>{ticker.toUpperCase()}</strong> ·{" "}
          <Link href="/">clear filter</Link>
        </p>
      )}

      <ul className="news-list">
        {rows.map(({ item, ai }) => (
          <li key={item.link} className="card">
            <div className="meta">
              <span className="source">{item.source}</span>
              <span className="time">{timeAgo(item.publishedAt)}</span>
              {ai && (
                <span className={`tag tag-${ai.sentiment}`}>{ai.sentiment}</span>
              )}
              {ai?.tickers.map((t) => (
                <Link key={t} href={`/stock/${t}`} className="tag tag-ticker">
                  {t}
                </Link>
              ))}
            </div>
            <a href={item.link} target="_blank" rel="noopener noreferrer">
              {item.title}
            </a>
            <p className="snippet">{ai?.summary || item.snippet}</p>
          </li>
        ))}
      </ul>

      {rows.length === 0 && (
        <p>
          {ticker
            ? `No current stories tagged ${ticker.toUpperCase()}.`
            : "No headlines loaded — check your internet connection and refresh."}
        </p>
      )}
    </main>
  );
}
