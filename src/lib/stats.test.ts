import { describe, expect, it } from "vitest";
import { computeGachaStats, computeStats, filterRecords, groupRecordsByPool, mergePoolsByType, pityColor, poolTypeLabel, computeCommanderProfile } from "./stats";
import { normalizeRecords } from "./normalize";

describe("stats", () => {
  const records = normalizeRecords([
    { uid: "123456", server: "haoplay", poolType: 1, poolId: 1001, itemId: 1001, timestamp: 10, rarity: 5, source: "exilium-decrypted" },
    { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11017, timestamp: 20, rarity: 3, source: "elmobeacon-capture" },
    { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11017, timestamp: 21, rarity: 4, source: "elmobeacon-capture" },
    { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 1069, timestamp: 22, rarity: 5, itemName: "洛蕾莱", source: "elmobeacon-capture" },
  ]);

  it("computes dashboard stats", () => {
    const stats = computeStats(records);

    expect(stats.total).toBe(4);
    expect(stats.highRarity).toBe(2);
    expect(stats.uniquePools).toBe(2);
    expect(stats.latestTimestamp).toBe(22);
  });

  it("filters by pool type and query", () => {
    expect(filterRecords(records, { poolType: "3", rarity: "", source: "", query: "11017" })).toHaveLength(2);
  });

  it("labels known and unknown pool types", () => {
    expect(poolTypeLabel(1)).toBe("常规采购");
    expect(poolTypeLabel(3)).toBe("定向采购");
    expect(poolTypeLabel(4)).toBe("军备提升");
    expect(poolTypeLabel(6)).toBe("自选采购·人形");
    expect(poolTypeLabel(7)).toBe("自选采购·军备");
    expect(poolTypeLabel(8)).toBe("神秘箱");
    expect(poolTypeLabel(99)).toBe("池类型 99");
  });

  it("computes gacha stats without mystery box records", () => {
    const mixed = normalizeRecords([
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11017, timestamp: 1, rarity: 3 },
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 1069, timestamp: 2, rarity: 5 },
      { uid: "123456", server: "haoplay", poolType: 8, poolId: 99001, itemId: 9010, timestamp: 3, rarity: 5 },
      { uid: "123456", server: "haoplay", poolType: 9, poolId: 188001, itemId: 273, timestamp: 4, rarity: 5 },
    ]);

    const stats = computeGachaStats(mixed);

    expect(stats.total).toBe(2);
    expect(stats.highRarity).toBe(1);
    expect(stats.currentPity).toBe(0);
  });

  it("does not present mystery box records after normalization", () => {
    const mixed = normalizeRecords([
      { uid: "123456", server: "haoplay", poolType: 8, poolId: 99001, itemId: 9010, timestamp: 1, rarity: 5 },
      { uid: "123456", server: "haoplay", poolType: 9, poolId: 188001, itemId: 273, timestamp: 2, rarity: 5 },
    ]);

    const groups = mergePoolsByType(mixed);

    expect(groups).toHaveLength(0);
  });

  it("colors SSR pity like exilium luck bands", () => {
    expect(pityColor(1, 5)).toBe("green");
    expect(pityColor(32, 5)).toBe("green");
    expect(pityColor(33, 5)).toBe("yellow");
    expect(pityColor(64, 5)).toBe("yellow");
    expect(pityColor(65, 5)).toBe("red");
  });

  it("tracks SR and SSR shipment counts separately", () => {
    const mixed = normalizeRecords([
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11017, timestamp: 1, rarity: 3 },
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11018, timestamp: 2, rarity: 3 },
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 1036, timestamp: 3, rarity: 4 },
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11019, timestamp: 4, rarity: 3 },
      { uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 1069, timestamp: 5, rarity: 5 },
    ]);

    const group = mergePoolsByType(mixed)[0];

    expect(group.fourStarEntries[0].pity).toBe(3);
    expect(group.fiveStarEntries[0].pity).toBe(5);
  });

  it("groups records by pool and infers up item names", () => {
    const groups = groupRecordsByPool(records);
    expect(groups).toHaveLength(2);

    const limited = groups.find((g) => g.poolId === 118001);
    expect(limited).toBeDefined();
    expect(limited?.count).toBe(3);
    expect(limited?.highRarity).toBe(1);
    expect(limited?.fourStar).toBe(1);
    expect(limited?.upItemNames).toContain("洛蕾莱");
    expect(limited?.poolLabel).toContain("定向采购");
  });

  it("computes commander profile stats, luck index, and tags", () => {
    const luckyRecords: any[] = [];
    let t = 1000;
    // Add 10 pulls ending with a 5-star UP (Loreley, id 1069)
    for (let i = 0; i < 9; i++) {
      luckyRecords.push({ uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11017, timestamp: t++, rarity: 3, source: "exilium-decrypted" });
    }
    luckyRecords.push({ uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 1069, timestamp: t++, rarity: 5, source: "exilium-decrypted" }); // pity 10
    
    // Add 10 pulls ending with another 5-star UP
    for (let i = 0; i < 9; i++) {
      luckyRecords.push({ uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11017, timestamp: t++, rarity: 3, source: "exilium-decrypted" });
    }
    luckyRecords.push({ uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 1069, timestamp: t++, rarity: 5, source: "exilium-decrypted" }); // pity 10

    const normLucky = normalizeRecords(luckyRecords);
    const profile = computeCommanderProfile(normLucky);
    expect(profile.fiveStarCount).toBe(2);
    expect(profile.totalPulls).toBe(20);
    expect(profile.overallAvg).toBe(10);
    expect(profile.dollUpAvg).toBe(10);
    expect(profile.luckIndex).toBeLessThan(5); // should be lucky!
    expect(profile.title).toContain("欧皇");
    expect(profile.tags).toContain("人形100%不歪");
  });

  it("balances the overall title when a lucky doll pool is outweighed by unlucky weapon pulls", () => {
    const mixedRecords: any[] = [];
    let t = 2000;

    const pushRun = (poolType: number, poolId: number, fillerId: number, fiveStarId: number, pity: number) => {
      for (let i = 1; i < pity; i++) {
        mixedRecords.push({ uid: "123456", server: "haoplay", poolType, poolId, itemId: fillerId, timestamp: t++, rarity: 3 });
      }
      mixedRecords.push({ uid: "123456", server: "haoplay", poolType, poolId, itemId: fiveStarId, timestamp: t++, rarity: 5 });
    };

    pushRun(3, 118001, 11017, 1069, 10);
    pushRun(3, 118001, 11017, 1069, 10);
    for (let i = 0; i < 6; i++) {
      pushRun(4, 118002, 11017, 10713, 100);
    }

    const profile = computeCommanderProfile(normalizeRecords(mixedRecords));

    expect(profile.dollStats.title).toBe("至尊欧皇");
    expect(profile.weaponStats.title).toBe("超级非酋");
    expect(profile.luckIndex).toBeGreaterThanOrEqual(5);
    expect(profile.title).not.toContain("欧皇");
  });

  it("keeps a tiny sample with one early five-star at neutral luck", () => {
    const sampleRecords: any[] = [];
    let t = 3000;
    for (let i = 0; i < 7; i++) {
      sampleRecords.push({ uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11017, timestamp: t++, rarity: 3 });
    }
    sampleRecords.push({ uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 1069, timestamp: t++, rarity: 5 });

    const profile = computeCommanderProfile(normalizeRecords(sampleRecords));

    expect(profile.fiveStarCount).toBe(1);
    expect(profile.totalPulls).toBe(8);
    expect(profile.luckIndex).toBe(5);
    expect(profile.title).toBe("欧非守恒");
  });

  it("does not treat standard pool five-stars as rate-up wins", () => {
    const standardRecords: any[] = [];
    let t = 4000;
    for (let i = 1; i < 40; i++) {
      standardRecords.push({ uid: "123456", server: "haoplay", poolType: 1, poolId: 1001, itemId: 11017, timestamp: t++, rarity: 3 });
    }
    standardRecords.push({ uid: "123456", server: "haoplay", poolType: 1, poolId: 1001, itemId: 1001, timestamp: t++, rarity: 5 });
    for (let i = 1; i < 40; i++) {
      standardRecords.push({ uid: "123456", server: "haoplay", poolType: 1, poolId: 1001, itemId: 11018, timestamp: t++, rarity: 3 });
    }
    standardRecords.push({ uid: "123456", server: "haoplay", poolType: 1, poolId: 1001, itemId: 1002, timestamp: t++, rarity: 5 });

    const profile = computeCommanderProfile(normalizeRecords(standardRecords));

    expect(profile.standardStats.fiveStars).toBe(2);
    expect(profile.standardStats.avgPulls).toBe(40);
    expect(profile.standardStats.winRate).toBe(0);
    expect(profile.standardStats.streakUp).toBe(0);
    expect(profile.standardStats.streakNoUp).toBe(0);
    expect(profile.overallWinRate).toBe(0);
  });

  it("uses limited UP average instead of all five-star average for pool titles", () => {
    const mixedLuckRecords: any[] = [];
    let t = 5000;

    const pushRun = (fiveStarId: number, pity: number) => {
      for (let i = 1; i < pity; i++) {
        mixedLuckRecords.push({ uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: 11017, timestamp: t++, rarity: 3 });
      }
      mixedLuckRecords.push({ uid: "123456", server: "haoplay", poolType: 3, poolId: 118001, itemId: fiveStarId, timestamp: t++, rarity: 5 });
    };

    pushRun(1029, 10);
    pushRun(1069, 80);
    pushRun(1069, 80);

    const profile = computeCommanderProfile(normalizeRecords(mixedLuckRecords));

    expect(profile.dollStats.avgPulls).toBeLessThan(66);
    expect(profile.dollUpAvg).toBe(85);
    expect(profile.dollStats.title).toBe("小欧皇");
    expect(profile.title).not.toBe("终极无敌至尊欧皇");
  });

  it("excludes custom pool pulls before first 5-star drop in computeCommanderProfile", () => {
    const testRecords: any[] = [];
    let t = 1000;
    
    // Custom pool type 6:
    // Run 1: 5 pulls, no 5-star. This run should be completely excluded because it has no 5-star.
    for (let i = 0; i < 5; i++) {
      testRecords.push({ uid: "123456", server: "haoplay", poolType: 6, poolId: 200001, itemId: 11017, timestamp: t++, rarity: 3, source: "exilium-decrypted" });
    }
    
    // Large time gap to start Run 2
    t += 11 * 24 * 3600; // 11 days later
    
    // Run 2: 12 pulls ending with a 5-star UP (itemId 1069)
    // The first 5-star drop (at index 11, pity 12) should be excluded.
    // That means pulls 1 to 12 in this run are excluded.
    for (let i = 0; i < 11; i++) {
      testRecords.push({ uid: "123456", server: "haoplay", poolType: 6, poolId: 200001, itemId: 11017, timestamp: t++, rarity: 3, source: "exilium-decrypted" });
    }
    testRecords.push({ uid: "123456", server: "haoplay", poolType: 6, poolId: 200001, itemId: 1069, timestamp: t++, rarity: 5, source: "exilium-decrypted" }); // First 5-star (excluded)
    
    // Pulls after the first 5-star in Run 2 (which should be eligible!)
    // 8 pulls ending with another 5-star UP (eligible!)
    for (let i = 0; i < 7; i++) {
      testRecords.push({ uid: "123456", server: "haoplay", poolType: 6, poolId: 200001, itemId: 11017, timestamp: t++, rarity: 3, source: "exilium-decrypted" });
    }
    testRecords.push({ uid: "123456", server: "haoplay", poolType: 6, poolId: 200001, itemId: 1069, timestamp: t++, rarity: 5, source: "exilium-decrypted" }); // Second 5-star (eligible!)

    const norm = normalizeRecords(testRecords);
    const profile = computeCommanderProfile(norm);
    
    // Eligible pulls should only be the ones after the first 5-star in Run 2:
    // i.e., 8 pulls.
    // Eligible UP count should be 1.
    // So dollUpAvg should be 8.0.
    expect(profile.dollUpAvg).toBe(8);
  });
});
