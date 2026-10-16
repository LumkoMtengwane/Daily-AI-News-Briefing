import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the three outside services so the orchestration can be tested offline.
vi.mock("../src/firecrawl", () => ({ searchNews: vi.fn(), scrapeMarkdown: vi.fn() }));
vi.mock("../src/claude", async (orig) => ({ ...(await orig<typeof import("../src/claude")>()), rank: vi.fn(), summarise: vi.fn() }));
vi.mock("../src/sheets", () => ({
  connect: vi.fn(() => ({})), ensureSetup: vi.fn(), recentUrls: vi.fn(async () => new Set<string>()),
  appendNews: vi.fn(), appendRun: vi.fn(), recentHeadlines: vi.fn(async () => ["Old headline already logged"]),
}));
vi.mock("../src/http", async (orig) => ({ ...(await orig<typeof import("../src/http")>()), sleep: vi.fn() }));

import { rank, summarise } from "../src/claude";
import { scrapeMarkdown, searchNews } from "../src/firecrawl";
import { CONFIG } from "../src/config";
import { runPipeline } from "../src/pipeline";
import { appendNews, appendRun } from "../src/sheets";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const NOW = new Date("2026-10-15T05:00:00Z");
const news = (n: number) => ({ title: `Story number ${n} about company${n}`, url: `https://site${n}.com/a`, snippet: `snippet ${n}`, date: "1 hour ago" });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test";
  process.env.FIRECRAWL_API_KEY = "test";
  process.env.GOOGLE_SHEET_ID = "sheet";
  process.env.GOOGLE_SERVICE_ACCOUNT_B64 = "x";
});

function stub(opts: { scrape?: string | null } = {}) {
  vi.mocked(searchNews).mockImplementation(async (q) => ({ items: q.includes("acquisition") ? [news(1), news(2), news(3)] : [], credits: 2 }));
  vi.mocked(rank).mockResolvedValue({
    results: [
      { id: 0, category: "M&A and funding", importance: 5, companies: ["A"], duplicateOf: -1, alreadyLogged: false },
      { id: 1, category: "Other", importance: 2, companies: [], duplicateOf: -1, alreadyLogged: false },
      { id: 2, category: "Model releases", importance: 4, companies: ["B"], duplicateOf: -1, alreadyLogged: false },
    ],
    usage: { tokensIn: 1000, tokensOut: 100 },
  });
  vi.mocked(scrapeMarkdown).mockResolvedValue(opts.scrape === undefined ? "full article text. ".repeat(30) : opts.scrape);
  vi.mocked(summarise).mockResolvedValue({
    results: [{ id: 0, summary: "S0", whyItMatters: "W0" }, { id: 1, summary: "S1", whyItMatters: "W1" }],
    usage: { tokensIn: 2000, tokensOut: 200 },
  });
}

describe("runPipeline", () => {
  it("skips an event that is already in the Sheet and sends the logged headlines to the model", async () => {
    stub();
    vi.mocked(rank).mockResolvedValue({
      results: [
        { id: 0, category: "M&A and funding", importance: 5, companies: [], duplicateOf: -1, alreadyLogged: true },
        { id: 1, category: "Model releases", importance: 4, companies: [], duplicateOf: -1, alreadyLogged: false },
        { id: 2, category: "Other", importance: 4, companies: [], duplicateOf: -1, alreadyLogged: false },
      ],
      usage: { tokensIn: 1, tokensOut: 1 },
    });
    const stats = await runPipeline({ dryRun: false, log, now: NOW });
    expect(stats.kept).toBe(2);
    expect(vi.mocked(rank).mock.calls[0][1]).toEqual(["Old headline already logged"]);
  });

  it("keeps only important stories, writes them, and records the run", async () => {
    stub();
    const stats = await runPipeline({ dryRun: false, log, now: NOW });
    expect(stats).toMatchObject({ date: "2026-10-15", candidates: 3, afterDedupe: 3, kept: 2, written: 2, tokensIn: 3000, tokensOut: 300 });
    // 2 credits per search call (empty searches are retried once) plus 1 per article read
    expect(stats.firecrawlCredits).toBe(vi.mocked(searchNews).mock.calls.length * 2 + 2);
    expect(vi.mocked(searchNews).mock.calls.length).toBeGreaterThan(CONFIG.queries.length); // the retry happened
    const rows = vi.mocked(appendNews).mock.calls[0][3];
    expect(rows.map((r) => r.importance)).toEqual([5, 4]); // sorted, the importance-2 story is dropped
    expect(appendRun).toHaveBeenCalledOnce();
  });

  it("uses the snippet when an article cannot be read", async () => {
    stub({ scrape: null });
    vi.mocked(summarise).mockResolvedValue({ results: [{ id: 0, summary: "S0", whyItMatters: "W0" }], usage: { tokensIn: 1, tokensOut: 1 } });
    await runPipeline({ dryRun: false, log, now: NOW });
    const rows = vi.mocked(appendNews).mock.calls[0][3];
    expect(rows.every((r) => r.usedSnippetOnly)).toBe(true);
    expect(rows[1].summary).toBe("snippet 3"); // the model returned no summary for this one
  });

  it("dry run writes nothing", async () => {
    stub();
    const stats = await runPipeline({ dryRun: true, log, now: NOW });
    expect(stats.written).toBe(0);
    expect(appendNews).not.toHaveBeenCalled();
    expect(appendRun).not.toHaveBeenCalled();
  });

  it("carries on when some searches fail, but fails (after logging the run) when all do", async () => {
    stub();
    vi.mocked(searchNews).mockRejectedValueOnce(new Error("boom"));
    const ok = await runPipeline({ dryRun: false, log, now: NOW });
    expect(ok.errors).toContain("boom");

    vi.mocked(searchNews).mockRejectedValue(new Error("down"));
    await expect(runPipeline({ dryRun: false, log, now: NOW })).rejects.toThrow("Every search failed");
    expect(appendRun).toHaveBeenCalledTimes(2); // the failed run is still recorded
  });
});
