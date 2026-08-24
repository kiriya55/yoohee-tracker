// @ts-nocheck Node-only integration tests import the ESM uploader directly.
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildPublicIndexUrl,
  buildUploadPlan,
  uploadPlan,
  validateCatalog,
  verifyPublicIndex,
} from "../../scripts/sync-miniprogram-resources.mjs";

async function makeFixture() {
  const imageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gf2-r2-sync-"));
  await fs.mkdir(path.join(imageRoot, "doll"), { recursive: true });
  await fs.mkdir(path.join(imageRoot, "weapon"), { recursive: true });
  await fs.writeFile(path.join(imageRoot, "doll", "Avatar_Head_TestSSR.png"), "doll");
  await fs.writeFile(path.join(imageRoot, "weapon", "Weapon_Test_5_1024.png"), "weapon");

  return imageRoot;
}

function fixtureIndex() {
  return {
    format: "gf2-resource-index",
    version: 1,
    generatedAt: "2026-08-24T12:00:00.000Z",
    items: {
      "9001": {
        id: 9001,
        type: "doll",
        code: "TestSSR",
        localIcon: "/images/doll/Avatar_Head_TestSSR.png",
      },
      "19001": {
        id: 19001,
        type: "weapon",
        code: "Weapon_Test_5",
        localIcon: "/images/weapon/Weapon_Test_5_1024.png",
      },
    },
  };
}

describe("mini-program R2 resource sync", () => {
  it("normalizes a base or full index URL and adds a cache-busting verifier query", () => {
    expect(buildPublicIndexUrl("https://assets.example.test", 123)).toBe(
      "https://assets.example.test/miniprogram-resource-index.json?_r2_verify=123",
    );
    expect(buildPublicIndexUrl("https://assets.example.test/miniprogram-resource-index.json", 123)).toBe(
      "https://assets.example.test/miniprogram-resource-index.json?_r2_verify=123",
    );
  });

  it("retries a transient public 403 before accepting the uploaded index", async () => {
    const responses = [
      new Response("Access denied", { status: 403 }),
      new Response(JSON.stringify({ format: "gf2-resource-index", items: { "1": {} } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ];
    const urls: string[] = [];

    await expect(verifyPublicIndex(
      "https://assets.example.test",
      { format: "gf2-resource-index", items: { "1": {} } },
      {
        attempts: 2,
        retryDelayMs: 0,
        now: () => 100,
        fetchImpl: async (url) => {
          urls.push(String(url));
          return responses.shift();
        },
      },
    )).resolves.toBeUndefined();

    expect(urls).toHaveLength(2);
    expect(urls[0]).not.toBe(urls[1]);
  });

  it("validates every catalog image before creating an upload plan", async () => {
    const imageRoot = await makeFixture();
    const index = fixtureIndex();

    await expect(validateCatalog(index, imageRoot, { minItems: 2 })).resolves.toMatchObject({
      itemCount: 2,
      imageCount: 2,
    });

    await fs.rm(path.join(imageRoot, "weapon", "Weapon_Test_5_1024.png"));
    await expect(validateCatalog(index, imageRoot, { minItems: 2 })).rejects.toThrow(/missing/i);
  });

  it("creates an artifact copy and uploads images before the index", async () => {
    const imageRoot = await makeFixture();
    const artifactPath = path.join(imageRoot, "artifact", "miniprogram-resource-index.json");
    const plan = await buildUploadPlan(fixtureIndex(), imageRoot, artifactPath, { minItems: 2 });
    const uploaded: string[] = [];
    const verified: string[] = [];
    const client = {
      async send(command: { input: { Key: string }; constructor: { name: string } }) {
        if (command.constructor.name === "PutObjectCommand") uploaded.push(command.input.Key);
        if (command.constructor.name === "HeadObjectCommand") verified.push(command.input.Key);
        return {};
      },
    };

    await uploadPlan(plan, { client, bucket: "test-bucket" });

    expect(uploaded).toEqual([
      "doll/Avatar_Head_TestSSR.png",
      "weapon/Weapon_Test_5_1024.png",
      "miniprogram-resource-index.json",
    ]);
    expect(verified).toEqual(uploaded);
    await expect(fs.readFile(artifactPath, "utf8")).resolves.toBe(`${JSON.stringify(fixtureIndex(), null, 2)}\n`);
  });

  it("wires the generated index artifact and R2 upload into the Action", async () => {
    const workflow = await fs.readFile(
      path.resolve(process.cwd(), ".github/workflows/update-images.yml"),
      "utf8",
    );

    expect(workflow).toContain("name: miniprogram-resource-index");
    expect(workflow).toContain("scripts/sync-miniprogram-resources.mjs");
    expect(workflow).toContain("R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}");
    expect(workflow).toContain("R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}");
    expect(workflow).toContain("R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}");
    expect(workflow).toContain("R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}");
    expect(workflow).toContain("sync_r2:");
    expect(workflow.indexOf("npm run build")).toBeLessThan(workflow.indexOf("Upload mini-program resources to R2"));
    expect(workflow).not.toContain("echo $R2_SECRET_ACCESS_KEY");
  });

  it("covers the current 251-item generated catalog", async () => {
    const index = JSON.parse(await fs.readFile("public/images/resource-index.json", "utf8"));
    await expect(validateCatalog(index, "public/images")).resolves.toMatchObject({
      itemCount: 251,
      imageCount: 251,
    });
  });
});
