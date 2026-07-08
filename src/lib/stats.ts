import type { GachaRecord, PoolGroup, RecordFilters, TrackerStats, CommanderProfile, CommanderPoolStats } from "../types";
import { isOffRatePermanent } from "./poolRules";

const POOL_TYPE_LABELS: Record<number, string> = {
  1: "常规采购",
  3: "定向采购",
  4: "军备提升",
  5: "初始采购",
  6: "自选采购·人形",
  7: "自选采购·军备",
  8: "神秘箱",
  9: "神秘箱",
};

const POOL_TYPE_ORDER: number[] = [1, 3, 4, 5, 6, 7, 8, 9];

export function poolTypeLabel(poolType: number): string {
  return POOL_TYPE_LABELS[poolType] ?? `池类型 ${poolType}`;
}

export function poolTypeOrder(poolType: number): number {
  const idx = POOL_TYPE_ORDER.indexOf(poolType);
  return idx >= 0 ? idx : 99;
}

export function pityColor(pity: number, rarity = 5): "green" | "yellow" | "red" {
  if (rarity === 4) {
    if (pity <= 6) return "green";
    if (pity <= 9) return "yellow";
    return "red";
  }
  if (pity <= 32) return "green";
  if (pity <= 64) return "yellow";
  return "red";
}

export function isMysteryBoxPoolType(poolType: number): boolean {
  return poolType === 8 || poolType === 9;
}

export function canonicalPoolType(poolType: number): number {
  return poolType === 9 ? 8 : poolType;
}

export function formatDate(timestamp?: number): string {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp * 1000));
}

export function computeStats(records: GachaRecord[]): TrackerStats {
  const sources = new Map<string, number>();
  const poolTypes = new Map<number, number>();
  let highRarity = 0;
  let currentPity = 0;

  const chronological = [...records].sort((a, b) => a.timestamp - b.timestamp || a.orderInSecond - b.orderInSecond);
  for (const record of chronological) {
    sources.set(record.source, (sources.get(record.source) ?? 0) + 1);
    poolTypes.set(record.poolType, (poolTypes.get(record.poolType) ?? 0) + 1);
    if ((record.rarity ?? 0) >= 5) {
      highRarity += 1;
      currentPity = 0;
    } else {
      currentPity += 1;
    }
  }

  return {
    total: records.length,
    highRarity,
    uniquePools: new Set(records.map((record) => `${record.poolType}:${record.poolId}`)).size,
    latestTimestamp: chronological[chronological.length - 1]?.timestamp,
    currentPity: records.length ? currentPity : undefined,
    sources: Array.from(sources, ([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    poolTypes: Array.from(poolTypes, ([poolType, count]) => ({ poolType, count })).sort((a, b) => a.poolType - b.poolType),
  };
}

export function computeGachaStats(records: GachaRecord[]): TrackerStats {
  return computeStats(records.filter((record) => !isMysteryBoxPoolType(record.poolType)));
}

export function filterRecords(records: GachaRecord[], filters: RecordFilters): GachaRecord[] {
  const query = filters.query.trim().toLowerCase();
  return records.filter((record) => {
    if (filters.poolType && String(record.poolType) !== filters.poolType) return false;
    if (filters.rarity && String(record.rarity ?? "") !== filters.rarity) return false;
    if (filters.source && record.source !== filters.source) return false;
    if (!query) return true;
    return [record.itemName, record.itemId, record.poolId, record.poolType, record.uid, record.server]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
}

export function groupRecordsByPool(records: GachaRecord[]): PoolGroup[] {
  const groups = new Map<string, GachaRecord[]>();
  for (const record of records) {
    const key = `${canonicalPoolType(record.poolType)}:${record.poolId}`;
    const list = groups.get(key) ?? [];
    list.push(record);
    groups.set(key, list);
  }

  const result: PoolGroup[] = [];
  for (const [, list] of groups) {
    const sorted = [...list].sort((a, b) => a.timestamp - b.timestamp || a.orderInSecond - b.orderInSecond);
    const poolType = canonicalPoolType(sorted[0].poolType);
    const poolId = sorted[0].poolId;
    const highRarityItems = sorted.filter((r) => (r.rarity ?? 0) >= 5);
    const nameCounts = new Map<string, number>();
    for (const r of highRarityItems) {
      const name = r.itemName ?? String(r.itemId);
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }
    const upItemNames = [...nameCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name);

    let pity = 0;
    for (const r of sorted) {
      pity = (r.rarity ?? 0) >= 5 ? 1 : pity + 1;
    }

    const typeLabel = poolTypeLabel(poolType);
    const upLabel = upItemNames.length ? upItemNames.join(" / ") : `#${poolId}`;
    const poolLabel = `${typeLabel} · ${upLabel}`;

    result.push({
      poolId,
      poolType,
      poolLabel,
      records: sorted,
      count: sorted.length,
      highRarity: highRarityItems.length,
      fourStar: sorted.filter((r) => (r.rarity ?? 0) === 4).length,
      upItemNames,
      fiveStarRecords: highRarityItems,
      currentPity: pity,
      latestTimestamp: sorted[sorted.length - 1]?.timestamp,
    });
  }

  return result.sort((a, b) => {
    const typeDiff = poolTypeOrder(a.poolType) - poolTypeOrder(b.poolType);
    if (typeDiff !== 0) return typeDiff;
    return (b.latestTimestamp ?? 0) - (a.latestTimestamp ?? 0);
  });
}

export type MergedPoolRecord = {
  record: GachaRecord;
  globalIndex: number;
  pity: number;
};

export type MergedPoolType = {
  poolType: number;
  label: string;
  records: GachaRecord[];
  count: number;
  fiveStarEntries: MergedPoolRecord[];
  fourStarEntries: MergedPoolRecord[];
};

export function mergePoolsByType(records: GachaRecord[]): MergedPoolType[] {
  const byType = new Map<number, GachaRecord[]>();
  for (const record of records) {
    const poolType = canonicalPoolType(record.poolType);
    const list = byType.get(poolType) ?? [];
    list.push(record);
    byType.set(poolType, list);
  }

  const result: MergedPoolType[] = [];
  for (const [poolType, list] of byType) {
    const sorted = [...list].sort((a, b) => a.timestamp - b.timestamp || a.orderInSecond - b.orderInSecond);
    const entries: MergedPoolRecord[] = [];
    let ssrPity = 0;
    let srPity = 0;
    sorted.forEach((record, index) => {
      const rarity = record.rarity ?? 0;
      ssrPity += 1;
      srPity += 1;
      entries.push({ record, globalIndex: index + 1, pity: rarity >= 5 ? ssrPity : srPity });
      if (rarity >= 5) ssrPity = 0;
      if (rarity >= 4) srPity = 0;
    });

    result.push({
      poolType,
      label: poolTypeLabel(poolType),
      records: sorted,
      count: sorted.length,
      fiveStarEntries: entries.filter((e) => (e.record.rarity ?? 0) >= 5),
      fourStarEntries: entries.filter((e) => (e.record.rarity ?? 0) === 4),
    });
  }

  return result.sort((a, b) => poolTypeOrder(a.poolType) - poolTypeOrder(b.poolType));
}

const LUCK_TITLES = [
  "终极无敌至尊欧皇", // 0
  "万里挑一至尊欧皇", // 1
  "千里挑一尊贵欧皇", // 2
  "欧气满满大欧皇",   // 3
  "欧气附体小欧皇",   // 4
  "欧非守恒",         // 5
  "欧气不足小非酋",   // 6
  "千里挑一大非酋",   // 7
  "万里挑一大非酋",   // 8
  "超级至尊非酋",     // 9
  "终极无敌至尊非酋"  // 10
];

const POOL_LUCK_TITLES = [
  "至尊欧皇", // 0
  "尊贵欧皇", // 1
  "大欧皇",   // 2
  "小欧皇",   // 3
  "欧非守恒", // 4
  "小非酋",   // 5
  "大非酋",   // 6
  "超级非酋", // 7
  "至尊非酋"  // 8
];

const DOLL_COMPARE = [
  { upAvg: 66, name: 0 },
  { upAvg: 71, name: 1 },
  { upAvg: 84, name: 2 },
  { upAvg: 91, name: 3 },
  { upAvg: 98, name: 4 },
  { upAvg: 106, name: 5 },
  { upAvg: 115, name: 6 },
  { upAvg: 122, name: 7 },
  { upAvg: 200, name: 8 }
];

const WEAPON_COMPARE = [
  { upAvg: 48, name: 0 },
  { upAvg: 55, name: 1 },
  { upAvg: 60, name: 2 },
  { upAvg: 65, name: 3 },
  { upAvg: 79, name: 4 },
  { upAvg: 87, name: 5 },
  { upAvg: 93, name: 6 },
  { upAvg: 100, name: 7 },
  { upAvg: 200, name: 8 }
];

const STANDARD_COMPARE = [
  { upAvg: 39, name: 0 },
  { upAvg: 50, name: 1 },
  { upAvg: 58, name: 2 },
  { upAvg: 68, name: 3 },
  { upAvg: 74, name: 4 },
  { upAvg: 78, name: 5 },
  { upAvg: 81, name: 6 },
  { upAvg: 84, name: 7 },
  { upAvg: 200, name: 8 }
];

function getCompareIndex(avg: number, compare: Array<{ upAvg: number; name: number }>): number {
  if (avg <= 0) return 4; // default to neutral
  for (const item of compare) {
    if (avg <= item.upAvg) return item.name;
  }
  return 8;
}

function clampLuckIndex(index: number): number {
  if (index < 0) return 0;
  if (index > 10) return 10;
  return index;
}

function adjustOverallLuckIndex(params: {
  dollIndex: number;
  weaponIndex: number;
  standardIndex: number;
  dollStats: CommanderPoolStats;
  weaponStats: CommanderPoolStats;
  standardStats: CommanderPoolStats;
  totalPulls: number;
  fiveStarCount: number;
  overallAvg: number;
}): number {
  const { dollIndex, weaponIndex, standardIndex, dollStats, weaponStats, standardStats, totalPulls, fiveStarCount, overallAvg } = params;

  if (fiveStarCount === 0) return 5;
  if (totalPulls < 50 && fiveStarCount === 1) return 5;

  let score = dollStats.fiveStars > 0
    ? dollIndex
    : weaponStats.fiveStars > 0
      ? weaponIndex
      : standardStats.fiveStars > 0
        ? standardIndex
        : 5;

  const applyPoolInfluence = (index: number, fiveStars: number, strength: number) => {
    if (fiveStars <= 0 || fiveStarCount <= 0) return;
    const share = fiveStars / fiveStarCount;
    if (index < 4) {
      score -= Math.floor((4 - index) * share * strength);
    } else if (index > 4) {
      score += Math.ceil((index - 4) * share * strength);
    }
  };

  applyPoolInfluence(weaponIndex, weaponStats.fiveStars, 2);
  applyPoolInfluence(standardIndex, standardStats.fiveStars, 1.2);

  if (dollStats.fiveStars >= 2) {
    if (dollStats.winRate >= 100 && score > 0) score -= 1;
    if (dollStats.winRate < 50) score += 1;
  }

  if (weaponStats.fiveStars >= 2) {
    if (weaponStats.winRate >= 100 && weaponIndex <= 4 && score > 0) score -= 1;
    if (weaponStats.winRate < 50) score += 1;
  }

  if (overallAvg > 0) {
    if (overallAvg <= 25) score -= 1;
    else if (overallAvg >= 75) score += 2;
    else if (overallAvg >= 65) score += 1;
  }

  if (fiveStarCount < 3 && totalPulls < 100) {
    score = Math.min(Math.max(score, 3), 6);
  }

  return clampLuckIndex(score);
}

export function computeCommanderProfile(records: GachaRecord[]): CommanderProfile {
  const chronological = [...records].sort((a, b) => a.timestamp - b.timestamp || a.orderInSecond - b.orderInSecond);

  // Group pulls and calculate pity for each 5-star
  const poolPullsCount: Record<number, number> = {};
  const poolFiveStars: Record<number, Array<{ record: GachaRecord; pity: number; isUp: boolean }>> = {};
  const poolCurrentPity: Record<number, number> = {};

  for (const r of chronological) {
    const poolType = r.poolType;
    poolPullsCount[poolType] = (poolPullsCount[poolType] ?? 0) + 1;
    poolCurrentPity[poolType] = (poolCurrentPity[poolType] ?? 0) + 1;

    if ((r.rarity ?? 0) >= 5) {
      const isUp = !isOffRatePermanent({ poolType: r.poolType, itemId: r.itemId, rarity: r.rarity });
      const fsList = poolFiveStars[poolType] ?? [];
      fsList.push({ record: r, pity: poolCurrentPity[poolType], isUp });
      poolFiveStars[poolType] = fsList;
      poolCurrentPity[poolType] = 0;
    }
  }

  // Calculate statistics for each pool category
  const getStatsForPools = (poolTypes: number[], hasRateUp = true): CommanderPoolStats => {
    let pulls = 0;
    let fiveStarsCount = 0;
    let upCount = 0;
    let offRateCount = 0;
    let totalPity = 0;
    const allFiveStars: Array<{ record: GachaRecord; pity: number; isUp: boolean }> = [];

    for (const pt of poolTypes) {
      pulls += poolPullsCount[pt] ?? 0;
      const fsList = poolFiveStars[pt] ?? [];
      fiveStarsCount += fsList.length;
      allFiveStars.push(...fsList);
    }

    // Sort five-stars chronologically to compute streaks
    allFiveStars.sort((a, b) => a.record.timestamp - b.record.timestamp || a.record.orderInSecond - b.record.orderInSecond);

    let streakUp = 0;
    let streakNoUp = 0;
    let currentStreakUp = 0;
    let currentStreakNoUp = 0;
    let guaranteed = false;
    let wins5050 = 0;
    let losses5050 = 0;

    for (const fs of allFiveStars) {
      totalPity += fs.pity;
      if (!hasRateUp) continue;

      if (fs.isUp) {
        currentStreakUp += 1;
        currentStreakNoUp = 0;
        if (currentStreakUp > streakUp) streakUp = currentStreakUp;

        if (guaranteed) {
          guaranteed = false;
        } else {
          wins5050 += 1;
          upCount += 1;
        }
      } else {
        currentStreakNoUp += 1;
        currentStreakUp = 0;
        if (currentStreakNoUp > streakNoUp) streakNoUp = currentStreakNoUp;

        losses5050 += 1;
        offRateCount += 1;
        guaranteed = true;
      }
    }

    const total5050 = wins5050 + losses5050;
    const winRate = total5050 > 0 ? Math.floor((wins5050 / total5050) * 1000) / 10 : 0;
    const avgPulls = fiveStarsCount > 0 ? Math.floor((totalPity / fiveStarsCount) * 10) / 10 : 0;

    return {
      pulls,
      fiveStars: fiveStarsCount,
      winRate,
      avgPulls,
      streakUp,
      streakNoUp,
      title: "",
    };
  };

  // Calculate average pulls per UP Doll / Weapon
  const computeEligibleUpAvg = (
    poolTypeLimited: number,
    poolTypeCustom: number
  ): number | undefined => {
    const limitedPulls = chronological.filter(r => r.poolType === poolTypeLimited);
    const customPulls = chronological.filter(r => r.poolType === poolTypeCustom);

    const sortedCustom = [...customPulls].sort((a, b) => a.timestamp - b.timestamp || a.orderInSecond - b.orderInSecond);
    const sortedLimited = [...limitedPulls].sort((a, b) => a.timestamp - b.timestamp || a.orderInSecond - b.orderInSecond);

    const getActiveLimitedPoolId = (timestamp: number): number | undefined => {
      if (sortedLimited.length === 0) return undefined;
      let activePoolId = sortedLimited[0].poolId;
      for (const p of sortedLimited) {
        if (p.timestamp <= timestamp) {
          activePoolId = p.poolId;
        } else {
          break;
        }
      }
      return activePoolId;
    };

    const customRuns: GachaRecord[][] = [];
    let currentRun: GachaRecord[] = [];

    for (const r of sortedCustom) {
      if (currentRun.length === 0) {
        currentRun.push(r);
      } else {
        const last = currentRun[currentRun.length - 1];
        let shouldSplit = false;
        
        if (r.timestamp - last.timestamp > 10 * 24 * 3600) {
          shouldSplit = true;
        } else {
          const activeAtLast = getActiveLimitedPoolId(last.timestamp);
          const activeAtCurrent = getActiveLimitedPoolId(r.timestamp);
          if (activeAtLast !== undefined && activeAtCurrent !== undefined && activeAtLast !== activeAtCurrent) {
            const hasLimitedPullInBetween = sortedLimited.some(
              (p) => p.timestamp > last.timestamp && p.timestamp <= r.timestamp
            );
            if (hasLimitedPullInBetween) {
              shouldSplit = true;
            }
          }
        }

        if (shouldSplit) {
          customRuns.push(currentRun);
          currentRun = [r];
        } else {
          currentRun.push(r);
        }
      }
    }
    if (currentRun.length > 0) {
      customRuns.push(currentRun);
    }

    let eligibleCustomPullsCount = 0;
    let eligibleCustomUpCount = 0;

    for (const run of customRuns) {
      const firstFiveStarIdx = run.findIndex(r => (r.rarity ?? 0) >= 5);
      if (firstFiveStarIdx !== -1) {
        const eligiblePulls = run.slice(firstFiveStarIdx + 1);
        eligibleCustomPullsCount += eligiblePulls.length;
        
        for (const r of eligiblePulls) {
          if ((r.rarity ?? 0) >= 5) {
            const isUp = !isOffRatePermanent({ poolType: r.poolType, itemId: r.itemId, rarity: r.rarity });
            if (isUp) {
              eligibleCustomUpCount += 1;
            }
          }
        }
      }
    }

    const limitedPullsCount = limitedPulls.length;
    let limitedUpCount = 0;
    for (const r of limitedPulls) {
      if ((r.rarity ?? 0) >= 5) {
        const isUp = !isOffRatePermanent({ poolType: r.poolType, itemId: r.itemId, rarity: r.rarity });
        if (isUp) {
          limitedUpCount += 1;
        }
      }
    }

    const totalEligiblePulls = limitedPullsCount + eligibleCustomPullsCount;
    const totalEligibleUp = limitedUpCount + eligibleCustomUpCount;

    return totalEligibleUp > 0 ? Math.floor((totalEligiblePulls / totalEligibleUp) * 10) / 10 : undefined;
  };

  const dollUpAvg = computeEligibleUpAvg(3, 6);
  const weaponUpAvg = computeEligibleUpAvg(4, 7);

  const dollStats = getStatsForPools([3, 6]);
  const weaponStats = getStatsForPools([4, 7]);
  const standardStats = getStatsForPools([1], false);

  // Determine compare indices. Limited pools use UP average when available;
  // otherwise fallback to all 5-star average for incomplete data.
  const dollIndex = getCompareIndex(dollUpAvg ?? dollStats.avgPulls, DOLL_COMPARE);
  const weaponIndex = getCompareIndex(weaponUpAvg ?? weaponStats.avgPulls, WEAPON_COMPARE);
  const standardIndex = getCompareIndex(standardStats.avgPulls, STANDARD_COMPARE);

  dollStats.title = POOL_LUCK_TITLES[dollIndex];
  weaponStats.title = POOL_LUCK_TITLES[weaponIndex];
  standardStats.title = POOL_LUCK_TITLES[standardIndex];

  const fiveStarCount = dollStats.fiveStars + weaponStats.fiveStars + standardStats.fiveStars;
  const totalPulls = dollStats.pulls + weaponStats.pulls + standardStats.pulls;
  const totalPullsForAvg = (dollStats.fiveStars > 0 ? dollStats.avgPulls * dollStats.fiveStars : 0) +
                           (weaponStats.fiveStars > 0 ? weaponStats.avgPulls * weaponStats.fiveStars : 0) +
                           (standardStats.fiveStars > 0 ? standardStats.avgPulls * standardStats.fiveStars : 0);
  const overallAvg = fiveStarCount > 0 ? Math.floor((totalPullsForAvg / fiveStarCount) * 10) / 10 : 0;

  const score = adjustOverallLuckIndex({
    dollIndex,
    weaponIndex,
    standardIndex,
    dollStats,
    weaponStats,
    standardStats,
    totalPulls,
    fiveStarCount,
    overallAvg,
  });

  // Calculate overall win rate (50/50 win rate across all UP pools)
  const upFiveStars = (poolFiveStars[3] ?? []).concat(poolFiveStars[6] ?? [], poolFiveStars[4] ?? [], poolFiveStars[7] ?? []);
  upFiveStars.sort((a, b) => a.record.timestamp - b.record.timestamp || a.record.orderInSecond - b.record.orderInSecond);
  let totalWins = 0;
  let totalLosses = 0;
  let guaranteedState = false;
  for (const fs of upFiveStars) {
    if (fs.isUp) {
      if (guaranteedState) {
        guaranteedState = false;
      } else {
        totalWins += 1;
      }
    } else {
      totalLosses += 1;
      guaranteedState = true;
    }
  }
  const total5050Checks = totalWins + totalLosses;
  const overallWinRate = total5050Checks > 0 ? Math.floor((totalWins / total5050Checks) * 1000) / 10 : 0;

  // Calculate maximum 5-stars in a single timestamp (ten-pull multi hits)
  const pullsByTime: Record<number, number> = {};
  for (const fs of upFiveStars.concat(poolFiveStars[1] ?? [], poolFiveStars[5] ?? [])) {
    pullsByTime[fs.record.timestamp] = (pullsByTime[fs.record.timestamp] ?? 0) + 1;
  }
  const maxMultiPull = Math.max(0, ...Object.values(pullsByTime));

  // Generate tags
  const tags: string[] = [];
  
  if (dollStats.streakUp > 2) {
    tags.push(`限定人形${dollStats.streakUp}连不歪`);
  } else if (dollStats.streakNoUp > 2) {
    tags.push(`限定人形${dollStats.streakNoUp}连歪`);
  }

  if (weaponStats.streakUp > 3) {
    tags.push(`限定军备${weaponStats.streakUp}连不歪`);
  } else if (weaponStats.streakNoUp > 2) {
    tags.push(`限定军备${weaponStats.streakNoUp}连歪`);
  }

  if (maxMultiPull >= 2) {
    tags.push(`十连${maxMultiPull}金`);
  }

  if (dollStats.fiveStars >= 2) {
    if (dollStats.winRate >= 100) tags.push("人形100%不歪");
    else if (dollStats.winRate >= 66) tags.push("人形池极少歪");
  }

  if (weaponStats.fiveStars >= 2) {
    if (weaponStats.winRate >= 100) tags.push("军备100%不歪");
    else if (weaponStats.winRate >= 80) tags.push("军备池极少歪");
  }

  if (fiveStarCount >= 3) {
    if (score <= 1) {
      tags.push("天选之子", "运势爆表");
    } else if (score <= 3) {
      tags.push("欧皇附体");
    } else if (score >= 8) {
      tags.push("非酋附体", "常吃保底");
    } else if (score >= 6) {
      tags.push("运势不佳");
    }
  }

  // Filter unique and limit to 4 tags
  const uniqueTags = [...new Set(tags)].slice(0, 4);
  if (uniqueTags.length === 0) {
    if (totalPulls < 100) {
      uniqueTags.push("新晋指挥官");
    } else {
      uniqueTags.push("资深指挥官");
    }
  }

  let finalTitle = LUCK_TITLES[score];
  if (fiveStarCount === 0) {
    finalTitle = "筹备中指挥官";
  } else if (totalPulls < 50 && fiveStarCount === 1) {
    finalTitle = "欧非守恒";
  }

  return {
    title: finalTitle,
    luckIndex: score,
    tags: uniqueTags,
    totalPulls,
    fiveStarCount,
    overallAvg,
    overallWinRate,
    dollStats,
    weaponStats,
    standardStats,
    dollUpAvg,
    weaponUpAvg,
  };
}
