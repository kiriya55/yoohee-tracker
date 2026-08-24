import { describe, expect, it } from "vitest";
import type { ResourceItem } from "../types";
import { assetPathFor, buildAssetDescriptor } from "./assetMapping";

describe("asset mapping", () => {
  it("maps an ordinary doll to the MCC head avatar and local path", () => {
    const item: ResourceItem = { id: 1071, type: "doll", code: "BastiSSR" };

    expect(buildAssetDescriptor(item)).toEqual({
      sourceUrl: "https://gf2.mcc.wiki/image/doll/Avatar_Head_BastiSSR.png",
      targetPath: "doll/Avatar_Head_BastiSSR.png",
      localIcon: "/images/doll/Avatar_Head_BastiSSR.png",
      source: "mcc-wiki",
    });
  });

  it("maps an ordinary weapon to the MCC 1024 image", () => {
    const item: ResourceItem = { id: 10713, type: "weapon", code: "Weapon_MK23_5" };

    expect(assetPathFor(item)).toBe("weapon/Weapon_MK23_5_1024.png");
  });

  it("downloads Lind from Dandegate and publishes the Head filename", () => {
    const item: ResourceItem = { id: 1059, type: "doll", code: "LindSSR" };

    expect(buildAssetDescriptor(item)).toEqual({
      sourceUrl: "https://cdn.dandegate.net/dolls/lind/249a546c1bc34c6e201a3fb17c6b06fac85329929019d67fd8e3ef44c2c871b0.webp",
      targetPath: "doll/Avatar_Head_LindSSR.png",
      localIcon: "/images/doll/Avatar_Head_LindSSR.png",
      source: "dandegate",
      frozen: true,
    });
  });
});
