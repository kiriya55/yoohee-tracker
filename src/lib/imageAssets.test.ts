import { describe, expect, it } from "vitest";
import sharp from "sharp";
// @ts-expect-error Node image helper is intentionally shared with the CLI.
import { convertDollToPng } from "../../scripts/image-assets.mjs";

describe("local image asset conversion", () => {
  it("converts a square WebP doll avatar to a 128x128 RGBA PNG", async () => {
    const input = await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    }).webp().toBuffer();

    const output = await convertDollToPng(input);
    const metadata = await sharp(output).metadata();

    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(128);
    expect(metadata.height).toBe(128);
    expect(metadata.channels).toBe(4);
  });
});
