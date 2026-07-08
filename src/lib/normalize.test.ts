import { describe, expect, it } from "vitest";
import { exportPortable, mergeRecords, normalizeRecords } from "./normalize";
import type { GachaRecord } from "../types";

describe("normalizeRecords", () => {
  it("preserves identical items pulled in the same second", () => {
    const records = normalizeRecords([
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11017, timestamp: 1782373017, source: "elmobeacon-capture" },
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11017, timestamp: 1782373017, source: "elmobeacon-capture" },
    ]);

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.sameItemIndex)).toEqual([0, 1]);
    expect(new Set(records.map((record) => record.id)).size).toBe(2);
  });

  it("drops mystery box pool records during normalization", () => {
    const records = normalizeRecords([
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11017, timestamp: 1782373017 },
      { uid: "123456", server: "haoplay", poolType: 8, poolId: 99001, itemId: 9010, timestamp: 1782373018 },
      { uid: "123456", server: "haoplay", poolType: 9, poolId: 188001, itemId: 273, timestamp: 1782373019 },
    ]);

    expect(records.map((record) => record.poolType)).toEqual([3]);
  });
});

describe("mergeRecords", () => {
  it("deduplicates repeated imports without deleting legitimate same-second duplicates", () => {
    const imported = [
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11017, timestamp: 1782373017, source: "elmobeacon-capture" },
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11017, timestamp: 1782373017, source: "elmobeacon-capture" },
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11030, timestamp: 1782373017, source: "elmobeacon-capture" },
    ];
    const first = mergeRecords([], imported, "2026-06-25T00:00:00.000Z");
    const second = mergeRecords(first.records as GachaRecord[], imported, "2026-06-25T00:00:01.000Z");

    expect(first.records).toHaveLength(3);
    expect(second.records).toHaveLength(3);
    expect(second.duplicates).toBe(3);
  });

  it("prunes mystery box records from existing and incoming records", () => {
    const [standardRecord] = normalizeRecords([
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11017, timestamp: 1782373017 },
    ]) as GachaRecord[];
    const existingMysteryBoxRecord: GachaRecord = {
      id: "123456:haoplay:8:99001:1782373018:0:9010:0",
      uid: "123456",
      server: "haoplay",
      poolType: 8,
      poolId: 99001,
      itemId: 9010,
      timestamp: 1782373018,
      orderInSecond: 0,
      sameItemIndex: 0,
      source: "exilium-decrypted",
      importedAt: "2026-06-25T00:00:00.000Z",
    };
    const existing = [standardRecord, existingMysteryBoxRecord];

    const merged = mergeRecords(existing, [
      { uid: "123456", server: "haoplay", poolType: 9, poolId: 188001, itemId: 273, timestamp: 1782373019 },
      { uid: "123456", server: "haoplay", poolType: 4, poolId: 196001, itemId: 10713, timestamp: 1782373020 },
    ]);

    expect(merged.records.map((record) => record.poolType).sort()).toEqual([3, 4]);
  });
});

describe("exportPortable", () => {
  it("omits mystery box pool records from portable exports", () => {
    const records = normalizeRecords([
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11017, timestamp: 1782373017 },
      { uid: "123456", server: "haoplay", poolType: 8, poolId: 99001, itemId: 9010, timestamp: 1782373018 },
      { uid: "123456", server: "haoplay", poolType: 9, poolId: 188001, itemId: 273, timestamp: 1782373019 },
    ]) as GachaRecord[];

    const portable = exportPortable(records);

    expect(portable.records.map((record) => record.poolType)).toEqual([3]);
  });
});
