import { describe, expect, it } from "vitest";
// The production helper is an ESM JavaScript module used directly by Node scripts.
// @ts-expect-error TypeScript does not infer declarations for files outside the src project.
import { buildDandegateAssetSource, classifyDandegateFailure, fetchDandegateAssetSources, selectDandegateSyncTargets } from "../../scripts/dandegate-assets.mjs";

describe("Dandegate doll asset sources", () => {
  it("requests the Lind-compatible crop before resizing Dandegate avatars", () => {
    expect(buildDandegateAssetSource(
      "AsteriaSSR",
      "https://cdn.dandegate.net/dolls/asteria/avatar.webp",
      "https://dandegate.net/dolls/Asteria",
    )).toMatchObject({
      source: "dandegate",
      targetPath: "doll/Avatar_Head_AsteriaSSR.png",
      transform: {
        format: "png",
        width: 128,
        height: 128,
        crop: { left: 36, top: 0, width: 440, height: 440 },
      },
    });
  });

  it("can refresh existing non-frozen Dandegate entries when requested", () => {
    const existing = {
      id: 1080,
      type: "doll",
      code: "AsteriaSSR",
      assetSource: { source: "dandegate" },
    };

    expect(selectDandegateSyncTargets([existing], { refresh: true })).toEqual([existing]);
    expect(selectDandegateSyncTargets([existing])).toEqual([]);
  });

  it("keeps the already head-aligned Eagletta avatar uncropped", () => {
    expect(buildDandegateAssetSource(
      "EaglettaSSR",
      "https://cdn.dandegate.net/dolls/eagletta/avatar.webp",
      "https://dandegate.net/dolls/Eagletta",
    )?.transform).toEqual({ format: "png", width: 128, height: 128 });
  });

  it("classifies an unpublished page or avatar as source_pending", () => {
    expect(classifyDandegateFailure({ reason: "page_missing" })).toBe("source_pending");
    expect(classifyDandegateFailure({ reason: "avatar_missing" })).toBe("source_pending");
    expect(classifyDandegateFailure({ reason: "HTTP 404" })).toBe("source_pending");
  });

  it("keeps a page with no avatar as a pending resource instead of throwing", async () => {
    const fetchImpl = async (url: string) => {
      if (url.endsWith("/sitemap.xml")) {
        return new Response("<loc>https://dandegate.net/dolls/Cecilia</loc>", { status: 200 });
      }
      return new Response("<html><body>resource is not published yet</body></html>", { status: 200 });
    };

    const result = await fetchDandegateAssetSources(
      [{ id: 1082, type: "doll", code: "CeciliaSSR" }],
      { fetchImpl, attempts: 1, timeoutMs: 1000, concurrency: 1 },
    );

    expect(result.updates).toEqual([]);
    expect(result.failures).toEqual([
      expect.objectContaining({ id: 1082, code: "CeciliaSSR", kind: "source_pending", reason: "avatar_missing" }),
    ]);
  });
});
