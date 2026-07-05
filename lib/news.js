// lib/news.js
// Phase 1: fetch financial headlines from free RSS feeds (no API key needed).
// rss-parser downloads each feed's XML and turns it into a JS object.

import Parser from "rss-parser";

const parser = new Parser({
  timeout: 10000, // give up on a feed after 10 seconds
});

// Free, no-signup news sources. Market-focused feeds (not "top stories" —
// those mix in lifestyle content that pollutes sentiment analysis).
export const FEEDS = [
  {
    source: "CNBC Markets",
    url: "https://www.cnbc.com/id/20910258/device/rss/rss.html",
  },
  {
    source: "CNBC Economy",
    url: "https://www.cnbc.com/id/10000664/device/rss/rss.html",
  },
  {
    source: "Yahoo Finance",
    url: "https://finance.yahoo.com/news/rssindex",
  },
  {
    source: "MarketWatch",
    url: "https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines",
  },
];

// ---------------------------------------------------------------------------
// Pure helpers below (no network) — these are what the tests exercise.
// Keeping the data-shaping logic separate from the fetch means we can test it
// with fixed sample data instead of depending on live, changing feeds.
// ---------------------------------------------------------------------------

/**
 * Turn one raw rss-parser item into our normalized shape.
 * Guards against feeds that omit fields (title/link/date can all be missing).
 */
export function normalizeItem(item, source) {
  return {
    title: item.title?.trim() || "(no title)",
    link: item.link || "#",
    source,
    publishedAt: item.isoDate ?? item.pubDate ?? null,
    snippet: (item.contentSnippet ?? "").slice(0, 200),
  };
}

/**
 * Cap how many items one source can contribute, so a single chatty feed
 * (e.g. Yahoo's "Is X A Good Stock To Buy Now?" series) can't drown out the rest.
 * Items must already be sorted the way you want — first N per source survive.
 */
export function capPerSource(items, maxPerSource = 8) {
  const counts = new Map();
  return items.filter((item) => {
    const n = counts.get(item.source) ?? 0;
    if (n >= maxPerSource) return false;
    counts.set(item.source, n + 1);
    return true;
  });
}

/**
 * Merge already-normalized items from many feeds: drop duplicate stories
 * (same title, case-insensitive), sort newest-first, and cap the count.
 * Items missing a date sort to the bottom rather than the top.
 */
export function dedupeAndSort(items, limit = 30) {
  const seen = new Set();
  const unique = items.filter((item) => {
    const key = item.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Newest first. Missing dates become epoch (1970) so they sink to the bottom.
  unique.sort(
    (a, b) => new Date(b.publishedAt ?? 0) - new Date(a.publishedAt ?? 0)
  );

  return unique.slice(0, limit);
}

/**
 * Fetch all feeds in parallel, merge, dedupe, and sort newest-first.
 * Returns: [{ title, link, source, publishedAt, snippet }]
 */
export async function fetchHeadlines(limit = 30) {
  // Promise.allSettled = fetch every feed at once; one failing feed
  // doesn't break the whole page.
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const parsed = await parser.parseURL(feed.url);
      return parsed.items.map((item) => normalizeItem(item, feed.source));
    })
  );

  // Keep only feeds that succeeded.
  const items = results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value);

  // Sort/dedupe first (so cap keeps each source's newest), then cap, then limit.
  return capPerSource(dedupeAndSort(items, Infinity)).slice(0, limit);
}
