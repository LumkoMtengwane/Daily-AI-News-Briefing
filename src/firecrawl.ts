/** Firecrawl REST v2: news search and page scrape. Plain fetch, no SDK (the SDK needs Node 22). */
import { CONFIG } from "./config";
import { fetchJson } from "./http";

const BASE = "https://api.firecrawl.dev/v2";

export interface RawNews {
  title: string;
  url: string;
  snippet: string;
  date: string | null;
}

const headers = (apiKey: string) => ({ Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" });
const retry = { retries: CONFIG.retries, backoffMs: CONFIG.backoffMs };

/** News search. Costs 2 credits per 10 results; the response reports creditsUsed. */
export async function searchNews(query: string, limit: number, apiKey: string): Promise<{ items: RawNews[]; credits: number }> {
  const res = await fetchJson<{
    data?: { news?: { title?: string; url?: string; snippet?: string; date?: string }[] };
    creditsUsed?: number;
  }>(
    `${BASE}/search`,
    { method: "POST", headers: headers(apiKey), body: JSON.stringify({ query, sources: ["news"], limit }) },
    { ...retry, label: "Firecrawl search" },
  );
  const items = (res.data?.news ?? [])
    .filter((n) => n.url && n.title)
    .map((n) => ({ title: n.title!, url: n.url!, snippet: n.snippet ?? "", date: n.date ?? null }));
  return { items, credits: res.creditsUsed ?? 2 };
}

/** Article text as markdown, or null when the page cannot be read. 1 credit per page. */
export async function scrapeMarkdown(url: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetchJson<{ success?: boolean; data?: { markdown?: string } }>(
      `${BASE}/scrape`,
      {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: 30000 }),
      },
      { ...retry, retries: 1, label: "Firecrawl scrape" },
    );
    return res.data?.markdown?.trim() || null;
  } catch {
    return null; // the caller falls back to the search snippet
  }
}
