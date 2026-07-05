// lib/news.test.js
// Tests for the news parser logic. These run WITHOUT the network — we feed in
// sample data shaped like what rss-parser returns and check the transforms.
// Run with:  npm test
import { describe, it, expect } from "vitest";
import { normalizeItem, dedupeAndSort, capPerSource } from "./news.js";

describe("normalizeItem", () => {
  it("maps a full rss item into our shape", () => {
    const raw = {
      title: "  Fed holds rates steady  ",
      link: "https://example.com/a",
      isoDate: "2026-07-04T12:00:00.000Z",
      contentSnippet: "The Federal Reserve left rates unchanged.",
    };
    expect(normalizeItem(raw, "CNBC")).toEqual({
      title: "Fed holds rates steady", // trimmed
      link: "https://example.com/a",
      source: "CNBC",
      publishedAt: "2026-07-04T12:00:00.000Z",
      snippet: "The Federal Reserve left rates unchanged.",
    });
  });

  it("falls back safely when fields are missing", () => {
    const out = normalizeItem({}, "Yahoo Finance");
    expect(out.title).toBe("(no title)");
    expect(out.link).toBe("#");
    expect(out.publishedAt).toBe(null);
    expect(out.snippet).toBe("");
  });

  it("prefers isoDate but falls back to pubDate", () => {
    const out = normalizeItem({ pubDate: "Fri, 04 Jul 2026 12:00:00 GMT" }, "X");
    expect(out.publishedAt).toBe("Fri, 04 Jul 2026 12:00:00 GMT");
  });

  it("truncates long snippets to 200 chars", () => {
    const out = normalizeItem({ contentSnippet: "x".repeat(500) }, "X");
    expect(out.snippet).toHaveLength(200);
  });
});

describe("dedupeAndSort", () => {
  const mk = (title, publishedAt) => ({
    title,
    link: "#" + title,
    source: "T",
    publishedAt,
    snippet: "",
  });

  it("removes duplicate titles regardless of case", () => {
    const out = dedupeAndSort([
      mk("Apple hits record high", "2026-07-04T10:00:00Z"),
      mk("APPLE HITS RECORD HIGH", "2026-07-04T11:00:00Z"),
    ]);
    expect(out).toHaveLength(1);
  });

  it("sorts newest first", () => {
    const out = dedupeAndSort([
      mk("older", "2026-07-01T00:00:00Z"),
      mk("newest", "2026-07-04T00:00:00Z"),
      mk("middle", "2026-07-02T00:00:00Z"),
    ]);
    expect(out.map((x) => x.title)).toEqual(["newest", "middle", "older"]);
  });

  it("pushes items with no date to the bottom", () => {
    const out = dedupeAndSort([
      mk("no date", null),
      mk("has date", "2026-07-04T00:00:00Z"),
    ]);
    expect(out.map((x) => x.title)).toEqual(["has date", "no date"]);
  });

  it("respects the limit", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      mk("item " + i, `2026-07-0${(i % 9) + 1}T00:00:00Z`)
    );
    expect(dedupeAndSort(items, 3)).toHaveLength(3);
  });

  it("returns an empty array when given nothing", () => {
    expect(dedupeAndSort([])).toEqual([]);
  });
});

describe("capPerSource", () => {
  const mk = (source, i) => ({
    title: `${source} story ${i}`,
    link: "#",
    source,
    publishedAt: null,
    snippet: "",
  });

  it("caps one flooding source but keeps others intact", () => {
    const flood = Array.from({ length: 20 }, (_, i) => mk("Yahoo Finance", i));
    const other = [mk("CNBC Markets", 1), mk("MarketWatch", 1)];
    const out = capPerSource([...flood, ...other], 8);
    expect(out.filter((x) => x.source === "Yahoo Finance")).toHaveLength(8);
    expect(out.filter((x) => x.source === "CNBC Markets")).toHaveLength(1);
    expect(out.filter((x) => x.source === "MarketWatch")).toHaveLength(1);
  });

  it("keeps the FIRST items per source (newest, given pre-sorted input)", () => {
    const items = [mk("A", 0), mk("A", 1), mk("A", 2)];
    const out = capPerSource(items, 2);
    expect(out.map((x) => x.title)).toEqual(["A story 0", "A story 1"]);
  });
});
