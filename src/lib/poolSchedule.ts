import type { MergedPoolType } from "./stats";
import type { PoolTimeset, ResourceIndex } from "../types";

type PoolTitleLocale = "zh" | "en" | "jp";
type Translate = (key: string) => string;

function poolTypeKey(poolType: number): string {
  if (poolType === 3 || poolType === 6) return "poolTypeDoll";
  if (poolType === 4 || poolType === 7) return "poolTypeWeapon";
  return "poolTypeOther";
}

export function getPoolDetailTitle(poolType: number, _locale: PoolTitleLocale, translate: Translate) {
  const doll = poolType === 3 || poolType === 6;
  const weapon = poolType === 4 || poolType === 7;
  return {
    eyebrow: translate(doll ? "poolPickupDoll" : weapon ? "poolPickupWeapon" : "poolPickupOther"),
    title: translate(poolTypeKey(poolType)),
  };
}

export function formatPoolSchedule(timeset: PoolTimeset, locale: PoolTitleLocale): string | undefined {
  if (!timeset.startTime || !timeset.endTime) return undefined;
  const localeName = locale === "zh" ? "zh-CN" : locale === "jp" ? "ja-JP" : "en-US";
  const formatter = new Intl.DateTimeFormat(localeName, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const withRange = formatter as Intl.DateTimeFormat & {
    formatRange?: (start: Date, end: Date) => string;
  };
  return withRange.formatRange
    ? withRange.formatRange(new Date(timeset.startTime), new Date(timeset.endTime))
    : formatter.format(new Date(timeset.startTime)) + " – " + formatter.format(new Date(timeset.endTime));
}

export function resolvePoolSchedule(index: ResourceIndex | undefined, selected: MergedPoolType | undefined): PoolTimeset | undefined {
  if (!index?.timesets || !selected) return undefined;
  const itemIds = new Set(selected.records.map((record) => record.itemId));
  const matches = index.timesets.filter((timeset) => {
    if (Number(timeset.poolType) !== Number(selected.poolType)) return false;
    const upIds = new Set(timeset.upItemIds ?? []);
    return upIds.size === 0 || [...itemIds].some((id) => upIds.has(id));
  });
  return matches.length === 1 ? matches[0] : undefined;
}
