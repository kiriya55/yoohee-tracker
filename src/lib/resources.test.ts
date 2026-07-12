import { describe, expect, it } from "vitest";
import { enrichRecords, getResourceImageUrl, parseResourceIndexText, getDisplayName } from "./resources";
import { normalizeRecords } from "./normalize";

describe("resources", () => {
  it("parses resource index and enriches records", () => {
    const index = parseResourceIndexText(
      JSON.stringify({
        format: "gf2-resource-index",
        version: 1,
        items: {
          "11017": { name: "测试人形", rarity: 3, iconUrl: "/assets/test.png" },
        },
      }),
    );
    const records = normalizeRecords([
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11017, timestamp: 1 },
    ]);

    expect(index?.items["11017"].name).toBe("测试人形");
    expect(enrichRecords(records, index)[0]).toMatchObject({ itemName: "测试人形", rarity: 3 });
  });
  it("parses generated resource metadata and derives MCC image URLs from code", () => {
    const index = parseResourceIndexText(
      JSON.stringify({
        format: "gf2-resource-index",
        version: 1,
        items: {
          "1069": {
            id: 1069,
            type: "doll",
            rarity: 5,
            code: "LoreleySSR",
            server: "haoplay",
            imageSource: "mcc-wiki",
            aliases: ["Loreley"],
          },
          "10693": {
            id: 10693,
            type: "weapon",
            rarity: 5,
            code: "Weapon_DSR50_5",
            server: "haoplay",
            imageSource: "mcc-wiki",
          },
        },
      }),
    );

    expect(index?.items["1069"]).toMatchObject({
      code: "LoreleySSR",
      server: "haoplay",
      imageSource: "mcc-wiki",
      aliases: ["Loreley"],
    });
    expect(getResourceImageUrl(index, 1069)).toBe("https://gf2.mcc.wiki/image/doll/Avatar_Head_LoreleySSR.png");
    expect(getResourceImageUrl(index, 10693)).toBe("https://gf2.mcc.wiki/image/weapon/Weapon_DSR50_5_1024.png");
  });

  it("infers rarity for newly missing procurement items", () => {
    const index = parseResourceIndexText(
      JSON.stringify({
        format: "gf2-resource-index",
        version: 1,
        items: {},
      }),
    );
    const records = normalizeRecords([
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 195001, itemId: 1071, timestamp: 1 },
      { uid: "123456", server: "haoplay", poolType: 4, poolId: 196001, itemId: 10711, timestamp: 2 },
      { uid: "123456", server: "haoplay", poolType: 4, poolId: 196001, itemId: 10712, timestamp: 3 },
      { uid: "123456", server: "haoplay", poolType: 4, poolId: 196001, itemId: 10713, timestamp: 4 },
    ]);

    const enriched = enrichRecords(records, index);
    expect(enriched.map((record) => record.rarity)).toEqual([5, 3, 4, 5]);
    expect(enriched.map((record) => record.itemName)).toEqual([
      "贝丝蒂",
      "旧式马克23进攻型手枪",
      "马克23进攻型手枪",
      "告死礼赞",
    ]);
    expect(getResourceImageUrl(index, 1071)).toBe("/images/doll/Avatar_Head_BastiSSR.png");
    expect(getResourceImageUrl(index, 10713)).toBe("/images/weapon/Weapon_MK23_5_1024.png");
  });

  it("uses bundled Basti and MK23 resources with a stale index", () => {
    const index = parseResourceIndexText(
      JSON.stringify({
        format: "gf2-resource-index",
        version: 1,
        items: {
          "1071": { id: 1071, type: "doll", rarity: 5, code: "BastiSSR", iconUrl: "https://gf2.mcc.wiki/image/doll/Avatar_Head_BastiSSR.png" },
          "10713": { id: 10713, type: "weapon", rarity: 5, code: "Weapon_MK23_5", iconUrl: "https://gf2.mcc.wiki/image/weapon/Weapon_MK23_5_1024.png" },
        },
      }),
    );

    expect(getResourceImageUrl(index, 1071)).toBe("/images/doll/Avatar_Head_BastiSSR.png");
    expect(getResourceImageUrl(index, 10713)).toBe("/images/weapon/Weapon_MK23_5_1024.png");
    expect(getDisplayName(index, 1071, "en")).toBe("Basti");
    expect(getDisplayName(index, 10713, "en")).toBe("MK23");
  });

  it("uses bundled i18n names when resource indexes contain raw numeric text", () => {
    const index = parseResourceIndexText(
      JSON.stringify({
        format: "gf2-resource-index",
        version: 1,
        items: {
          "1027": { id: 1027, name: "3777", type: "doll", rarity: 5, code: "QiongjiuSSR" },
        },
      }),
    );
    const records = normalizeRecords([
      { uid: "123456", server: "haoplay", poolType: 1, poolId: 1001, itemId: 1027, timestamp: 1 },
    ]);

    expect(enrichRecords(records, index)[0]).toMatchObject({ itemName: "琼玖", rarity: 5 });
  });

  it("translates items to English and Japanese", () => {
    const index = parseResourceIndexText(
      JSON.stringify({
        format: "gf2-resource-index",
        version: 1,
        items: {
          "1001": { id: 1001, name: "7930", type: "doll", rarity: 4, code: "CharolicSR", cn: "克罗丽科", en: "Krolik", jp: "キャロリック" },
          "10002": { id: 10002, name: "28363", type: "weapon", rarity: 5, code: "Weapon_BpSMGssr001_5", cn: "绝密手稿", en: "Classified Manuscript", jp: "極秘手稿" },
        },
      }),
    );
    expect(getDisplayName(index, 1001, "en")).toBe("Krolik");
    expect(getDisplayName(index, 1001, "jp")).toBe("キャロリック");
    expect(getDisplayName(index, 10002, "en")).toBe("Classified Manuscript");
    expect(getDisplayName(index, 10002, "jp")).toBe("極秘手稿");
  });
});
