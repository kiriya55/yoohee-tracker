import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Node script helper lives outside the application TypeScript project.
import { fetchWithRetry } from "../../scripts/fetch-with-retry.mjs";

describe("fetchWithRetry", () => {
  it("retries network failures and returns the successful response", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket reset"))
      .mockRejectedValueOnce(new Error("socket reset"))
      .mockResolvedValue(new Response("ok"));

    const response = await fetchWithRetry("https://example.test/chunk.js", { fetchImpl, attempts: 3, delayMs: 0 });

    expect(await response.text()).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("includes the URL after retry attempts are exhausted", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("socket reset"));

    await expect(
      fetchWithRetry("https://example.test/chunk.js", { fetchImpl, attempts: 2, delayMs: 0 }),
    ).rejects.toThrow("GET https://example.test/chunk.js failed after 2 attempts: socket reset");
  });

  it("uses a local proxy dispatcher only when proxyUrl is provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("ok"));

    await fetchWithRetry("https://example.test/proxied.js", {
      fetchImpl,
      proxyUrl: "http://127.0.0.1:7890",
      attempts: 1,
      delayMs: 0,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.test/proxied.js",
      expect.objectContaining({ dispatcher: expect.anything() }),
    );
  });

  it("retries transient HTTP responses but returns permanent errors immediately", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await fetchWithRetry("https://example.test/image.png", {
      fetchImpl,
      attempts: 2,
      delayMs: 0,
    });

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const notFound = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));
    const missingResponse = await fetchWithRetry("https://example.test/missing.png", {
      fetchImpl: notFound,
      attempts: 4,
      delayMs: 0,
    });
    expect(missingResponse.status).toBe(404);
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After for transient HTTP responses", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "3" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await fetchWithRetry("https://example.test/rate-limited.png", {
      fetchImpl,
      attempts: 2,
      delayMs: 100,
      sleep,
    });

    expect(sleep).toHaveBeenCalledWith(3000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("creates a fresh timeout signal for each retry", async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn().mockImplementation(async (_url, options) => {
      signals.push(options.signal);
      if (signals.length === 1) throw new Error("socket reset");
      return new Response("ok");
    });

    await fetchWithRetry("https://example.test/retry.png", {
      fetchImpl,
      attempts: 2,
      delayMs: 0,
      signalFactory: () => new AbortController().signal,
    });

    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });
});
