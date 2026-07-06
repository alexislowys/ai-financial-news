// app/stock/[ticker]/page.js
// Phase 6: per-stock view. /stock/AAPL shows every stored article that
// mentions AAPL plus an aggregated sentiment tally — the "what's the mood
// on this stock?" page. Reads ONLY the DB: zero AI calls, zero feed fetches.

import Link from "next/link";
import { getArticlesByTicker, normalizeTicker } from "../../../lib/db";
import { sentimentCounts, overallMood } from "../../../lib/brief";

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

export default async function StockPage({ params }) {
  const { ticker: raw } = await params;
  const ticker = normalizeTicker(decodeURIComponent(raw));
  const articles = ticker ? await getArticlesByTicker(ticker) : [];
  const counts = sentimentCounts(articles);

  return (
    <main className="container">
      <header>
        <h1>{ticker ?? "Invalid ticker"}</h1>
        <p className="subtitle">
          {articles.length > 0
            ? `${articles.length} stored ${articles.length === 1 ? "story" : "stories"} · ${overallMood(counts)}`
            : "No stored stories for this ticker yet."}{" "}
          <Link href="/">← all news</Link>
        </p>
      </header>

      {articles.length > 0 && (
        <section className="brief">
          <div className="sentiment-legend">
            <span className="tag tag-bullish">{counts.bullish} bullish</span>
            <span className="tag tag-neutral">{counts.neutral} neutral</span>
            <span className="tag tag-bearish">{counts.bearish} bearish</span>
          </div>
        </section>
      )}

      {articles.length === 0 && ticker && (
        <p className="snippet">
          The database only knows stories the feeds have carried since this
          app started collecting. Try a widely covered ticker, or check back
          after the next refresh.
        </p>
      )}

      <ul className="news-list">
        {articles.map((a) => (
          <li key={a.link} className="card">
            <div className="meta">
              <span className="source">{a.source}</span>
              <span className="time">{timeAgo(a.published_at)}</span>
              <span className={`tag tag-${a.sentiment}`}>{a.sentiment}</span>
              {a.tickers
                ?.filter((t) => t !== ticker)
                .map((t) => (
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
    </main>
  );
}
