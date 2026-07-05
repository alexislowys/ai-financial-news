// lib/db.test.js
// Tests for the DB-layer PURE logic: splitting seen/unseen stories and
// stitching saved + fresh analysis back together. No database needed —
// that's the point of keeping these functions pure.
import { describe, it, expect } from "vitest";
import { splitBySaved, mergeAnalysis } from "./db.js";

const h = (link) => ({ title: link, link, source: "T", publishedAt: null, snippet: "" });
const a = (summary) => ({ summary, sentiment: "neutral", tickers: [] });

describe("splitBySaved", () => {
  it("separates already-analyzed from new stories", () => {
    const headlines = [h("a"), h("b"), h("c")];
    const saved = new Map([["b", a("saved b")]]);
    const { done, pending } = splitBySaved(headlines, saved);
    expect(done.map((x) => x.link)).toEqual(["b"]);
    expect(pending.map((x) => x.link)).toEqual(["a", "c"]);
  });

  it("all pending when DB is empty (no DATABASE_URL case)", () => {
    const { done, pending } = splitBySaved([h("a"), h("b")], new Map());
    expect(done).toEqual([]);
    expect(pending).toHaveLength(2);
  });
});

describe("mergeAnalysis", () => {
  it("aligns saved and fresh results with the original headline order", () => {
    const headlines = [h("a"), h("b"), h("c")];
    const saved = new Map([["b", a("saved b")]]);
    const pending = [h("a"), h("c")]; // what splitBySaved produced
    const fresh = [a("fresh a"), a("fresh c")]; // parallel to pending
    const out = mergeAnalysis(headlines, saved, pending, fresh);
    expect(out.map((x) => x?.summary)).toEqual(["fresh a", "saved b", "fresh c"]);
  });

  it("null entries when the AI call failed (fresh = null)", () => {
    const headlines = [h("a"), h("b")];
    const saved = new Map([["a", a("saved a")]]);
    const out = mergeAnalysis(headlines, saved, [h("b")], null);
    expect(out[0].summary).toBe("saved a");
    expect(out[1]).toBe(null);
  });

  it("all null when nothing saved and no AI (Phase 1 behavior preserved)", () => {
    const headlines = [h("a"), h("b")];
    const out = mergeAnalysis(headlines, new Map(), headlines, null);
    expect(out).toEqual([null, null]);
  });
});
