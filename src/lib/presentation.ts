import type { MergedPoolRecord } from "./stats";

export type HighRarityFilter = {
  rarity: "" | "4" | "5";
  query: string;
};

export type PageResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  start: number;
  end: number;
};

export function paginate<T>(items: T[], page: number, pageSize: number): PageResult<T> {
  const safePageSize = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const startIndex = (safePage - 1) * safePageSize;
  const pageItems = items.slice(startIndex, startIndex + safePageSize);
  return {
    items: pageItems,
    page: safePage,
    pageSize: safePageSize,
    total: items.length,
    pageCount,
    start: items.length ? startIndex + 1 : 0,
    end: startIndex + pageItems.length,
  };
}

export function filterHighRarityEntries(entries: MergedPoolRecord[], filter: HighRarityFilter): MergedPoolRecord[] {
  const query = filter.query.trim().toLowerCase();
  return entries
    .filter((entry) => {
      const rarity = entry.record.rarity ?? 0;
      if (filter.rarity && String(rarity) !== filter.rarity) return false;
      if (!query) return true;
      return [
        entry.record.itemName,
        entry.record.itemId,
        entry.record.poolId,
        entry.globalIndex,
        entry.pity,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    })
    .sort((a, b) => b.globalIndex - a.globalIndex);
}
