import { describe, expect, it } from "vitest";
// @ts-expect-error Node-only CLI helper has no application TypeScript declaration.
import { extractWikiruNameRecord, isWikiruUnavailablePage, parseWikiruCharacterDetailLinks } from "../../scripts/wikiru-names.mjs";

describe("wikiru detail name parser", () => {
  it("extracts Japanese, English, and Chinese names from Basti's profile row", () => {
    const html = `
      <table>
        <tr>
          <th class="style_th">名前</th>
          <td class="style_td">バスティ<br class="spacer" />Basti<br class="spacer" />贝丝蒂</td>
        </tr>
      </table>
    `;

    expect(extractWikiruNameRecord(html)).toEqual({
      jp: "バスティ",
      en: "Basti",
      cn: "贝丝蒂",
    });
  });

  it("removes a Japanese reading in parentheses while preserving Liushih and Cheyanne names", () => {
    const liushihHtml = `
      <th>名前</th>
      <td>劉蒔&nbsp;（&nbsp;りゅうし&nbsp;）<br />Liushih<br />刘莳</td>
    `;
    const cheyanneHtml = `
      <th>名前</th>
      <td>シャイアン<br class="spacer" />Cheyanne<br class="spacer" />夏安</td>
    `;

    expect(extractWikiruNameRecord(liushihHtml)).toEqual({
      jp: "劉蒔",
      en: "Liushih",
      cn: "刘莳",
    });
    expect(extractWikiruNameRecord(cheyanneHtml)).toEqual({
      jp: "シャイアン",
      en: "Cheyanne",
      cn: "夏安",
    });
  });

  it("returns undefined when the profile does not contain a name row", () => {
    expect(extractWikiruNameRecord("<table><tr><th>レアリティ</th><td>SSR</td></tr></table>")).toBeUndefined();
  });

  it("extracts character detail links from the filter-table page", () => {
    const html = `
      <div class="flex-box character" data-国内実装="済">
        <a href="./?シャイアン"><img src="avatar.png"><br>シャイアン</a>
      </div>
      <div class="character flex-box">
        <a href="https://dollsfrontline2.wikiru.jp/?ネメシス・グノーシス">ネメシス・グノーシス</a>
      </div>
    `;

    expect(parseWikiruCharacterDetailLinks(html, "https://dollsfrontline2.wikiru.jp/")).toEqual([
      {
        pageName: "シャイアン",
        url: "https://dollsfrontline2.wikiru.jp/?%E3%82%B7%E3%83%A3%E3%82%A4%E3%82%A2%E3%83%B3",
      },
      {
        pageName: "ネメシス・グノーシス",
        url: "https://dollsfrontline2.wikiru.jp/?%E3%83%8D%E3%83%A1%E3%82%B7%E3%82%B9%E3%83%BB%E3%82%B0%E3%83%8E%E3%83%BC%E3%82%B7%E3%82%B9",
      },
    ]);
  });

  it("marks Wikiru runtime-error pages as unavailable", () => {
    expect(isWikiruUnavailablePage("<html><title>Runtime error - Wikiru</title></html>")).toBe(true);
    expect(isWikiruUnavailablePage("<html><title>シャイアン - Wikiru</title></html>")).toBe(false);
  });
});
