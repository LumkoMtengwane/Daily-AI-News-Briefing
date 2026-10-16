/** fetch with retries and exponential backoff. Error messages never include headers or keys. */

/** A failure that retrying cannot fix (bad key, no credits, bad request). */
export class FatalApiError extends Error {}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  opts: { retries: number; backoffMs: number; label: string },
): Promise<T> {
  let last = "unknown error";
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    let wait = opts.backoffMs * 2 ** attempt;
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });
      if (res.ok) return (await res.json()) as T;
      const body = (await res.text()).slice(0, 200);
      if (![408, 429, 500, 502, 503, 504].includes(res.status)) {
        throw new FatalApiError(`${opts.label} failed with ${res.status}: ${body}`);
      }
      last = `${res.status}`;
      const retryAfter = Number(res.headers.get("retry-after"));
      if (retryAfter > 0) wait = Math.max(wait, retryAfter * 1000);
    } catch (err) {
      if (err instanceof FatalApiError) throw err;
      last = err instanceof Error ? err.name : "network error";
    }
    if (attempt < opts.retries) await sleep(wait);
  }
  throw new Error(`${opts.label} failed after ${opts.retries + 1} attempts (${last})`);
}
