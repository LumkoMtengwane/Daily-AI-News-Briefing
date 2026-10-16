import type { Category } from "./config";

/** A news search result, before ranking. */
export interface Candidate {
  title: string;
  url: string;
  snippet: string;
  /** Raw date text from the search result, if any. */
  dateText: string | null;
  /** Parsed date, null when unknown. */
  publishedAt: Date | null;
  /** Site name, for example techcrunch.com. */
  source: string;
  /** Which search found it. */
  queryCategory: Category;
}

export interface Ranked {
  candidate: Candidate;
  category: Category;
  importance: number;
  companies: string[];
}

export interface Summarised extends Ranked {
  summary: string;
  whyItMatters: string;
  /** True when the article could not be read and the snippet was used. */
  usedSnippetOnly: boolean;
}

/** One line of the Runs tab. */
export interface RunStats {
  date: string;
  candidates: number;
  afterDedupe: number;
  kept: number;
  written: number;
  firecrawlCredits: number;
  tokensIn: number;
  tokensOut: number;
  estCostUsd: number;
  seconds: number;
  errors: string;
}
