import type { GachaRecordDraft, ImportResult, SourceKind } from "../types";

type AnyObject = Record<string, unknown>;

function isObject(value: unknown): value is AnyObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeServer(server: unknown): string | undefined {
  if (typeof server !== "string") return undefined;
  if (server === "hao-asia" || server === "hao-jp" || server === "hao-kr" || server === "hao-intl") return "haoplay";
  if (server === "dw-cn" || server === "dw-us") return "darkwinter";
  return server === "tw" ? "haoplay" : server;
}

function draftFromLoose(record: AnyObject, source: SourceKind, sourceOrder: number): GachaRecordDraft | undefined {
  const poolType = record.poolType ?? record.pool_type ?? record.type_id;
  const poolId = record.poolId ?? record.pool_id;
  const itemId = record.itemId ?? record.item_id ?? record.item;
  const timestamp = record.timestamp ?? record.time;
  if (poolType === undefined || poolId === undefined || itemId === undefined || timestamp === undefined) return undefined;

  return {
    uid: record.uid !== undefined ? String(record.uid) : undefined,
    server: normalizeServer(record.server) ?? normalizeServer(record.exiliumServer) ?? normalizeServer(record.elmoServer),
    poolType: toNumber(poolType),
    poolId: toNumber(poolId),
    itemId: toNumber(itemId),
    timestamp: toNumber(timestamp),
    rarity: record.rarity === undefined ? undefined : toNumber(record.rarity),
    pullNumber: record.pullNumber === undefined && record.pull_number === undefined ? undefined : toNumber(record.pullNumber ?? record.pull_number),
    itemName: typeof record.itemName === "string" ? record.itemName : undefined,
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
  if (isObject(json)) {
    const parsed = parsePortableJson(json) ?? parseMergedNormalized(json) ?? parseExiliumDecrypted(json) ?? parseGfl2HelpPullHistory(json);
    if (parsed) return { ...parsed, fileName };
  }

  return {
    ok: false,
    fileName,
    records: [],
    errors: [{ key: "unknownImportFormat" }],
  };
}
