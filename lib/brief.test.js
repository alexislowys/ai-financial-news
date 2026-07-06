// lib/brief.test.js
// Tests for the daily-brief pure logic. The LLM call itself isn't tested
// (network); what we own is counting and prompt construction.
import { describe, it, expect } from "vitest";
import { sentimentCounts, buildBriefPrompt, overallMood } from "./brief.js";

describe("sentimentCounts", () => {
  it("tallies each label", () => {
    const out = sentimentCounts([
      { sentiment: "bullish" },
      { sentiment: "bullish" },
      { sentiment: "bearish" },
      { sentiment: "neutral" },
    ]);
    expect(out).toEqual({ bullish: 2, bearish: 1, neutral: 1 });
  });

  it("treats unknown labels and nulls safely", () => {
    const out = sentimentCounts([{ sentiment: "moonshot" }, null, undefined]);
    expect(out).toEqual({ bullish: 0, bearish: 0, neutral: 1 });
  });

  it("empty input, all zeros", () => {
    expect(sentimentCounts([])).toEqual({ bullish: 0, bearish: 0, neutral: 0 });
  });
});

describe("overallMood", () => {
  it("bullish majority wins", () => {
    expect(overallMood({ bullish: 3, bearish: 1, neutral: 5 })).toBe("leaning bullish");
  });
  it("bearish majority wins", () => {
    expect(overallMood({ bullish: 1, bearish: 2, neutral: 0 })).toBe("leaning bearish");
  });
  it("tie is mixed — neutral count never decides direction", () => {
    expect(overallMood({ bullish: 2, bearish: 2, neutral: 9 })).toBe("mixed / neutral");
  });
});

describe("buildBriefPrompt", () => {
  it("includes every story with its sentiment label", () => {
    const p = buildBriefPrompt([
      { title: "Fed cuts", summary: "25bp cut.", sentiment: "bullish" },
      { title: "Apple miss", summary: "Below estimates.", sentiment: "bearish" },
    ]);
    expect(p).toContain("[bullish] Fed cuts: 25bp cut.");
    expect(p).toContain("[bearish] Apple miss: Below estimates.");
    expect(p).toContain("max 120 words");
  });
});
