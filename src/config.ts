/** Everything you might want to tune lives here. */

export const CATEGORIES = [
  "M&A and funding",
  "Model releases",
  "Products and tools",
  "Policy and regulation",
  "Other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CONFIG = {
  model: "claude-haiku-5-5",
  /** Who reads the briefing. It shapes the "why it matters" line. Change it to fit your reader. */
  audience: "someone building AI automation for small businesses",
  /** Searches to run each day. Firecrawl charges 2 credits per 10 results. */
  // One big story can fill a whole result list (the same launch from 8 outlets), so each topic gets
  // several differently worded queries. Short, plain queries work best: long ones can return nothing.
  queries: [
    { category: "M&A and funding", q: "AI acquisition" },
    { category: "M&A and funding", q: "AI startup raises funding round" },
    { category: "M&A and funding", q: "AI valuation billion investment" },
    { category: "Model releases", q: "new AI model release" },
    { category: "Model releases", q: "open source LLM release" },
    { category: "Model releases", q: "OpenAI news" },
    { category: "Products and tools", q: "AI agent launch" },
    { category: "Policy and regulation", q: "AI regulation law" },
    { category: "Policy and regulation", q: "AI copyright lawsuit court" },
  ] as { category: Category; q: string }[],
  searchLimit: 10,
  /** Free plan allows 10 search/scrape requests a minute, so wait between calls. */
  requestGapMs: 6500,
  /**
   * Drop stories older than this. Firecrawl dates news in whole days ("1 day ago" = 24h, "2 days ago" = 48h),
   * so 60h keeps "2 days ago". Repeats are removed by the Sheet's URL check. Unknown dates are kept.
   */
  maxAgeHours: 60,
  /** Keep stories the model scores at or above this (1 to 5). */
  minImportance: 4,
  /** At most this many articles are read (1 Firecrawl credit each) and written to the Sheet each day. */
  maxArticles: 8,
  /** Article text sent to the model, per article. */
  scrapeMaxChars: 4000,
  /** A page shorter than this is treated as unreadable (paywall, cookie wall) and the snippet is used. */
  minArticleChars: 300,
  /** How many recent Sheet rows to check for stories already logged (by URL). */
  sheetLookbackRows: 500,
  /** How many recent headlines the model sees, to skip an event that is already logged from another outlet. */
  loggedHeadlinesForModel: 40,
  retries: 3,
  backoffMs: 2000,
};
