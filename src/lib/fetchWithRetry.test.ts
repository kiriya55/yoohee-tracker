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
});
