// app/page.js
// Server component that renders the news feed, the stored daily brief, and
// today's sentiment ratio — entirely from the database.
//
// Read/write split: /api/refresh (cron) does all the slow work — RSS fetching,
// LLM analysis, brief generation — and writes it down. Pages only read.
// Doing that work inline here cost ~6s before the LLM call even started, which
// overran the serverless timeout and cached a broken page.

import Link from "next/link";
import { getLatestArticles, getLatestBrief, getRecentArticles } from "../lib/db";
import { sentimentCounts } from "../lib/brief";

// Cheap now that this is three parallel database reads, so revalidate often.
export const revalidate = 60;

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
      {/* The bar is purely visual, so give assistive tech the numbers directly. */}
      <div
        className="sentiment-bar"
        role="img"
        aria-label={`Sentiment of ${total} stories: ${counts.bullish} bullish, ${counts.neutral} neutral, ${counts.bearish} bearish`}
      >
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

// NOTE: this page deliberately takes no searchParams. Reading them would make
// it fully dynamic, and `revalidate` would no longer apply — every request,
// including `/?anything=1`, would re-run 4 RSS fetches plus database queries.
// That is a cheap amplification vector against our own free-tier quotas.
// Per-ticker filtering lives at /stock/[ticker], which reads only the database.
export default async function Home() {
  // Database reads only. RSS fetching, LLM analysis and brief generation all
  // happen in /api/refresh on a schedule, because doing them here pushed the
  // render past the serverless timeout — which silently cached a page with
  // missing sentiment tags and no brief.
  const [articles, brief, recent] = await Promise.all([
    getLatestArticles(30),
    getLatestBrief(24),
    getRecentArticles(24),
  ]);

  const counts = sentimentCounts(recent);
  const hasAnalysis = articles.length > 0;

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
          <label htmlFor="ticker-search" className="visually-hidden">
            Search for a stock by ticker symbol
          </label>
          <input
            id="ticker-search"
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

      <ul className="news-list">
        {articles.map((a) => (
          <li key={a.link} className="card">
            <div className="meta">
              <span className="source">{a.source}</span>
              <span className="time">{timeAgo(a.published_at)}</span>
              <span className={`tag tag-${a.sentiment}`}>{a.sentiment}</span>
              {a.tickers?.map((t) => (
                <Link key={t} href={`/stock/${t}`} className="tag tag-ticker">
                  {t}
                </Link>
              ))}
            </div>
            <a href={a.link} target="_blank" rel="noopener noreferrer">
              {a.title}
            </a>
            {a.summary && <p className="snippet">{a.summary}</p>}
          </li>
        ))}
      </ul>

      {articles.length === 0 && (
        <p className="snippet">
          No analyzed stories yet. The scheduled refresh populates these —
          trigger it manually with <code>/api/refresh</code> if you just set the
          project up.
        </p>
      )}
    </main>
  );
}
