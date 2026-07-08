type OffRateInput = {
  poolType: number;
  itemId: number;
  rarity?: number;
};

const PERMANENT_DOLL_IDS = new Set([
  1015, // 维普蕾
  1021, // 佩里缇亚
  1025, // 托洛洛
  1027, // 琼玖
  1029, // 塞布丽娜
  1033, // 莫辛纳甘
  1043, // 绯
  1049, // 哈卜茜
]);

const PERMANENT_WEAPON_IDS = new Set([
  11016, // 猎心者
  11020, // 光学幻境
  11038, // 游星
  11044, // 金石奏
  11047, // 梅扎露娜
  10333, // 斯摩希克
  10433, // 赫斯提亚
  10493, // 二律背反
]);

export function isOffRatePermanent(record: OffRateInput): boolean {
  if ((record.rarity ?? 0) < 5) return false;
  if (record.poolType === 3 || record.poolType === 6) return PERMANENT_DOLL_IDS.has(record.itemId);
  if (record.poolType === 4 || record.poolType === 7) return PERMANENT_WEAPON_IDS.has(record.itemId);
  return false;
}

export function describeOffRate(record: OffRateInput): string | undefined {
  return isOffRatePermanent(record) ? "歪" : undefined;
}
