import { describe, expect, it } from "vitest";
// @ts-expect-error The timestamp-stability helper is shared with the Node CLI.
import { mergeIndex, combinedIndexChanged, catalogSignature } from "../../scripts/resource-index-stability.mjs";
// @ts-expect-error The deterministic timeset helper is shared with the Node CLI.
import { computeTimesetHash } from "../../scripts/timeset.mjs";

const OLD_TIME = "2026-01-01T00:00:00.000Z";
const NEW_TIME = "2026-09-01T11:00:00.000Z";

function catalogItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1001,
    type: "doll",
    code: "TestSSR",
    name: "Test Doll",
    rarity: 5,
    iconUrl: "https://example.test/TestSSR.png",
    imageSource: "mcc-wiki",
    server: "haoplay",
    verifiedAt: NEW_TIME,
    ...overrides,
  };
}

function existingIndex() {
  return {
    format: "gf2-resource-index",
    version: 1,
    source: "exilium-events-and-mcc-wiki",
    generatedAt: OLD_TIME,
    servers: ["haoplay"],
    updateSignals: { haoplay: { server: "haoplay", newDolls: [], newWeapons: [], rateUpNames: [], sourceNoticeIds: [1] } },
    timesets: [
      { key: "haoplay:10", server: "haoplay", poolId: 10, poolType: 1, name: "Banner", startTime: OLD_TIME, endTime: OLD_TIME, upItemIds: [1001], source: "exilium" },
      { key: "dw-cn:20", server: "dw-cn", poolId: 20, poolType: 1, name: "CN Banner", startTime: OLD_TIME, endTime: OLD_TIME, upItemIds: [2002], source: "exilium" },
    ],
    timesetHash: "ignored-by-merge",
    items: {
      "1001": {
        id: 1001,
        type: "doll",
        code: "TestSSR",
        name: "Test Doll",
        rarity: 5,
        iconUrl: "https://example.test/TestSSR.png",
        imageSource: "mcc-wiki",
        cn: "测试",
        localIcon: "/images/doll/TestSSR.png",
        verifiedAt: OLD_TIME,
      },
    },
  };
}

describe("resource index timestamp stability", () => {
  it("keeps verifiedAt and generatedAt when the catalog is unchanged", () => {
    const existing = existingIndex();
    const { index, hasSubstantiveChange } = mergeIndex(existing, [catalogItem()], {
      generatedAt: NEW_TIME,
      servers: ["haoplay"],
      updateSignals: { haoplay: { server: "haoplay", newDolls: [], newWeapons: [], rateUpNames: [], sourceNoticeIds: [1] } },
      timesets: existing.timesets.filter((t: { server: string }) => t.server === "haoplay"),
    });

    expect(hasSubstantiveChange).toBe(false);
    expect(index.generatedAt).toBe(OLD_TIME);
    expect(index.items["1001"].verifiedAt).toBe(OLD_TIME);
    // downstream-merged fields must survive
    expect(index.items["1001"].cn).toBe("测试");
    expect(index.items["1001"].localIcon).toBe("/images/doll/TestSSR.png");
  });

  it("refreshes timestamps when a catalog field changes", () => {
    const existing = existingIndex();
    const changed = catalogItem({ code: "TestSSR_Renamed", iconUrl: "https://example.test/New.png" });
    const { index, hasSubstantiveChange, catalogChanged } = mergeIndex(existing, [changed], {
      generatedAt: NEW_TIME,
      servers: ["haoplay"],
      updateSignals: { haoplay: { server: "haoplay", newDolls: [], newWeapons: [], rateUpNames: [], sourceNoticeIds: [1] } },
      timesets: existing.timesets.filter((t: { server: string }) => t.server === "haoplay"),
    });

    expect(catalogChanged).toBe(true);
    expect(hasSubstantiveChange).toBe(true);
    expect(index.generatedAt).toBe(NEW_TIME);
    expect(index.items["1001"].verifiedAt).toBe(NEW_TIME);
    expect(index.items["1001"].code).toBe("TestSSR_Renamed");
  });

  it("flags a change when a new catalog item is added", () => {
    const existing = existingIndex();
    const { index, catalogChanged } = mergeIndex(existing, [catalogItem(), catalogItem({ id: 1002, code: "NewSSR" })], {
      generatedAt: NEW_TIME,
      servers: ["haoplay"],
      updateSignals: { haoplay: { server: "haoplay", newDolls: ["New Doll"], newWeapons: [], rateUpNames: [], sourceNoticeIds: [1] } },
      timesets: existing.timesets.filter((t: { server: string }) => t.server === "haoplay"),
    });

    expect(catalogChanged).toBe(true);
    expect(index.generatedAt).toBe(NEW_TIME);
    expect(index.items["1002"].verifiedAt).toBe(NEW_TIME);
  });

  it("ignores other servers' timesets when judging change for the synced server", () => {
    const existing = existingIndex();
    // haoplay timeset identical; dw-cn differs but we are only syncing haoplay
    const haoplayTimeset = existing.timesets.find((t: { server: string }) => t.server === "haoplay");
    const { hasSubstantiveChange, timesetChanged } = mergeIndex(existing, [catalogItem()], {
      generatedAt: NEW_TIME,
      servers: ["haoplay"],
      updateSignals: { haoplay: { server: "haoplay", newDolls: [], newWeapons: [], rateUpNames: [], sourceNoticeIds: [1] } },
      timesets: [haoplayTimeset],
    });

    expect(timesetChanged).toBe(false);
    expect(hasSubstantiveChange).toBe(false);
  });

  it("detects timeset changes within the synced server", () => {
    const existing = existingIndex();
    const { timesetChanged, hasSubstantiveChange } = mergeIndex(existing, [catalogItem()], {
      generatedAt: NEW_TIME,
      servers: ["haoplay"],
      updateSignals: { haoplay: { server: "haoplay", newDolls: [], newWeapons: [], rateUpNames: [], sourceNoticeIds: [1] } },
      timesets: [
        { key: "haoplay:11", server: "haoplay", poolId: 11, poolType: 1, name: "New Banner", startTime: NEW_TIME, endTime: NEW_TIME, upItemIds: [1001], source: "exilium" },
      ],
    });

    expect(timesetChanged).toBe(true);
    expect(hasSubstantiveChange).toBe(true);
  });

  it("combinedIndexChanged is false on identical multi-server content", () => {
    const existing = existingIndex();
    existing.servers = ["dw-cn", "haoplay"];
    const combined = {
      ...existing,
      generatedAt: NEW_TIME,
      timesetHash: computeTimesetHash(existing.timesets),
    };
    expect(combinedIndexChanged(existing, combined, ["dw-cn", "haoplay"])).toBe(false);
  });

  it("combinedIndexChanged is true when a catalog item moves", () => {
    const existing = existingIndex();
    const combined = {
      ...existing,
      timesetHash: "hash",
      items: {
        "1001": { ...existing.items["1001"], code: "Changed" },
      },
    };
    expect(catalogSignature(existing.items["1001"]) === catalogSignature(combined.items["1001"])).toBe(false);
    expect(combinedIndexChanged(existing, combined, ["dw-cn", "haoplay"])).toBe(true);
  });
});
