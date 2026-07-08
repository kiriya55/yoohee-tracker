import type { GachaRecordDraft, ImportResult } from "../types";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type RemoteServerId = "dw-us" | "dw-cn" | "haoplay-intl" | "haoplay-asia" | "haoplay-kr" | "haoplay-jp";

export type RemoteServerOption = {
  id: RemoteServerId;
  label: string;
  server: string;
  endpoint: string;
};

type RemoteFetchOptions = {
  uid: string;
  server: string;
  endpoint: string;
  headersText: string;
  poolTypes?: number[];
  fetchImpl?: FetchLike;
};

type BuildRequestOptions = {
  endpoint: string;
  headers: Record<string, string>;
  poolType: number;
  next?: string;
};

export const REMOTE_POOL_TYPES = [1, 3, 4, 6, 7];

export const REMOTE_SERVERS: RemoteServerOption[] = [
  {
    id: "dw-us",
    label: "Darkwinter",
    server: "darkwinter",
    endpoint: "https://gf2-gacha-record-us.sunborngame.com/list?game_channel_id=5",
  },
  {
    id: "haoplay-intl",
    label: "Haoplay Global",
    server: "haoplay-intl",
    endpoint: "https://gf2-gacha-record-intl.haoplay.com/list?game_channel_id=10001",
  },
  {
    id: "haoplay-asia",
    label: "Haoplay Asia",
    server: "haoplay",
    endpoint: "https://gf2-gacha-record-asia.haoplay.com/list?game_channel_id=10001",
  },
  {
    id: "haoplay-kr",
    label: "Haoplay Korea",
    server: "haoplay-kr",
    endpoint: "https://gf2-gacha-record-kr.haoplay.com/list?game_channel_id=10001",
  },
  {
    id: "haoplay-jp",
    label: "Haoplay Japan",
    server: "haoplay-jp",
    endpoint: "https://gf2-gacha-record-jp.haoplay.com/list?game_channel_id=10001",
  },
  {
    id: "dw-cn",
    label: "Darkwinter CN",
    server: "cn",
    endpoint: "https://gf2-gacha-record.sunborngame.com/list",
  },
];

const HOST_TO_SERVER_ID: Record<string, RemoteServerId> = {
  "gf2-gacha-record-us.sunborngame.com": "dw-us",
  "gf2-gacha-record.sunborngame.com": "dw-cn",
  "gf2-gacha-record-intl.haoplay.com": "haoplay-intl",
  "gf2-gacha-record-asia.haoplay.com": "haoplay-asia",
  "gf2-gacha-record-kr.haoplay.com": "haoplay-kr",
  "gf2-gacha-record-jp.haoplay.com": "haoplay-jp",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function parseHeaderText(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && value) headers[key] = value;
  }
  return headers;
}

export function defaultEndpointForServer(serverId: RemoteServerId): string {
  return REMOTE_SERVERS.find((server) => server.id === serverId)?.endpoint ?? REMOTE_SERVERS[0].endpoint;
}

export function serverOptionForId(serverId: RemoteServerId): RemoteServerOption {
  return REMOTE_SERVERS.find((server) => server.id === serverId) ?? REMOTE_SERVERS[0];
}

export function parseFiddlerRequest(text: string): { endpoint?: string; headers?: Record<string, string>; serverId?: RemoteServerId } {
  const url = text.match(/^POST\s+(\S+)\s+HTTP\/1\.1/im)?.[1];
  const host = text.match(/^Host:\s*(.+)$/im)?.[1]?.trim().toLowerCase();
  const token = text.match(/^Authorization:\s*(.+)$/im)?.[1]?.trim();
  if (!url && !host && !token) return {};

  const headers = parseHeaderText(text);
  if (host) headers.Host = host;
  if (!headers.Authorization && token) headers.Authorization = token;
  if (!headers.Accept) headers.Accept = "*/*";
  if (!headers["Accept-Encoding"]) headers["Accept-Encoding"] = "deflate, gzip";
  if (!headers["Content-Type"]) headers["Content-Type"] = "application/x-www-form-urlencoded";

  const serverId = host ? HOST_TO_SERVER_ID[host] : undefined;
  return { endpoint: url, headers, serverId };
}

export function buildGachaRequest({ endpoint, headers, poolType, next }: BuildRequestOptions) {
  const url = new URL(endpoint);
  url.searchParams.delete("type_id");
  url.searchParams.delete("next");
  const body = new URLSearchParams();
  body.set("type_id", String(poolType));
  if (next) body.set("next", next);

  return {
    url: url.toString(),
    init: {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    } satisfies RequestInit,
  };
}

function browserSafeHeaders(headers: Record<string, string>): Record<string, string> {
  const safe = { ...headers };
  delete safe["User-Agent"];
  delete safe["user-agent"];
  return safe;
}

function normalizeListItem(item: unknown, uid: string, server: string, poolType: number, sourceOrder: number): GachaRecordDraft | undefined {
  if (!isObject(item)) return undefined;
  const poolId = item.pool_id ?? item.poolId;
  const itemId = item.item ?? item.item_id ?? item.itemId;
  const timestamp = item.time ?? item.timestamp;
  if (poolId === undefined || itemId === undefined || timestamp === undefined) return undefined;

  return {
    uid,
    server,
    poolType,
    poolId: toNumber(poolId),
    itemId: toNumber(itemId),
    timestamp: toNumber(timestamp),
    rarity: item.rarity === undefined ? undefined : toNumber(item.rarity),
    source: "uid-headers-fetch",
    sourceOrder,
  };
}

export async function fetchRemoteGachaRecords(options: RemoteFetchOptions): Promise<ImportResult> {
  const parsedRequest = parseFiddlerRequest(options.headersText);
  const headers = parsedRequest.headers ?? parseHeaderText(options.headersText);
  const endpoint = parsedRequest.endpoint ?? options.endpoint.trim();
  const poolTypes = options.poolTypes ?? REMOTE_POOL_TYPES;
  if (!options.uid.trim()) return { ok: false, format: "uid-headers-fetch", records: [], errors: ["请填写 UID。"] };
  if (!endpoint) return { ok: false, format: "uid-headers-fetch", records: [], errors: ["请填写抽卡记录 URL，或粘贴完整 Fiddler 请求。"] };
  if (!headers.Authorization && !headers.authorization) {
    return { ok: false, format: "uid-headers-fetch", records: [], errors: ["Headers 中缺少 Authorization。"] };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const records: GachaRecordDraft[] = [];

  try {
    await Promise.all(poolTypes.map(async (poolType) => {
      let next = "";
      do {
        const request = buildGachaRequest({ endpoint, headers: browserSafeHeaders(headers), poolType, next });
        const response = await fetchImpl(request.url, request.init);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        if (!isObject(json)) throw new Error("返回值不是 JSON 对象");
        if (json.code !== 0) throw new Error(String(json.message ?? `接口返回 code=${json.code}`));

        const data = isObject(json.data) ? json.data : {};
        const list = Array.isArray(data.list) ? data.list : [];
        for (const item of list) {
          const draft = normalizeListItem(item, options.uid.trim(), options.server.trim() || "haoplay", poolType, records.length);
          if (draft) records.push(draft);
        }
        next = typeof data.next === "string" ? data.next : "";
      } while (next);
    }));
  } catch (error) {
    const message = error instanceof TypeError
      ? "远程抓取失败：浏览器可能拦截了跨域请求，或 Headers/URL 已失效。"
      : `远程抓取失败：${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, format: "uid-headers-fetch", records, errors: [message] };
  }

  return {
    ok: records.length > 0,
    format: "uid-headers-fetch",
    records,
    errors: records.length ? [] : ["远程接口返回为空。"],
  };
}
