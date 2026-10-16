/** The whole daily job, independent of Trigger.dev so it can also run locally and in tests. */
import { estimateCostUsd, rank, summarise } from "./claude";
import { CONFIG } from "./config";
import { dedupe, filterFresh, parseNewsDate, pickRoots, sourceName } from "./dedupe";
import { scrapeMarkdown, searchNews } from "./firecrawl";
import { sleep } from "./http";
import { appendNews, appendRun, connect, ensureSetup, recentHeadlines, recentUrls, type SheetsClient } from "./sheets";
import type { Candidate, Ranked, RunStats, Summarised } from "./types";

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface PipelineOptions {
  /** Do everything except write to the Sheet. */
  dryRun: boolean;
  log: Logger;
  now?: Date;
}

/** Today's date in South African time, as YYYY-MM-DD. */
export const sastDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(d);

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see .env.example)`);
  return v;
}

export async function runPipeline({ dryRun, log, now = new Date() }: PipelineOptions): Promise<RunStats> {
  const started = Date.now();
  const stats: RunStats = {
    date: sastDate(now), candidates: 0, afterDedupe: 0, kept: 0, written: 0, firecrawlCredits: 0,
    tokensIn: 0, tokensOut: 0, estCostUsd: 0, seconds: 0, errors: "",
  };
  const errors: string[] = [];
  need("ANTHROPIC_API_KEY");
  const firecrawlKey = need("FIRECRAWL_API_KEY");

  // A dry run works without Google keys; a live run needs them.
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const wantSheet = !dryRun || (Boolean(sheetId) && Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_B64));
  let api: SheetsClient | null = null;
  let existing = new Set<string>();
  let logged: string[] = [];
  let failure: unknown = null;

  try {
    if (wantSheet) {
      if (!sheetId) throw new Error("GOOGLE_SHEET_ID is not set (see .env.example)");
      api = connect();
      await ensureSetup(api, sheetId);
      existing = await recentUrls(api, sheetId, CONFIG.sheetLookbackRows);
      logged = await recentHeadlines(api, sheetId, CONFIG.loggedHeadlinesForModel);
      log.info("Sheet ready", { knownUrls: existing.size, recentHeadlines: logged.length });
    } else {
      log.warn("Dry run without Google keys: skipping the Sheet and the already-logged check");
    }

    // 1. Search (one at a time to respect the free-plan rate limit).
    const found: Candidate[] = [];
    let searchFailures = 0;
    for (const [i, { category, q }] of CONFIG.queries.entries()) {
      if (i > 0) await sleep(CONFIG.requestGapMs);
      try {
        let { items, credits } = await searchNews(q, CONFIG.searchLimit, firecrawlKey);
        stats.firecrawlCredits += credits;
        if (!items.length) {
          // Firecrawl sometimes returns nothing for a query that normally works. Try once more.
          await sleep(CONFIG.requestGapMs);
          const again = await searchNews(q, CONFIG.searchLimit, firecrawlKey);
          items = again.items;
          stats.firecrawlCredits += again.credits;
        }
        for (const n of items) {
          found.push({
            title: n.title, url: n.url, snippet: n.snippet, dateText: n.date,
            publishedAt: parseNewsDate(n.date, now), source: sourceName(n.url), queryCategory: category,
          });
        }
        log.info("Search done", { query: q, results: items.length });
      } catch (err) {
        searchFailures++;
        const msg = `search "${q}": ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        log.warn(msg);
      }
    }
    if (searchFailures === CONFIG.queries.length) throw new Error("Every search failed");
    stats.candidates = found.length;

    // 2. Drop old items, stories already in the Sheet, and the same story from several outlets.
    const recent = filterFresh(found, now, CONFIG.maxAgeHours);
    const fresh = dedupe(recent, existing);
    stats.afterDedupe = fresh.length;
    log.info("After filtering", {
      found: found.length, tooOld: found.length - recent.length, duplicatesOrAlreadyLogged: recent.length - fresh.length,
      fresh: fresh.length,
    });
    if (!fresh.length) {
      log.info("Nothing new today");
      return stats;
    }

    // 3. Rank with one batched model call.
    const ranking = await rank(
      fresh.map((c, id) => ({ id, title: c.title, snippet: c.snippet, source: c.source, date: c.dateText })),
      logged,
    );
    stats.tokensIn += ranking.usage.tokensIn;
    stats.tokensOut += ranking.usage.tokensOut;
    const roots = pickRoots(ranking.results); // one item per event, however many outlets covered it
    const ranked: Ranked[] = ranking.results
      .filter((r) => fresh[r.id] && roots.has(r.id) && !r.alreadyLogged && r.importance >= CONFIG.minImportance)
      .map((r) => ({ candidate: fresh[r.id], category: r.category, importance: r.importance, companies: r.companies }))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, CONFIG.maxArticles);
    stats.kept = ranked.length;
    log.info("Ranked", {
      considered: ranking.results.length, sameEventDropped: ranking.results.length - roots.size,
      alreadyInSheet: ranking.results.filter((r) => r.alreadyLogged).length, kept: ranked.length,
    });
    if (!ranked.length) return stats;

    // 4. Read the kept articles. If a page cannot be read, the snippet is used.
    const texts: { text: string; snippetOnly: boolean }[] = [];
    for (const [i, r] of ranked.entries()) {
      if (i > 0) await sleep(CONFIG.requestGapMs);
      const md = await scrapeMarkdown(r.candidate.url, firecrawlKey);
      if (md) stats.firecrawlCredits += 1;
      const readable = md !== null && md.length >= CONFIG.minArticleChars;
      texts.push(readable
        ? { text: md.slice(0, CONFIG.scrapeMaxChars), snippetOnly: false }
        : { text: r.candidate.snippet || r.candidate.title, snippetOnly: true });
    }

    // 5. Summarise with one batched model call.
    const summaries = await summarise(ranked.map((r, id) => ({
      id, title: r.candidate.title, source: r.candidate.source, text: texts[id].text })));
    stats.tokensIn += summaries.usage.tokensIn;
    stats.tokensOut += summaries.usage.tokensOut;
    const byId = new Map(summaries.results.map((s) => [s.id, s]));
    const final: Summarised[] = ranked.map((r, id) => ({
      ...r,
      summary: byId.get(id)?.summary || r.candidate.snippet || r.candidate.title,
      whyItMatters: byId.get(id)?.whyItMatters || "",
      usedSnippetOnly: texts[id].snippetOnly,
    }));

    // 6. Write to the Sheet.
    if (dryRun) {
      for (const s of final) {
        log.info(`[${s.importance}] ${s.category} | ${s.candidate.title}`, {
          source: s.candidate.source, companies: s.companies, summary: s.summary, why: s.whyItMatters,
        });
      }
    } else {
      await appendNews(api!, sheetId!, stats.date, final);
    }
    stats.written = dryRun ? 0 : final.length;
  } catch (err) {
    failure = err;
    errors.push(err instanceof Error ? err.message : String(err));
    log.error("Run failed", { error: errors[errors.length - 1] });
  } finally {
    stats.estCostUsd = estimateCostUsd(stats.tokensIn, stats.tokensOut);
    stats.seconds = Math.round((Date.now() - started) / 1000);
    stats.errors = errors.join(" | ").slice(0, 500);
    log.info("Run stats", { ...stats });
    if (api && sheetId && !dryRun) {
      try {
        await appendRun(api, sheetId, stats);
      } catch (err) {
        log.error("Could not write the Runs row", { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  // Re-throw after the Runs row is written, so Trigger.dev retries and alerts.
  if (failure) throw failure;
  return stats;
}
