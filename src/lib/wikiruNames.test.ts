import { describe, expect, it } from "vitest";
// @ts-expect-error Node-only CLI helper has no application TypeScript declaration.
import { extractWikiruNameRecord } from "../../scripts/wikiru-names.mjs";

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
});
