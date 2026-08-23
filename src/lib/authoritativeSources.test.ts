import { describe, expect, it } from "vitest";
// @ts-expect-error Node parser modules are intentionally shared with the CLI.
import { parseGfl2BannersHtml, parseGfl2WeaponNames } from "../../scripts/gfl2-banners.mjs";
// @ts-expect-error Node parser modules are intentionally shared with the CLI.
import { parseBbsCategoryResponse, parseBbsHandbookResponse } from "../../scripts/exilium-bbs.mjs";

const bannerFixture = [
  '<div class="banner-past character-banner-card overflow-hidden">',
  '  <div class="banner-header"><div class="date-range">June 4, 2026 – June 24, 2026</div></div>',
  '  <div class="banner-body">',
  '    <div class="banner-character-tile"><img alt="Basti"><div class="banner-character-name"><b>Basti</b></div></div>',
  '    <div class="banner-character-tile"><img alt="Liushih"><div class="banner-character-name"><b>Liushih</b></div></div>',
  '    <div class="banner-character-tile"><img alt="Cheyanne"><div class="banner-character-name"><b>Cheyanne</b></div></div>',
  '  </div>',
  '</div>',
].join("\n");

describe("authoritative source parsers", () => {
  it("parses gfl2.help banner names and date ranges", () => {
    const result = parseGfl2BannersHtml(bannerFixture, "https://gfl2.help/en/banners");

    expect(result).toEqual([
      {
        sourceUrl: "https://gfl2.help/en/banners",
        status: "past",
        startDate: "2026-06-04",
        endDate: "2026-06-24",
        characterNames: ["Basti", "Liushih", "Cheyanne"],
      },
    ]);
  });

  it("parses visible gfl2.help weapon names and decodes entities", () => {
    const html = '<div class="weapon-item"><h6>Banshee&#39;s Whisper</h6></div><div class="weapon-item"><h6>MK23</h6></div>';

    expect(parseGfl2WeaponNames(html, "https://gfl2.help/en/weapons")).toEqual([
      { name: "Banshee's Whisper", sourceUrl: "https://gfl2.help/en/weapons" },
      { name: "MK23", sourceUrl: "https://gfl2.help/en/weapons" },
    ]);
  });

  it("parses BBS handbook category IDs and official Chinese rows", () => {
    const category = parseBbsCategoryResponse({
      Code: 0,
      data: {
        information: [
          { type: 3, title: [{ id: 1, name: "人形介绍" }, { id: 2, name: "武器介绍" }] },
        ],
      },
    });
    const dolls = parseBbsHandbookResponse({
      Code: 0,
      data: { list: [{ hero_id: 1071, hero_name: "贝丝蒂" }] },
    }, "doll", "https://gf2-bbs-api.exiliumgf.com/wiki/handbook");

    expect(category).toEqual({ dollCategoryId: 1, weaponCategoryId: 2 });
    expect(dolls).toEqual([
      {
        id: 1071,
        cn: "贝丝蒂",
        type: "doll",
        sourceUrl: "https://gf2-bbs-api.exiliumgf.com/wiki/handbook",
      },
    ]);
  });

  it("rejects failed BBS responses and malformed source markup", () => {
    expect(parseBbsCategoryResponse({ Code: 10000, data: null })).toBeUndefined();
    expect(parseBbsHandbookResponse({ Code: 0, data: { list: [{ hero_id: 0, hero_name: "" }] } }, "doll", "test")).toEqual([]);
    expect(parseGfl2BannersHtml("<div class=\"banner-past\"></div>", "test")).toEqual([]);
  });
});
