import { describe, expect, it } from "vitest";
import { formatPoolSchedule, getPoolDetailTitle, resolvePoolSchedule } from "./poolSchedule";

const translate = (key: string) => ({
  poolPickupDoll: "限定人形",
  poolPickupWeapon: "限定武器",
  poolPickupOther: "卡池",
  poolTypeDoll: "定向采购",
  poolTypeWeapon: "军备提升",
  poolTypeOther: "其它卡池",
}[key] ?? key);

describe("pool schedule presentation", () => {
  it("uses localized pickup titles instead of hard-coded English copy", () => {
    expect(getPoolDetailTitle(3, "zh", translate)).toEqual({
      eyebrow: "限定人形",
      title: "定向采购",
    });
    expect(getPoolDetailTitle(4, "zh", translate)).toEqual({
      eyebrow: "限定武器",
      title: "军备提升",
    });
  });

  it("formats a stable UTC date range", () => {
    expect(formatPoolSchedule({
      key: "haoplay:1",
      server: "haoplay",
      poolType: 3,
      startTime: "2026-03-19T00:00:00.000Z",
      endTime: "2026-04-09T00:00:00.000Z",
      upItemIds: [1071],
      source: "exilium",
    }, "en")).toBe("Mar 19 – Apr 9, 2026");
  });

  it("does not display an ambiguous schedule", () => {
    const result = resolvePoolSchedule({
      format: "gf2-resource-index",
      version: 1,
      timesets: [
        { key: "haoplay:1", server: "haoplay", poolType: 3, upItemIds: [1071], source: "exilium" },
        { key: "haoplay:2", server: "haoplay", poolType: 3, upItemIds: [1071], source: "exilium" },
      ],
      items: {},
    }, {
      poolType: 3,
      label: "定向采购",
      records: [{ itemId: 1071 } as never],
      count: 1,
      fiveStarEntries: [],
      fourStarEntries: [],
    });

    expect(result).toBeUndefined();
  });
});
