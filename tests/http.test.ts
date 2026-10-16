import { afterEach, describe, expect, it, vi } from "vitest";
import { FatalApiError, fetchJson } from "../src/http";

const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const opts = { retries: 3, backoffMs: 1, label: "Test" };

afterEach(() => vi.unstubAllGlobals());

describe("fetchJson", () => {
  it("retries 429 and 5xx then succeeds", async () => {
    const fn = vi.fn().mockResolvedValueOnce(reply(503)).mockResolvedValueOnce(reply(429)).mockResolvedValueOnce(reply(200, { ok: 1 }));
    vi.stubGlobal("fetch", fn);
    await expect(fetchJson("http://x", {}, opts)).resolves.toEqual({ ok: 1 });
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it("gives up after the retries are used", async () => {
    const fn = vi.fn().mockImplementation(async () => reply(500));
    vi.stubGlobal("fetch", fn);
    await expect(fetchJson("http://x", {}, opts)).rejects.toThrow(/failed after 4 attempts/);
    expect(fn).toHaveBeenCalledTimes(4);
  });
  it("does not retry a bad key or missing credits", async () => {
    for (const status of [401, 402]) {
      const fn = vi.fn().mockImplementation(async () => reply(status, { error: "nope" }));
      vi.stubGlobal("fetch", fn);
      await expect(fetchJson("http://x", {}, opts)).rejects.toBeInstanceOf(FatalApiError);
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });
});
