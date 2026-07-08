export type SourceKind =
  | "merged-normalized"
  | "exilium-decrypted"
  | "elmobeacon-capture"
  | "elmobeacon-db"
  | "portable-export"
  | "gfl2-help"
  | "uid-headers-fetch"
  | "manual";

export type GachaRecordDraft = {
  uid?: string;
  server?: string;
  poolType: number;
  poolId: number;
  itemId: number;
  timestamp: number;
  rarity?: number;
  pullNumber?: number;
  itemName?: string;
  source?: SourceKind | string;
  sourceOrder?: number;
};

export type GachaRecord = Required<
  Pick<GachaRecordDraft, "uid" | "server" | "poolType" | "poolId" | "itemId" | "timestamp">
> & {
  id: string;
  orderInSecond: number;
  sameItemIndex: number;
  rarity?: number;
  pullNumber?: number;
  itemName?: string;
  source: SourceKind | string;
  importedAt: string;
};

export type ImportResult = {
  ok: boolean;
  fileName?: string;
  format?: string;
  records: GachaRecordDraft[];
  errors: string[];
};

export type MergeResult = {
  records: GachaRecord[];
  added: number;
  duplicates: number;
};

export type TrackerStats = {
  total: number;
  highRarity: number;
  uniquePools: number;
  latestTimestamp?: number;
  currentPity?: number;
  sources: Array<{ source: string; count: number }>;
  poolTypes: Array<{ poolType: number; count: number }>;
};

export type PoolGroup = {
  poolId: number;
  poolType: number;
  poolLabel: string;
  records: GachaRecord[];
  count: number;
  highRarity: number;
  fourStar: number;
  upItemNames: string[];
  fiveStarRecords: GachaRecord[];
  currentPity: number;
  latestTimestamp?: number;
};

export type RecordFilters = {
  poolType: string;
  rarity: string;
  source: string;
  query: string;
};

export type ResourceItem = {
  id: number;
  name?: string;
  type?: "doll" | "weapon" | "item" | string;
  rarity?: number;
  code?: string;
  icon?: string;
  iconUrl?: string;
  localIcon?: string;
  server?: string;
  imageSource?: "mcc-wiki" | "local" | "manual" | string;
  verifiedAt?: string;
  aliases?: string[];
  cn?: string;
  en?: string;
  jp?: string;
};

export type ResourcePool = {
  id: number;
  name?: string;
  type?: number;
  upItems?: number[];
};

export type ResourceIndex = {
  format: "gf2-resource-index";
  version: number;
  source?: string;
  generatedAt?: string;
  items: Record<string, ResourceItem>;
  pools?: Record<string, ResourcePool>;
};

export type CommanderPoolStats = {
  pulls: number;
  fiveStars: number;
  winRate: number;
  avgPulls: number;
  streakUp: number;
  streakNoUp: number;
  title: string;
};

export type CommanderProfile = {
  title: string;
  luckIndex: number;
  tags: string[];
  totalPulls: number;
  fiveStarCount: number;
  overallAvg: number;
  overallWinRate: number;
  dollStats: CommanderPoolStats;
  weaponStats: CommanderPoolStats;
  standardStats: CommanderPoolStats;
  dollUpAvg?: number;
  weaponUpAvg?: number;
};
