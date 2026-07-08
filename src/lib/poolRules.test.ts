import { describe, expect, it } from "vitest";
import { describeOffRate, isOffRatePermanent } from "./poolRules";

describe("pool rules", () => {
  it("marks permanent dolls pulled in limited doll pools as off-rate", () => {
    expect(isOffRatePermanent({ poolType: 3, itemId: 1029, rarity: 5 })).toBe(true);
    expect(isOffRatePermanent({ poolType: 6, itemId: 1029, rarity: 5 })).toBe(true);
    expect(describeOffRate({ poolType: 3, itemId: 1029, rarity: 5 })).toBe("歪");
  });

  it("marks permanent weapons pulled in limited weapon pools as off-rate", () => {
    expect(isOffRatePermanent({ poolType: 4, itemId: 11016, rarity: 5 })).toBe(true);
    expect(isOffRatePermanent({ poolType: 7, itemId: 11016, rarity: 5 })).toBe(true);
    expect(describeOffRate({ poolType: 4, itemId: 11016, rarity: 5 })).toBe("歪");
  });

  it("does not mark permanent pool, lower rarity, or non-permanent limited items", () => {
    expect(isOffRatePermanent({ poolType: 1, itemId: 1029, rarity: 5 })).toBe(false);
    expect(isOffRatePermanent({ poolType: 3, itemId: 1029, rarity: 4 })).toBe(false);
    expect(isOffRatePermanent({ poolType: 3, itemId: 1069, rarity: 5 })).toBe(false);
    expect(isOffRatePermanent({ poolType: 4, itemId: 10713, rarity: 5 })).toBe(false);
    expect(isOffRatePermanent({ poolType: 4, itemId: 11016, rarity: 4 })).toBe(false);
  });
});
