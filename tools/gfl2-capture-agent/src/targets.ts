export type Gfl2ServerId =
  | "dw-us"
  | "dw-cn"
  | "haoplay-intl"
  | "haoplay-asia"
  | "haoplay-kr"
  | "haoplay-jp";

export type CapturedRequest = {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body?: string;
};

export type GachaRequestInfo = {
  serverId: Gfl2ServerId;
  endpoint: string;
  authorization: string;
  uid?: string;
};

const HOST_TO_SERVER_ID: Record<string, Gfl2ServerId> = {
  "gf2-gacha-record-us.sunborngame.com": "dw-us",
  "gf2-gacha-record.sunborngame.com": "dw-cn",
  "gf2-gacha-record-intl.haoplay.com": "haoplay-intl",
  "gf2-gacha-record-asia.haoplay.com": "haoplay-asia",
  "gf2-gacha-record-kr.haoplay.com": "haoplay-kr",
  "gf2-gacha-record-jp.haoplay.com": "haoplay-jp",
};

export const GFL2_GACHA_HOSTS = Object.freeze(Object.keys(HOST_TO_SERVER_ID));

function headerValue(headers: Record<string, string | undefined>, name: string): string | undefined {
  const expected = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === expected);
  return entry?.[1]?.trim() || undefined;
}

export function normalizeGfl2Uid(value: unknown): string | undefined {
  const uid = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return /^\d{4,20}$/.test(uid) ? uid : undefined;
}

function uidFromEntries(entries: Iterable<[string, string]>): string | undefined {
  const uidKeys = new Set(["uid", "user_id", "userid", "player_id", "playerid"]);
  for (const [key, value] of entries) {
    if (uidKeys.has(key.toLowerCase())) {
      const uid = normalizeGfl2Uid(value);
      if (uid) return uid;
    }
  }
  return undefined;
}

function uidFromBody(body: string | undefined): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>)
        .map(([key, value]) => [key, String(value)] as [string, string]);
      return uidFromEntries(entries);
    }
  } catch {
    // GFL2 normally uses form encoding; fall through to URLSearchParams.
  }
  return uidFromEntries(new URLSearchParams(body).entries());
}

export function serverIdForHost(hostname: string): Gfl2ServerId | undefined {
  return HOST_TO_SERVER_ID[hostname.toLowerCase()];
}

export function inspectGachaRequest(request: CapturedRequest): GachaRequestInfo | undefined {
  if (request.method.toUpperCase() !== "POST") return undefined;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return undefined;
  }

  const serverId = serverIdForHost(url.hostname);
  if (url.protocol !== "https:" || !serverId || url.pathname !== "/list") return undefined;

  const authorization = headerValue(request.headers, "authorization");
  if (!authorization || authorization.length < 8) return undefined;

  const endpoint = new URL(url.toString());
  endpoint.hash = "";
  for (const key of [...endpoint.searchParams.keys()]) {
    if (key !== "game_channel_id") endpoint.searchParams.delete(key);
  }

  const uid = uidFromEntries(url.searchParams.entries()) ?? uidFromBody(request.body);
  return {
    serverId,
    endpoint: endpoint.toString(),
    authorization,
    ...(uid ? { uid } : {}),
  };
}
