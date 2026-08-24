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

  it("scales the Lind reference crop for smaller Dandegate sources", async () => {
    const input = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 1 },
      },
    }).webp().toBuffer();

    const output = await convertDollToPng(input, {
      crop: {
        left: 36,
        top: 0,
        width: 440,
        height: 440,
        referenceWidth: 512,
        referenceHeight: 512,
      },
    });
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(128);
    expect(metadata.height).toBe(128);
  });
});
