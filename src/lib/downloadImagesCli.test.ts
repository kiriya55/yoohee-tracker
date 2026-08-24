// @ts-nocheck Node-only CLI integration test; the application tsconfig intentionally excludes Node types.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("plans only missing images unless force is requested", () => {
  const root = mkdtempSync(path.join(tmpdir(), "gf2-images-"));
  try {
    const outDir = path.join(root, "images");
    const indexPath = path.join(root, "resource-index.json");
    const existingImage = path.join(outDir, "doll", "Avatar_Head_BastiSSR.png");
    mkdirSync(path.dirname(existingImage), { recursive: true });
    writeFileSync(existingImage, "existing");
    writeFileSync(
      indexPath,
      JSON.stringify({
        items: {
          "1071": { id: 1071, type: "doll", code: "BastiSSR", iconUrl: "https://example.test/Basti.png" },
          "1072": { id: 1072, type: "doll", code: "NewSSR", iconUrl: "https://example.test/New.png" },
        },
      }),
    );

    const script = path.resolve("scripts/download-images.mjs");
    const normal = spawnSync(process.execPath, [script, "--index", indexPath, "--out-dir", outDir, "--dry-run"], { encoding: "utf8" });
    const forced = spawnSync(process.execPath, [script, "--index", indexPath, "--out-dir", outDir, "--force", "--dry-run"], { encoding: "utf8" });

    expect(normal.status).toBe(0);
    expect(normal.stdout).toContain("Found 1 images to download");
    expect(forced.status).toBe(0);
    expect(forced.stdout).toContain("Found 2 images to download");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("does not publish localIcon when an image download fails", () => {
  const root = mkdtempSync(path.join(tmpdir(), "gf2-images-failed-"));
  try {
    const outDir = path.join(root, "images");
    const indexPath = path.join(root, "resource-index.json");
    writeFileSync(
      indexPath,
      JSON.stringify({
        format: "gf2-resource-index",
        version: 1,
        items: {
          "1059": { id: 1059, type: "item", code: "Missing", iconUrl: "http://127.0.0.1:9/missing.png" },
        },
      }),
    );

    const script = path.resolve("scripts/download-images.mjs");
    const result = spawnSync(
      process.execPath,
      [script, "--index", indexPath, "--out-dir", outDir, "--timeout-ms", "1000", "--retries", "1"],
      { encoding: "utf8" },
    );
    const generated = JSON.parse(String(readFileSync(path.join(outDir, "resource-index.json"))));

    expect(result.status).toBe(0);
    expect(generated.items["1059"].localIcon).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
