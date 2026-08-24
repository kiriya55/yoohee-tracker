import { describe, expect, it } from "vitest";
// @ts-expect-error Node parser modules are intentionally shared with the CLI.
import { mergeCatalogSources, parseBbsCatalogResponse, parseDandegateAvatarHtml, parseMccCatalogHtml } from "../../scripts/catalog-sources.mjs";
// @ts-expect-error Node parser modules are intentionally shared with the CLI.
import { findDandegatePage, parseDandegateSitemap, selectDandegateSyncTargets } from "../../scripts/dandegate-assets.mjs";

const bbsPayload = {
  Code: 0,
  data: {
    list: [
      { hero_id: 1072, hero_name: "刘莳" },
      { hero_id: 1073, hero_name: "六分仪" },
    ],
  },
};

const mccDollHtml = [
  '<a href="/doll/LiushihSSR"><img src="/static/thumbnail/doll/Avatar_Half_LiushihSSR.png"><div class="w-full h-8">刘莳</div></a>',
  '<a href="/doll/SextansSSR"><img src="/static/thumbnail/doll/Avatar_Half_SextansSSR.png"><div class="w-full h-8">六分仪</div></a>',
].join("\n");

describe("complete resource catalog sync", () => {
  it("parses BBS IDs and authoritative Chinese names", () => {
    expect(parseBbsCatalogResponse(bbsPayload, "doll", "https://bbs.example/doll")).toEqual([
      { id: 1072, type: "doll", cn: "刘莳", sourceUrl: "https://bbs.example/doll" },
      { id: 1073, type: "doll", cn: "六分仪", sourceUrl: "https://bbs.example/doll" },
    ]);
  });

  it("parses MCC resource codes and image metadata", () => {
    expect(parseMccCatalogHtml(mccDollHtml, "doll", "https://gf2.mcc.wiki/doll")).toEqual([
      {
        type: "doll",
        code: "LiushihSSR",
        cn: "刘莳",
        sourceUrl: "https://gf2.mcc.wiki/doll",
        assetSource: {
          sourceUrl: "https://gf2.mcc.wiki/static/thumbnail/doll/Avatar_Half_LiushihSSR.png",
          source: "mcc-wiki",
        },
      },
      {
        type: "doll",
        code: "SextansSSR",
        cn: "六分仪",
        sourceUrl: "https://gf2.mcc.wiki/doll",
        assetSource: {
          sourceUrl: "https://gf2.mcc.wiki/static/thumbnail/doll/Avatar_Half_SextansSSR.png",
          source: "mcc-wiki",
        },
      },
    ]);
  });

  it("extracts a Dandegate avatar URL from the dehydrated page", () => {
    expect(parseDandegateAvatarHtml(
      '{"doll":{"name":"Sextans","avatarUrl":"https://cdn.dandegate.net/dolls/sextans/hash.webp"}}',
      "https://dandegate.net/dolls/Sextans/skills",
    )).toEqual({
      name: "Sextans",
      avatarUrl: "https://cdn.dandegate.net/dolls/sextans/hash.webp",
      sourceUrl: "https://dandegate.net/dolls/Sextans/skills",
    });
  });

  it("matches code variants to Dandegate sitemap pages", () => {
    const pages = parseDandegateSitemap([
      "<loc>https://dandegate.net/dolls/Nemesis%20Gnosis</loc>",
      "<loc>https://dandegate.net/dolls/OTs-14</loc>",
    ].join(""));

    expect(findDandegatePage("NemesisGnosisSSR", pages)).toBe("https://dandegate.net/dolls/Nemesis%20Gnosis");
    expect(findDandegatePage("OTs14SSR", pages)).toBe("https://dandegate.net/dolls/OTs-14");
    expect(findDandegatePage("CharolicSR", ["https://dandegate.net/dolls/Krolik"])).toBe("https://dandegate.net/dolls/Krolik");
    expect(findDandegatePage("BiyocaSSR", ["https://dandegate.net/dolls/Belka"])).toBe("https://dandegate.net/dolls/Belka");
    expect(findDandegatePage("MacqiatoSSR", ["https://dandegate.net/dolls/Makiatto"])).toBe("https://dandegate.net/dolls/Makiatto");
    expect(findDandegatePage("NemesisSR", ["https://dandegate.net/dolls/Nemesis"])).toBe("https://dandegate.net/dolls/Nemesis");
  });

  it("refreshes Dandegate metadata for existing local dolls but skips frozen Lind", () => {
    expect(selectDandegateSyncTargets([
      { id: 1071, type: "doll", code: "BastiSSR", localIcon: "/images/doll/Avatar_Head_BastiSSR.png" },
      { id: 1072, type: "doll", code: "LiushihSSR", localIcon: "/images/doll/Avatar_Head_LiushihSSR.png" },
      { id: 1059, type: "doll", code: "LindSSR", assetSource: { frozen: true } },
      { id: 10713, type: "weapon", code: "Weapon_MK23_5" },
    ]).map((item: { id: number }) => item.id)).toEqual([1071, 1072]);
  });

  it("adds catalog gaps without deleting existing frozen resources", () => {
    const result = mergeCatalogSources(
      parseBbsCatalogResponse(bbsPayload, "doll", "https://bbs.example/doll"),
      parseMccCatalogHtml(mccDollHtml, "doll", "https://gf2.mcc.wiki/doll"),
      {
        "1059": {
          id: 1059,
          type: "doll",
          code: "LindSSR",
          cn: "琳德",
          localIcon: "/images/doll/Avatar_Head_LindSSR.png",
          assetSource: { frozen: true, source: "dandegate" },
        },
      },
    );

    expect(result.added).toEqual(["1072", "1073"]);
    expect(result.items["1072"]).toMatchObject({ id: 1072, type: "doll", code: "LiushihSSR", cn: "刘莳" });
    expect(result.items["1073"]).toMatchObject({ id: 1073, type: "doll", code: "SextansSSR", cn: "六分仪" });
    expect(result.items["1059"]).toMatchObject({
      code: "LindSSR",
      localIcon: "/images/doll/Avatar_Head_LindSSR.png",
      assetSource: { frozen: true },
    });
    expect(result.conflicts).toEqual([]);
  });
});
