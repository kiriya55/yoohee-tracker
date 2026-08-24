// @ts-nocheck Node-only CLI integration test.
import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

it("documents the proxy option for local image URL checks", () => {
  const result = spawnSync(process.execPath, [
    path.resolve("scripts/check-resource-images.mjs"),
    "--help",
  ], { encoding: "utf8" });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("--proxy-url <url>");
});
