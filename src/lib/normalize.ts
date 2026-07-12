import type { GachaRecord, GachaRecordDraft, MergeResult } from "../types";

const DEFAULT_UID = "unknown";
const DEFAULT_SERVER = "unknown";
const IGNORED_POOL_TYPES = new Set([8, 9]);

function numeric(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function baseSort(a: GachaRecordDraft, b: GachaRecordDraft): number {
  return (
    numeric(a.timestamp) - numeric(b.timestamp) ||
    numeric(a.poolType) - numeric(b.poolType) ||
    numeric(a.poolId) - numeric(b.poolId) ||
    numeric(a.sourceOrder) - numeric(b.sourceOrder) ||
    numeric(a.itemId) - numeric(b.itemId)
  );
}

function isImportablePoolType(poolType: unknown): boolean {
  const value = numeric(poolType);
  return !IGNORED_POOL_TYPES.has(value);
}

export function makeRecordId(record: Pick<GachaRecord, "uid" | "server" | "poolType" | "poolId" | "timestamp" | "orderInSecond" | "itemId" | "sameItemIndex">): string {
  return [
    record.uid,
    record.server,
    record.poolType,
    record.poolId,
    record.timestamp,
    record.orderInSecond,
    record.itemId,
    record.sameItemIndex,
  ].join(":");
}

export function makeDedupeKey(record: Pick<GachaRecord, "uid" | "server" | "poolType" | "poolId" | "timestamp" | "itemId" | "sameItemIndex">): string {
  return [
    record.uid,
    record.server,
    record.poolType,
    record.poolId,
    record.timestamp,
    record.itemId,
    record.sameItemIndex,
  ].join(":");
}

export function normalizeRecords(drafts: GachaRecordDraft[], importedAt = new Date().toISOString()): GachaRecord[] {
  const ordered = drafts
    .filter((record) => Number.isFinite(Number(record.timestamp)) && Number.isFinite(Number(record.itemId)) && isImportablePoolType(record.poolType))
    .map((record, index) => ({ ...record, sourceOrder: record.sourceOrder ?? index }))
    .sort(baseSort);

  const secondCounters = new Map<string, number>();
  const sameItemCounters = new Map<string, number>();

  return ordered.map((record) => {
    const uid = String(record.uid ?? DEFAULT_UID);
    const server = String(record.server ?? DEFAULT_SERVER);
    const poolType = numeric(record.poolType);
    const poolId = numeric(record.poolId);
    const itemId = numeric(record.itemId);
    const timestamp = numeric(record.timestamp);
    const secondKey = [uid, server, poolType, poolId, timestamp].join(":");
    const sameItemKey = [secondKey, itemId].join(":");
    const orderInSecond = secondCounters.get(secondKey) ?? 0;
    const sameItemIndex = sameItemCounters.get(sameItemKey) ?? 0;

    secondCounters.set(secondKey, orderInSecond + 1);
    sameItemCounters.set(sameItemKey, sameItemIndex + 1);

    const normalized: GachaRecord = {
      id: "",
      uid,
      server,
      poolType,
      poolId,
      itemId,
      timestamp,
      orderInSecond,
      sameItemIndex,
      source: record.source ?? "manual",
      importedAt,
    };

    if (record.rarity !== undefined) normalized.rarity = numeric(record.rarity);
    if (record.pullNumber !== undefined) normalized.pullNumber = numeric(record.pullNumber);
    if (record.itemName) normalized.itemName = String(record.itemName);
    normalized.id = makeRecordId(normalized);
    return normalized;
  });
}

export function mergeRecords(existing: GachaRecord[], incomingDrafts: GachaRecordDraft[], importedAt = new Date().toISOString()): MergeResult {
  const seen = new Map<string, GachaRecord>();
  let duplicates = 0;
  const importableExisting = existing.filter((record) => isImportablePoolType(record.poolType));

  for (const record of importableExisting) {
    seen.set(makeDedupeKey(record), record);
  }

  const incoming = normalizeRecords(incomingDrafts, importedAt);
  for (const record of incoming) {
    const key = makeDedupeKey(record);
    const previous = seen.get(key);
    if (previous) {
      duplicates += 1;
      if (!previous.rarity && record.rarity) previous.rarity = record.rarity;
      if (!previous.pullNumber && record.pullNumber) previous.pullNumber = record.pullNumber;
      if (!previous.itemName && record.itemName) previous.itemName = record.itemName;
    } else {
      seen.set(key, record);
    }
  }

  const records = Array.from(seen.values()).sort((a, b) => b.timestamp - a.timestamp || b.orderInSecond - a.orderInSecond);
  return {
    records,
    added: Math.max(0, records.length - importableExisting.length),
    duplicates,
  };
}

export function exportPortable(records: GachaRecord[]) {
  return {
    format: "gf2-local-tracker",
    version: 1,
    exportedAt: new Date().toISOString(),
    records: records.filter((record) => isImportablePoolType(record.poolType)),
  };
}
