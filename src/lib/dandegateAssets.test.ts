import { describe, expect, it } from "vitest";
// The production helper is an ESM JavaScript module used directly by Node scripts.
// @ts-expect-error TypeScript does not infer declarations for files outside the src project.
import { buildDandegateAssetSource, selectDandegateSyncTargets } from "../../scripts/dandegate-assets.mjs";

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
});
