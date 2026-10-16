/** Date parsing, freshness filter and duplicate removal. Pure functions, easy to test. */
import type { Candidate } from "./types";

const UNIT_MS: Record<string, number> = {
  minute: 60_000, min: 60_000, hour: 3_600_000, hr: 3_600_000,
  day: 86_400_000, week: 604_800_000, month: 2_592_000_000,
};

/** Handles ISO dates, "Oct 14, 2026", "2 hours ago", "yesterday". Returns null when unsure. */
export function parseNewsDate(text: string | null | undefined, now: Date): Date | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (t === "yesterday") return new Date(now.getTime() - UNIT_MS.day);
  if (t === "today" || t === "just now") return now;
  const rel = t.match(/(\d+)\s*(minute|min|hour|hr|day|week|month)s?\s+ago/);
  if (rel) return new Date(now.getTime() - Number(rel[1]) * UNIT_MS[rel[2]]);
  const abs = Date.parse(text);
  return Number.isNaN(abs) ? null : new Date(abs);
}

/** Keep fresh items and items with an unknown date (the model and the Sheet check catch the rest). */
export function filterFresh(items: Candidate[], now: Date, maxAgeHours: number): Candidate[] {
  const cutoff = now.getTime() - maxAgeHours * 3_600_000;
  return items.filter((c) => c.publishedAt === null || c.publishedAt.getTime() >= cutoff);
}

/**
 * The model groups items about the same event with `duplicateOf`. Return the ids that should stay:
 * those that are not a duplicate of anything. Chains are followed, and bad ids or loops count as "keep".
 */
export function pickRoots(results: { id: number; duplicateOf: number }[]): Set<number> {
  const target = new Map(results.map((r) => [r.id, r.duplicateOf]));
  const roots = new Set<number>();
  for (const { id } of results) {
    let current = id;
    for (let hops = 0; hops < 6; hops++) {
      const next = target.get(current);
      if (next === undefined || next < 0 || next === current || !target.has(next)) break; // current is a root
      current = next;
      if (current === id) break; // a loop: keep the item
    }
    if (current === id) roots.add(id);
  }
  return roots;
}

export function normaliseUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith("utm_") || ["fbclid", "gclid", "ref", "cmpid"].includes(key)) u.searchParams.delete(key);
    }
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const query = u.searchParams.toString();
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${path}${query ? `?${query}` : ""}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

export function sourceName(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const STOP = new Set(["the", "a", "an", "and", "of", "to", "in", "for", "on", "at", "with", "is", "as", "by", "its", "new"]);

function titleWords(title: string): Set<string> {
  return new Set(
    title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

/** Share of words two titles have in common (0 to 1). */
export function titleSimilarity(a: string, b: string): number {
  const wa = titleWords(a), wb = titleWords(b);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

/**
 * Drop URLs already in the Sheet, repeated URLs, and near-identical headlines (the same story from
 * several outlets). The first item of a group wins, so put the best results first.
 */
export function dedupe(items: Candidate[], existingUrls: Set<string>, similarity = 0.8): Candidate[] {
  const seen = new Set(existingUrls);
  const kept: Candidate[] = [];
  for (const item of items) {
    const key = normaliseUrl(item.url);
    if (seen.has(key)) continue;
    if (kept.some((k) => titleSimilarity(k.title, item.title) >= similarity)) continue;
    seen.add(key);
    kept.push(item);
  }
  return kept;
}
