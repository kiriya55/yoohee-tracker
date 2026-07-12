import type { GachaRecord, ResourceIndex, ResourceItem } from "../types";
import { buildMccImageUrl } from "./resourceUpdater";
import i18nData from "../i18n.json";

const STORAGE_KEY = "gf2-resource-index";
const KNOWN_RESOURCE_ITEMS: Record<string, ResourceItem> = {
  "1071": {
    id: 1071,
    name: "贝丝蒂",
    cn: "贝丝蒂",
    type: "doll",
    rarity: 5,
    code: "BastiSSR",
    server: "haoplay",
    imageSource: "mcc-wiki",
    localIcon: "/images/doll/Avatar_Head_BastiSSR.png",
    en: "Basti",
  },
  "10711": {
    id: 10711,
    name: "旧式马克23进攻型手枪",
    cn: "旧式马克23进攻型手枪",
    type: "weapon",
    rarity: 3,
    code: "Weapon_MK23_3",
    server: "haoplay",
    imageSource: "mcc-wiki",
    localIcon: "/images/weapon/Weapon_MK23_3_1024.png",
    en: "Retired MK23",
  },
  "10712": {
    id: 10712,
    name: "马克23进攻型手枪",
    cn: "马克23进攻型手枪",
    type: "weapon",
    rarity: 4,
    code: "Weapon_MK23_4",
    server: "haoplay",
    imageSource: "mcc-wiki",
    localIcon: "/images/weapon/Weapon_MK23_4_1024.png",
    en: "MK23",
  },
  "10713": {
    id: 10713,
    name: "告死礼赞",
    cn: "告死礼赞",
    type: "weapon",
    rarity: 5,
    code: "Weapon_MK23_5",
    server: "haoplay",
    imageSource: "mcc-wiki",
    localIcon: "/images/weapon/Weapon_MK23_5_1024.png",
    en: "MK23",
  },
};

const I18N_NAMES = i18nData.names as Record<string, { cn?: string; en?: string; jp?: string; code?: string; type?: string; }>;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseResourceIndexText(text: string): ResourceIndex | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (!isObject(parsed) || parsed.format !== "gf2-resource-index" || !isObject(parsed.items)) {
    return undefined;
  }

  const items: Record<string, ResourceItem> = {};
  for (const [key, value] of Object.entries(parsed.items)) {
    if (!isObject(value)) continue;
    const id = Number(value.id ?? key);
    if (!Number.isFinite(id)) continue;
    items[String(id)] = {
      id,
      name: typeof value.name === "string" ? value.name : undefined,
      type: typeof value.type === "string" ? value.type : undefined,
      rarity: Number.isFinite(Number(value.rarity)) ? Number(value.rarity) : undefined,
      code: typeof value.code === "string" ? value.code : undefined,
      icon: typeof value.icon === "string" ? value.icon : undefined,
      iconUrl: typeof value.iconUrl === "string" ? value.iconUrl : undefined,
      localIcon: typeof value.localIcon === "string" ? value.localIcon : undefined,
      server: typeof value.server === "string" ? value.server : undefined,
      imageSource: typeof value.imageSource === "string" ? value.imageSource : undefined,
      verifiedAt: typeof value.verifiedAt === "string" ? value.verifiedAt : undefined,
      aliases: Array.isArray(value.aliases) ? value.aliases.filter((alias): alias is string => typeof alias === "string") : undefined,
      cn: typeof value.cn === "string" ? value.cn : undefined,
      en: typeof value.en === "string" ? value.en : undefined,
      jp: typeof value.jp === "string" ? value.jp : undefined,
    };
  }

  return {
    format: "gf2-resource-index",
    version: Number(parsed.version ?? 1),
    source: typeof parsed.source === "string" ? parsed.source : undefined,
    generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : undefined,
    items,
    pools: isObject(parsed.pools) ? (parsed.pools as ResourceIndex["pools"]) : undefined,
  };
}

export function loadResourceIndex(): ResourceIndex | undefined {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? parseResourceIndexText(raw) : undefined;
}

export function saveResourceIndex(index: ResourceIndex): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(index));
}

export function clearResourceIndex(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function inferRarity(record: GachaRecord, item?: ResourceItem): number | undefined {
  const known = KNOWN_RESOURCE_ITEMS[String(record.itemId)];
  if (item?.rarity) return item.rarity;
  if (known?.rarity) return known.rarity;

  if (record.itemId >= 10000 && record.itemId < 20000) {
    const rankDigit = record.itemId % 10;
    if (rankDigit >= 1 && rankDigit <= 3) return rankDigit + 2;
  }

  if (record.poolType === 3 && record.itemId >= 1000 && record.itemId < 2000) {
    return 5;
  }

  return undefined;
}

function displayNameFor(itemId: number, item?: ResourceItem): string | undefined {
  const id = String(itemId);
  const known = KNOWN_RESOURCE_ITEMS[id];
  const i18n = I18N_NAMES[id];
  if (item?.cn) return item.cn;
  if (known?.cn) return known.cn;
  if (item?.name && !/^\d+$/.test(item.name)) return item.name;
  if (i18n?.cn) return i18n.cn;
  return item?.name;
}

export function enrichRecords(records: GachaRecord[], index?: ResourceIndex): GachaRecord[] {
  return records.map((record) => {
    const item = index?.items[String(record.itemId)] ?? KNOWN_RESOURCE_ITEMS[String(record.itemId)];
    return {
      ...record,
      itemName: displayNameFor(record.itemId, item) ?? record.itemName,
      rarity: record.rarity ?? inferRarity(record, item),
    };
  });
}

export function getResourceItem(index: ResourceIndex | undefined, itemId: number): ResourceItem | undefined {
  const id = String(itemId);
  const indexedItem = index?.items[id];
  const knownItem = KNOWN_RESOURCE_ITEMS[id];
  if (!knownItem) return indexedItem;
  if (!indexedItem) return knownItem;

  const definedIndexFields = Object.fromEntries(
    Object.entries(indexedItem).filter(([, value]) => value !== undefined),
  );
  return { ...knownItem, ...definedIndexFields } as ResourceItem;
}

export function getResourceImageUrl(index: ResourceIndex | undefined, itemId: number): string | undefined {
  const item = getResourceItem(index, itemId);
  if (!item) return undefined;
  if (item.localIcon) return item.localIcon;
  if (item.iconUrl) return item.iconUrl;
  const codeUrl = buildMccImageUrl(item);
  if (codeUrl) return codeUrl;
  if (!item.icon) return undefined;

  if (/^https?:\/\//i.test(item.icon) || item.icon.startsWith("/") || item.icon.startsWith("data:")) {
    return item.icon;
  }

  const normalizedIcon = item.type === "doll" ? item.icon.replace(/UP\.png$/i, ".png") : item.icon;
  const folder = item.type === "weapon" ? "weapon" : item.type === "doll" ? "doll" : "item";
  return `https://gf2.mcc.wiki/image/${folder}/${encodeURIComponent(normalizedIcon)}`;
}

export function getDisplayName(index: ResourceIndex | undefined, itemId: number, locale?: "cn" | "en" | "jp"): string | undefined {
  const item = getResourceItem(index, itemId);
  const i18n = I18N_NAMES[String(itemId)];
  
  const getValidName = (name: string | undefined) => {
    if (!name) return undefined;
    if (/^\d+$/.test(name)) return undefined;
    return name;
  };

  const cnName = item?.cn ?? i18n?.cn ?? getValidName(item?.name);
  const code = item?.code ?? i18n?.code;
  const type = item?.type ?? i18n?.type;

  if (locale === "en") {
    const name = item?.en ?? i18n?.en;
    if (name) return name;
    
    if (type === "doll" && code) {
      const cleanCode = code.replace(/(?:SSR|SR)$/i, "");
      if (cleanCode === "MosinNagant") return "Mosin-Nagant";
      return cleanCode;
    }
    if (code) {
      return code.replace(/(?:SSR|SR)$/i, "");
    }
    return cnName;
  }

  if (locale === "jp") {
    const name = item?.jp ?? i18n?.jp;
    if (name) return name;

    if (type === "doll" && code) {
      const cleanCode = code.replace(/(?:SSR|SR)$/i, "");
      return cleanCode;
    }
    if (code) {
      const cleanCode = code.replace(/(?:SSR|SR)$/i, "");
      return cleanCode;
    }
    return cnName;
  }

  return cnName;
}

export async function loadDefaultResourceIndex(): Promise<ResourceIndex | undefined> {
  try {
    const response = await fetch("/images/resource-index.json");
    if (!response.ok) return undefined;
    const text = await response.text();
    return parseResourceIndexText(text);
  } catch {
    return undefined;
  }
}
