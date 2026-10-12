import { describe, expect, it } from "vitest";
// @ts-expect-error Shared Node CLI policy.
import { relevantTimesets, preserveResourceTimestamps } from "../../scripts/resource-change-policy.mjs";
// @ts-expect-error Shared Node CLI helper.
import { mergeIndex, combinedIndexChanged } from "../../scripts/resource-index-stability.mjs";

const old = "2026-01-01T00:00:00Z";
const fresh = "2026-10-12T00:00:00Z";
const item = { id: 1, type: "doll", code: "A", name: "A", verifiedAt: old };
const previous = {
  generatedAt: old, servers: ["haoplay"], items: { "1": item },
  updateSignals: { haoplay: { sourceNoticeIds: [609], rateUpNames: ["Mityl"] } },
  timesets: [{ key: "haoplay:609", name: "Illustration Contest", server: "haoplay" }],
};

describe("resource publication policy", () => {
  it("keeps ambiguous schedules and typed banners even with outfit names", () => {
    const schedules = [
      { name: "Outfit - Wisteria" }, { name: "Illustration Contest" },
      { name: "Odd One Out: Groza vs OTs-14" },
      { name: "Outfit banner", poolType: 3 },
      { name: "Outfit banner", upItemIds: [1] },
      { name: "Mityl Is Rate Up!" }, { name: "Unknown" },
    ];
    expect(relevantTimesets(schedules)).toEqual(schedules.slice(3));
  });

  it("does not mark notice-only changes as a required refresh", () => {
    const metadata = { generatedAt: fresh, servers: ["haoplay"],
      updateSignals: { haoplay: { sourceNoticeIds: [612], rateUpNames: ["Mityl"] } }, timesets: [] };
    const result = mergeIndex(previous, [{ ...item, verifiedAt: fresh }], metadata);
    expect(result.hasSubstantiveChange).toBe(false);
    expect(result.index.generatedAt).toBe(old);
    expect(combinedIndexChanged(previous, result.index, ["haoplay"])).toBe(false);
  });

  it("preserves timestamps after downstream image and name merges", () => {
    const candidate = structuredClone(previous);
    candidate.generatedAt = fresh;
    candidate.items["1"].verifiedAt = fresh;
    candidate.timesets = [];
    candidate.updateSignals.haoplay.sourceNoticeIds = [612];
    const stable = preserveResourceTimestamps(previous, candidate);
    expect(stable.generatedAt).toBe(old);
    expect(stable.items["1"].verifiedAt).toBe(old);
  });

  it("preserves only unchanged item timestamps on a real update", () => {
    const candidate = { ...structuredClone(previous), generatedAt: fresh,
      items: { "1": { ...item, verifiedAt: fresh }, "2": { ...item, id: 2, verifiedAt: fresh } } };
    const stable = preserveResourceTimestamps(previous, candidate);
    expect(stable.generatedAt).toBe(fresh);
    expect(stable.items["1"].verifiedAt).toBe(old);
    expect(stable.items["2"].verifiedAt).toBe(fresh);
  });
});
