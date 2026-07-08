import { describe, expect, it } from "vitest";
import { filterHighRarityEntries, paginate } from "./presentation";
import { mergePoolsByType } from "./stats";
import { normalizeRecords } from "./normalize";

describe("presentation helpers", () => {
  const group = mergePoolsByType(
    normalizeRecords([
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 1, itemId: 1001, itemName: "A", timestamp: 1, rarity: 3 },
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 1, itemId: 1002, itemName: "SR One", timestamp: 2, rarity: 4 },
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 1, itemId: 1003, itemName: "SSR One", timestamp: 3, rarity: 5 },
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 1, itemId: 1004, itemName: "SR Two", timestamp: 4, rarity: 4 },
    ]),
  )[0];

  it("filters high rarity entries by rarity and query", () => {
    const entries = group.fiveStarEntries.concat(group.fourStarEntries);

    expect(filterHighRarityEntries(entries, { rarity: "4", query: "" }).map((entry) => entry.record.itemName)).toEqual([
      "SR Two",
      "SR One",
    ]);
    expect(filterHighRarityEntries(entries, { rarity: "", query: "SSR" })).toHaveLength(1);
  });

  it("paginates with clamped page bounds", () => {
    const page = paginate([1, 2, 3, 4, 5], 3, 2);

    expect(page).toMatchObject({ items: [5], page: 3, pageSize: 2, total: 5, pageCount: 3, start: 5, end: 5 });
    expect(paginate([1, 2], 99, 10).page).toBe(1);
  });
});
