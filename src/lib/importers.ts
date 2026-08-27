import type { GachaRecordDraft, ImportResult, SourceKind } from "../types";

type AnyObject = Record<string, unknown>;

function isObject(value: unknown): value is AnyObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toFiniteNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeServer(server: unknown): string | undefined {
  if (typeof server !== "string") return undefined;
  if (server === "hao-asia" || server === "hao-jp" || server === "hao-kr" || server === "hao-intl") return "haoplay";
  if (server === "dw-cn") return "cn";
  if (server === "dw-us") return "darkwinter";
  return server === "tw" ? "haoplay" : server;
}

type DraftDefaults = {
  uid?: string;
  server?: string;
  poolType?: number;
};

function draftFromLoose(record: AnyObject, source: SourceKind, sourceOrder: number, defaults: DraftDefaults = {}): GachaRecordDraft | undefined {
  const poolType = toFiniteNumber(record.poolType ?? record.pool_type ?? record.type_id ?? record.typeId ?? defaults.poolType);
  const poolId = toFiniteNumber(record.poolId ?? record.pool_id);
  const itemId = toFiniteNumber(record.itemId ?? record.item_id ?? record.item);
  const timestamp = toFiniteNumber(record.timestamp ?? record.time ?? record.created_at ?? record.createdAt);
  if (poolType === undefined || poolId === undefined || itemId === undefined || timestamp === undefined) return undefined;

  const rawUid = record.uid ?? record.user_id ?? record.role_id ?? record.player_id ?? defaults.uid;
  const rawServer = record.server ?? record.server_id ?? record.exiliumServer ?? record.elmoServer ?? defaults.server;
  const rawRarity = record.rarity ?? record.quality ?? record.rank;
  const rawPullNumber = record.pullNumber ?? record.pull_number ?? record.item_num;

  return {
    uid: rawUid === undefined ? undefined : String(rawUid),
    server: normalizeServer(rawServer),
    poolType,
    poolId,
    itemId,
    timestamp,
    rarity: rawRarity === undefined ? undefined : toNumber(rawRarity),
    pullNumber: rawPullNumber === undefined ? undefined : toNumber(rawPullNumber),
    itemName: typeof record.itemName === "string" ? record.itemName : typeof record.item_name === "string" ? record.item_name : undefined,
    source: typeof record.source === "string" ? record.source : source,
    sourceOrder,
  };
}

function parseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parsePortableJson(json: AnyObject): ImportResult | undefined {
  if (json.format !== "gf2-local-tracker" || !Array.isArray(json.records)) return undefined;
  return {
    ok: true,
    format: "portable-export",
    records: json.records
      .map((record, index) => (isObject(record) ? draftFromLoose(record, "portable-export", index) : undefined))
      .filter((record): record is GachaRecordDraft => Boolean(record)),
    errors: [],
  };
}

function parseRecordCollection(json: AnyObject, format = "record-list"): ImportResult | undefined {
  if (!Array.isArray(json.records)) return undefined;
  const defaults: DraftDefaults = {
    uid: json.uid === undefined ? undefined : String(json.uid),
    server: normalizeServer(json.server) ?? normalizeServer(json.exiliumServer),
  };
  const records = json.records
    .map((record, index) => (isObject(record) ? draftFromLoose(record, "portable-export", index, defaults) : undefined))
    .filter((record): record is GachaRecordDraft => Boolean(record));
  if (records.length === 0 && json.records.length > 0) return undefined;
  return { ok: true, format, records, errors: [] };
}

function parseRecordArray(json: unknown): ImportResult | undefined {
  if (!Array.isArray(json)) return undefined;
  const records = json
    .map((record, index) => (isObject(record) ? draftFromLoose(record, "portable-export", index) : undefined))
    .filter((record): record is GachaRecordDraft => Boolean(record));
  if (records.length === 0) return undefined;
  return { ok: true, format: "record-list", records, errors: [] };
}

function parseOfficialApiResponse(json: AnyObject): ImportResult | undefined {
  const data = isObject(json.data) ? json.data : undefined;
  if (json.code !== 0 || !data || !Array.isArray(data.list)) return undefined;
  const records = data.list
    .map((record, index) => (isObject(record) ? draftFromLoose(record, "uid-headers-fetch", index, {
      uid: json.uid === undefined ? undefined : String(json.uid),
      server: normalizeServer(json.server),
      poolType: toFiniteNumber(json.poolType ?? json.pool_type ?? json.type_id),
    }) : undefined))
    .filter((record): record is GachaRecordDraft => Boolean(record));
  if (records.length === 0) return undefined;
  return { ok: true, format: "official-api-response", records, errors: [] };
}

function parseMergedNormalized(json: AnyObject): ImportResult | undefined {
  if (!Array.isArray(json.records) || json.total === undefined) return undefined;
  const uid = json.uid !== undefined ? String(json.uid) : undefined;
  const server = normalizeServer(json.exiliumServer) ?? normalizeServer(json.server);
  return {
    ok: true,
    format: "merged-normalized",
    records: json.records
      .map((record, index) => {
        if (!isObject(record)) return undefined;
        return draftFromLoose({ ...record, uid: record.uid ?? uid, server: record.server ?? server }, "merged-normalized", index);
      })
      .filter((record): record is GachaRecordDraft => Boolean(record)),
    errors: [],
  };
}

function parseExiliumDecrypted(json: AnyObject): ImportResult | undefined {
  const state = isObject(json.state) ? json.state : undefined;
  const profiles = state && isObject(state.profilesData) ? state.profilesData : undefined;
  if (!profiles) return undefined;

  const records: GachaRecordDraft[] = [];
  for (const profile of Object.values(profiles)) {
    if (!isObject(profile) || !isObject(profile.pulls)) continue;
    for (const value of Object.values(profile.pulls)) {
      const pulls = Array.isArray(value) ? value : [];
      for (const pull of pulls) {
        if (!isObject(pull)) continue;
        const draft = draftFromLoose(pull, "exilium-decrypted", records.length);
        if (draft) records.push(draft);
      }
    }
  }

  if (records.length === 0) return undefined;
  return { ok: true, format: "exilium-decrypted", records, errors: [] };
}

function parseGfl2HelpPullHistory(json: AnyObject): ImportResult | undefined {
  const records: GachaRecordDraft[] = [];

  for (const [serverKey, pools] of Object.entries(json)) {
    if (!isObject(pools)) continue;
    const server = normalizeServer(serverKey);
    for (const [poolTypeKey, value] of Object.entries(pools)) {
      if (!Array.isArray(value)) continue;
      const poolType = Number(poolTypeKey);
      if (!Number.isFinite(poolType)) continue;

      value.forEach((record, index) => {
        if (!isObject(record)) return;
        const draft = draftFromLoose(
          {
            ...record,
            server,
            poolType,
            pool_id: record.pool_id,
            item: record.item,
            time: record.time,
            rarity: record.quality,
            pullNumber: record.item_num,
          },
          "gfl2-help",
          records.length + index,
        );
        if (draft) records.push(draft);
      });
    }
  }

  if (records.length === 0) return undefined;
  return { ok: true, format: "gfl2-help", records, errors: [] };
}

function isResourceIndex(json: unknown): boolean {
  return isObject(json) && json.format === "gf2-resource-index" && isObject(json.items);
}

function extractJsonObjects(text: string): unknown[] {
  const objects: unknown[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j += 1) {
      const char = text[j];
      if (inString) {
        escaped = !escaped && char === "\\";
        if (!escaped && char === "\"") inString = false;
        if (char !== "\\") escaped = false;
        continue;
      }
      if (char === "\"") inString = true;
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) {
        const parsed = parseJson(text.slice(i, j + 1));
        if (parsed) objects.push(parsed);
        i = j;
        break;
      }
    }
  }
  return objects;
}

export function parseImportText(text: string, fileName?: string): ImportResult {
  const json = parseJson(text);
  if (isResourceIndex(json)) {
    return {
      ok: false,
      fileName,
      format: "gf2-resource-index",
      records: [],
      errors: [{ key: "resourceIndexNotRecordData" }],
    };
  }
  const arrayResult = parseRecordArray(json);
  if (arrayResult) return { ...arrayResult, fileName };

  if (isObject(json)) {
    const parsed = parsePortableJson(json)
      ?? parseMergedNormalized(json)
      ?? parseExiliumDecrypted(json)
      ?? parseOfficialApiResponse(json)
      ?? parseGfl2HelpPullHistory(json)
      ?? parseRecordCollection(json);
    if (parsed) return { ...parsed, fileName };
  }

  return {
    ok: false,
    fileName,
    records: [],
    errors: [{ key: "unknownImportFormat" }],
  };
}
