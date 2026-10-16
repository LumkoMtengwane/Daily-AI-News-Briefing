import { describe, expect, it } from "vitest";
import { dedupe, filterFresh, normaliseUrl, parseNewsDate, pickRoots, titleSimilarity } from "../src/dedupe";
import type { Candidate } from "../src/types";

const NOW = new Date("2026-10-15T05:00:00Z");

const cand = (title: string, url: string, publishedAt: Date | null = NOW): Candidate => ({
  title, url, snippet: "", dateText: null, publishedAt, source: "x.com", queryCategory: "Other",
});

describe("parseNewsDate", () => {
  it("handles relative dates", () => {
    expect(parseNewsDate("2 hours ago", NOW)?.toISOString()).toBe("2026-10-15T03:00:00.000Z");
    expect(parseNewsDate("3 days ago", NOW)?.toISOString()).toBe("2026-10-12T05:00:00.000Z");
    expect(parseNewsDate("Yesterday", NOW)?.toISOString()).toBe("2026-10-14T05:00:00.000Z");
  });
  it("handles absolute dates", () => {
    expect(parseNewsDate("2026-10-14T10:00:00Z", NOW)?.toISOString()).toBe("2026-10-14T10:00:00.000Z");
    expect(parseNewsDate("Oct 14, 2026", NOW)).toBeInstanceOf(Date);
  });
  it("returns null when unsure", () => {
    expect(parseNewsDate(null, NOW)).toBeNull();
    expect(parseNewsDate("", NOW)).toBeNull();
    expect(parseNewsDate("sometime soon", NOW)).toBeNull();
  });
});

describe("filterFresh", () => {
  it("drops old items but keeps unknown dates", () => {
    const items = [
      cand("fresh", "https://a.com/1", new Date("2026-10-14T20:00:00Z")),
      cand("old", "https://a.com/2", new Date("2026-10-10T00:00:00Z")),
      cand("unknown", "https://a.com/3", null),
    ];
    expect(filterFresh(items, NOW, 36).map((c) => c.title)).toEqual(["fresh", "unknown"]);
  });
});

describe("normaliseUrl", () => {
  it("ignores tracking, www, hash and trailing slash", () => {
    const a = normaliseUrl("https://www.Example.com/story/?utm_source=x&fbclid=1#top");
    expect(a).toBe("example.com/story");
    expect(normaliseUrl("https://example.com/story")).toBe(a);
  });
  it("keeps meaningful query strings", () => {
    expect(normaliseUrl("https://example.com/read?id=7")).toBe("example.com/read?id=7");
  });
});

describe("dedupe", () => {
  it("removes URLs already in the sheet, repeats, and the same story from other outlets", () => {
    const existing = new Set([normaliseUrl("https://a.com/seen")]);
    const items = [
      cand("OpenAI acquires robotics startup in $2B deal", "https://a.com/seen"),
      cand("OpenAI acquires robotics startup in $2B deal", "https://b.com/one"),
      cand("OpenAI buys robotics startup in 2B deal", "https://c.com/two"),
      cand("OpenAI buys robotics startup in 2B deal", "https://c.com/two?utm_medium=x"),
      cand("EU passes new AI liability rules", "https://d.com/three"),
    ];
    expect(dedupe(items, existing).map((c) => c.url)).toEqual(["https://b.com/one", "https://d.com/three"]);
  });
  it("does not merge different stories", () => {
    expect(titleSimilarity("Anthropic raises funding", "Google releases Gemini model")).toBeLessThan(0.5);
  });
});

describe("pickRoots", () => {
  it("keeps one item per event and follows chains", () => {
    const results = [
      { id: 0, duplicateOf: -1 }, // best Gemini story
      { id: 1, duplicateOf: 0 },
      { id: 2, duplicateOf: 1 }, // chain: 2 -> 1 -> 0
      { id: 3, duplicateOf: -1 }, // unique
    ];
    expect([...pickRoots(results)].sort()).toEqual([0, 3]);
  });
  it("keeps items with a bad target or a loop instead of losing them", () => {
    expect([...pickRoots([{ id: 0, duplicateOf: 99 }, { id: 1, duplicateOf: 2 }, { id: 2, duplicateOf: 1 }])].sort()).toEqual([0, 1, 2]);
  });
});
