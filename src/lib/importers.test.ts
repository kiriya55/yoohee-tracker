import { describe, expect, it } from "vitest";
import { parseImportText } from "./importers";

describe("parseImportText", () => {
  it("parses portable records from an unwrapped array or generic records object", () => {
    const arrayResult = parseImportText(
      JSON.stringify([
        { uid: "123456", server: "haoplay", type_id: 3, pool_id: 118001, item: 1069, time: 1782373017, quality: 5, item_num: 1 },
      ]),
    );
    const objectResult = parseImportText(
      JSON.stringify({
        uid: "123456",
        server: "haoplay",
        records: [{ pool_type: 4, pool_id: 196001, item_id: 10693, timestamp: 1782374017 }],
      }),
    );

    expect(arrayResult).toMatchObject({ ok: true, format: "record-list" });
    expect(arrayResult.records[0]).toMatchObject({ uid: "123456", poolType: 3, itemId: 1069, rarity: 5, pullNumber: 1 });
    expect(objectResult).toMatchObject({ ok: true, format: "record-list" });
    expect(objectResult.records[0]).toMatchObject({ uid: "123456", server: "haoplay", poolType: 4, itemId: 10693 });
  });

  it("parses a single official API response page when it is saved as JSON", () => {
    const result = parseImportText(
      JSON.stringify({
        code: 0,
        data: { list: [{ pool_id: 118001, item: 1069, time: 1782373017, type_id: 3, uid: "123456", server: "haoplay" }] },
      }),
    );

    expect(result).toMatchObject({ ok: true, format: "official-api-response" });
    expect(result.records[0]).toMatchObject({ uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 1069 });
  });

  it("reports a resource index separately instead of treating it as record data", () => {
    const result = parseImportText(JSON.stringify({ format: "gf2-resource-index", version: 1, items: { "1069": { id: 1069 } } }));

    expect(result.ok).toBe(false);
    expect(result.format).toBe("gf2-resource-index");
    expect(result.errors[0]).toMatchObject({ key: "resourceIndexNotRecordData" });
  });

  it("parses merged normalized JSON", () => {
    const result = parseImportText(
      JSON.stringify({
        uid: "123456",
        exiliumServer: "haoplay",
        total: 1,
        records: [{ pool_type: 1, pool_id: 1001, item_id: 1001, timestamp: 1733623496, rarity: 4, source: "exilium" }],
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.format).toBe("merged-normalized");
    expect(result.records[0]).toMatchObject({ uid: "123456", server: "haoplay", poolType: 1, itemId: 1001 });
  });

  it("parses decrypted exilium profile pulls", () => {
    const result = parseImportText(
      JSON.stringify({
        state: {
          profilesData: {
            "main-profile": {
              pulls: {
                "3": [{ pool_id: 1031001, item: 10391, time: 1733625317, type_id: 3, uid: "123456", server: "haoplay", rarity: 3 }],
              },
            },
          },
        },
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.format).toBe("exilium-decrypted");
    expect(result.records[0]).toMatchObject({ poolType: 3, poolId: 1031001, itemId: 10391 });
  });

  it("parses gfl2.help compact pull history exports", () => {
    const result = parseImportText(
      JSON.stringify({
        "hao-asia": {
          "1": [
            { pool_id: 1001, item: 11045, time: 1782003380, item_num: 1, quality: 3 },
            { pool_id: 1001, item: 1069, time: 1782003381, item_num: 1, quality: 5 },
          ],
          "3": [],
        },
        "dw-us": {
          "4": [{ pool_id: 4001, item: 10693, time: 1782003382, item_num: 1, quality: 5 }],
        },
      }),
      "gfl2help-pull-history.json",
    );

    expect(result.ok).toBe(true);
    expect(result.format).toBe("gfl2-help");
    expect(result.records).toHaveLength(3);
    expect(result.records[0]).toMatchObject({ server: "haoplay", poolType: 1, poolId: 1001, itemId: 11045, timestamp: 1782003380, rarity: 3, source: "gfl2-help" });
    expect(result.records[2]).toMatchObject({ server: "darkwinter", poolType: 4, poolId: 4001, itemId: 10693, rarity: 5 });
  });

});
