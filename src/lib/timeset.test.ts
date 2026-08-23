import { describe, expect, it } from "vitest";
// @ts-expect-error The deterministic timeset helper is shared with the Node CLI.
import { computeTimesetHash, findUniqueTimeset, mergeServerResourceIndexes, normalizeTimesets } from "../../scripts/timeset.mjs";

describe("timeset and server resource merging", () => {
  it("normalizes banner dates and up item IDs", () => {
    expect(normalizeTimesets("haoplay", {
      banner: [{
        id: 7,
        name: "Basti Is Rate Up!",
        start_time: 1773878400,
        end_time: 1775692800,
        pool_type: 3,
        pool_id: 118001,
        up_item_ids: [1071],
      }],
    })).toEqual([{
      key: "haoplay:118001",
      server: "haoplay",
      poolId: 118001,
      poolType: 3,
      name: "Basti Is Rate Up!",
      startTime: "2026-03-19T00:00:00.000Z",
      endTime: "2026-04-09T00:00:00.000Z",
      upItemIds: [1071],
      source: "exilium",
    }]);
  });

  it("hashes timesets independently of input order and generated time", () => {
    const a = normalizeTimesets("haoplay", { banner: [{ id: 1, name: "A", start_time: 10, end_time: 20, up_item_ids: [1] }] });
    const b = normalizeTimesets("haoplay", { banner: [{ id: 1, name: "A", start_time: 10, end_time: 20, up_item_ids: [1] }] });

    expect(computeTimesetHash(a)).toBe(computeTimesetHash([...b].reverse()));
  });

  it("merges identical resources and keeps server arrays", () => {
    const merged = mergeServerResourceIndexes([
      { servers: ["dw-cn"], items: { "1": { id: 1, type: "doll", code: "A", servers: ["dw-cn"] } } },
      { servers: ["haoplay"], items: { "1": { id: 1, type: "doll", code: "A", servers: ["haoplay"] } } },
    ]);

    expect(merged.items["1"].servers).toEqual(["dw-cn", "haoplay"]);
    expect(merged.servers).toEqual(["dw-cn", "haoplay"]);
  });

  it("returns no schedule for ambiguous pool matches", () => {
    const timesets = [
      { key: "haoplay:1", server: "haoplay", poolType: 3, upItemIds: [1071] },
      { key: "haoplay:2", server: "haoplay", poolType: 3, upItemIds: [1071] },
    ];
    expect(findUniqueTimeset(timesets, 3, [{ itemId: 1071 }])).toBeUndefined();
  });
});
