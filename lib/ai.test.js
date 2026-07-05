// lib/ai.test.js
// Tests for the AI prompt/response logic — no network, no API key.
// We test what WE control: prompt building and defensive parsing of replies.
import { describe, it, expect } from "vitest";
import { buildPrompt, parseAnalysis } from "./ai.js";

const items = [
  { title: "Fed cuts rates", snippet: "Quarter-point cut announced." },
  { title: "Apple misses earnings", snippet: "" },
];

describe("buildPrompt", () => {
  it("numbers every story and states the expected count", () => {
    const p = buildPrompt(items);
    expect(p).toContain("1. Fed cuts rates");
    expect(p).toContain("2. Apple misses earnings");
    expect(p).toContain("JSON array of 2 objects");
  });

  it("marks missing snippets instead of leaving a dangling dash", () => {
    expect(buildPrompt(items)).toContain("(no snippet)");
  });
});

describe("parseAnalysis", () => {
  const good = JSON.stringify([
    { summary: "Fed cut rates by 25bp.", sentiment: "bullish", tickers: [] },
    { summary: "Apple missed estimates.", sentiment: "bearish", tickers: ["aapl"] },
  ]);

  it("parses a clean JSON reply", () => {
    const out = parseAnalysis(good, 2);
    expect(out).toHaveLength(2);
    expect(out[0].sentiment).toBe("bullish");
  });

  it("uppercases tickers", () => {
    expect(parseAnalysis(good, 2)[1].tickers).toEqual(["AAPL"]);
  });

  it("strips markdown code fences", () => {
    const fenced = "```json\n" + good + "\n```";
    expect(parseAnalysis(fenced, 2)).toHaveLength(2);
  });

  it("returns null for non-JSON garbage", () => {
    expect(parseAnalysis("Sorry, I cannot help with that.", 2)).toBe(null);
  });

  it("returns null when the count is wrong", () => {
    expect(parseAnalysis(good, 3)).toBe(null);
  });

  it("returns null for empty input", () => {
    expect(parseAnalysis("", 2)).toBe(null);
    expect(parseAnalysis(null, 2)).toBe(null);
  });

  it("coerces invalid sentiment to neutral", () => {
    const weird = JSON.stringify([
      { summary: "x", sentiment: "VERY BULLISH!!", tickers: [] },
      { summary: "y", sentiment: "bearish", tickers: [] },
    ]);
    expect(parseAnalysis(weird, 2)[0].sentiment).toBe("neutral");
  });

  it("survives missing/malformed fields per entry", () => {
    const sparse = JSON.stringify([{}, { summary: 42, tickers: "AAPL" }]);
    const out = parseAnalysis(sparse, 2);
    expect(out[0]).toEqual({ summary: "", sentiment: "neutral", tickers: [] });
    expect(out[1]).toEqual({ summary: "", sentiment: "neutral", tickers: [] });
  });

  it("caps ticker list length", () => {
    const many = JSON.stringify([
      { summary: "x", sentiment: "neutral", tickers: ["A", "B", "C", "D", "E", "F", "G", "H"] },
      { summary: "y", sentiment: "neutral", tickers: [] },
    ]);
    expect(parseAnalysis(many, 2)[0].tickers).toHaveLength(6);
  });
});
