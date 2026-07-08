import { describe, expect, it } from "vitest";
import {
  buildMccImageUrl,
  extractExiliumChunkResources,
  extractServerUpdateSignals,
  mergeResourceIndexItems,
} from "./resourceUpdater";
import type { ResourceIndex } from "../types";

describe("resourceUpdater", () => {
  it("extracts server-specific update signals from exilium notices and banners", () => {
    const payload = {
      notice: [
        {
          id: 537,
          name: "Server Maintenance Announcement",
          start_time: 1782266400,
          end_time: 1782489599,
          content: `
            <p>- New Doll -<br>
            ■ Elite Doll [Loreley]<br>
            ■ Elite Doll [Harpsy]<br><br>
            - New Weapons -<br>
            ■ Elite Weapon [Nighttide Nocturne]<br>
            ■ Standard Weapon [.50BMG Anti-Materiel Rifle]<br>
            ■ Retired Weapon [Retired .50BMG Anti-Materiel Rifle]<br>
            ■ Elite Weapon [Antinomy]<br>
            ■ Standard Weapon [TMP]<br>
            ■ Retired Weapon [Retired TMP]<br><br>
            Rate Up Event [Targeted Procurement] and [Military Upgrade].<br>
            During the event, the drop rate for Elite Doll [Loreley] and Elite Weapon [Nighttide Nocturne] will be increased.</p>
          `,
        },
      ],
      banner: [
        { id: 533, name: "Loreley Is Rate Up!", start_time: 1782349200, end_time: 1784113199 },
        { id: 532, name: "Lainie Is Rate Up!", start_time: 1782349200, end_time: 1784113199 },
      ],
    };

    const signals = extractServerUpdateSignals("haoplay", payload);

    expect(signals.server).toBe("haoplay");
    expect(signals.newDolls).toEqual(["Loreley", "Harpsy"]);
    expect(signals.newWeapons).toEqual([
      "Nighttide Nocturne",
      ".50BMG Anti-Materiel Rifle",
      "Retired .50BMG Anti-Materiel Rifle",
      "Antinomy",
      "TMP",
      "Retired TMP",
    ]);
    expect(signals.rateUpNames).toEqual(["Loreley", "Lainie"]);
    expect(signals.sourceNoticeIds).toEqual([537, 533, 532]);
  });

  it("extracts item ids and code values from exilium resource chunks", () => {
    const chunk = `
      let dollA={};dollA.id=1069,dollA.name="380154",dollA.avatar="LoreleySSR",dollA.rarity=5;
      let dollB={};dollB.id=1049,dollB.name="383024",dollB.avatar="HarpsySSR",dollB.rarity=5;
      let weaponA={};weaponA.id=10693,weaponA.name="385597",weaponA.imageCode="Weapon_DSR50_5",weaponA.rarity=5;
      let weaponB={};weaponB.id=10493,weaponB.name="385989",weaponB.imageCode="Weapon_SteyrTMP_5",weaponB.rarity=5;
    `;

    const items = extractExiliumChunkResources(chunk, { server: "haoplay" });

    expect(items).toEqual([
      {
        id: 1069,
        name: "Loreley",
        type: "doll",
        rarity: 5,
        code: "LoreleySSR",
        server: "haoplay",
        iconUrl: "https://gf2.mcc.wiki/image/doll/Avatar_Head_LoreleySSR.png",
        imageSource: "mcc-wiki",
      },
      {
        id: 1049,
        name: "Harpsy",
        type: "doll",
        rarity: 5,
        code: "HarpsySSR",
        server: "haoplay",
        iconUrl: "https://gf2.mcc.wiki/image/doll/Avatar_Head_HarpsySSR.png",
        imageSource: "mcc-wiki",
      },
      {
        id: 10693,
        name: "Weapon_DSR50",
        type: "weapon",
        rarity: 5,
        code: "Weapon_DSR50_5",
        server: "haoplay",
        iconUrl: "https://gf2.mcc.wiki/image/weapon/Weapon_DSR50_5_1024.png",
        imageSource: "mcc-wiki",
      },
      {
        id: 10493,
        name: "Weapon_SteyrTMP",
        type: "weapon",
        rarity: 5,
        code: "Weapon_SteyrTMP_5",
        server: "haoplay",
        iconUrl: "https://gf2.mcc.wiki/image/weapon/Weapon_SteyrTMP_5_1024.png",
        imageSource: "mcc-wiki",
      },
    ]);
  });

  it("builds MCC image URLs from code and item type", () => {
    expect(buildMccImageUrl({ type: "doll", code: "LoreleySSR" })).toBe(
      "https://gf2.mcc.wiki/image/doll/Avatar_Head_LoreleySSR.png",
    );
    expect(buildMccImageUrl({ type: "weapon", code: "Weapon_DSR50_5" })).toBe(
      "https://gf2.mcc.wiki/image/weapon/Weapon_DSR50_5_1024.png",
    );
  });

  it("merges generated items into a resource index without losing manual names", () => {
    const existing: ResourceIndex = {
      format: "gf2-resource-index",
      version: 1,
      source: "manual",
      generatedAt: "2026-06-01T00:00:00.000Z",
      items: {
        "1069": {
          id: 1069,
          name: "洛蕾莱",
          type: "doll",
          rarity: 5,
          code: "LoreleySSR",
          iconUrl: "/local/loreley.png",
        },
      },
    };

    const merged = mergeResourceIndexItems(existing, [
      {
        id: 1069,
        name: "Loreley",
        type: "doll",
        rarity: 5,
        code: "LoreleySSR",
        server: "haoplay",
        iconUrl: "https://gf2.mcc.wiki/image/doll/Avatar_Head_LoreleySSR.png",
        imageSource: "mcc-wiki",
      },
      {
        id: 1049,
        type: "doll",
        rarity: 5,
        code: "HarpsySSR",
        server: "haoplay",
        iconUrl: "https://gf2.mcc.wiki/image/doll/Avatar_Head_HarpsySSR.png",
      },
    ]);

    expect(merged.items["1069"]).toMatchObject({
      name: "洛蕾莱",
      iconUrl: "/local/loreley.png",
      code: "LoreleySSR",
      server: "haoplay",
    });
    expect(merged.items["1049"]).toMatchObject({ code: "HarpsySSR", server: "haoplay" });
  });
});
