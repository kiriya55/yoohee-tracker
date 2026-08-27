import type { RemoteServerId } from "./remoteImport";

export type CapturePhase = "idle" | "starting" | "waiting" | "captured" | "stopping" | "error";

export type CaptureAgentStatus = {
  phase: CapturePhase;
  proxyPort?: number;
  credential: {
    available: boolean;
    serverId?: RemoteServerId;
    capturedAt?: string;
    uidAvailable: boolean;
  };
  pairingCodeSet: boolean;
  error?: string;
};

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type StringStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const REMEMBERED_UID_STORAGE_KEY = "gf2-local-tracker.uid";

const CAPTURE_PHASES = new Set<CapturePhase>(["idle", "starting", "waiting", "captured", "stopping", "error"]);
const REMEMBERED_UID_PATTERN = /^\d{4,20}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isServerId(value: unknown): value is RemoteServerId {
  return value === "dw-us"
    || value === "dw-cn"
    || value === "haoplay-intl"
    || value === "haoplay-asia"
    || value === "haoplay-kr"
    || value === "haoplay-jp";
}

export function normalizeUid(value: unknown): string | undefined {
  const uid = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return REMEMBERED_UID_PATTERN.test(uid) ? uid : undefined;
}

export function parseCaptureAgentStatus(value: unknown): CaptureAgentStatus {
  if (!isObject(value)
    || typeof value.phase !== "string"
    || !CAPTURE_PHASES.has(value.phase as CapturePhase)
    || typeof value.pairingCodeSet !== "boolean"
    || !isObject(value.credential)
    || typeof value.credential.available !== "boolean") {
    throw new Error("invalid capture agent status");
  }

  const credential = value.credential;
  const credentialAvailable = credential.available;
  if (typeof credentialAvailable !== "boolean") {
    throw new Error("invalid capture agent status");
  }
  if (credential.serverId !== undefined && !isServerId(credential.serverId)) {
    throw new Error("invalid capture agent status");
  }
  if (credential.capturedAt !== undefined && typeof credential.capturedAt !== "string") {
    throw new Error("invalid capture agent status");
  }
  if (value.proxyPort !== undefined && (typeof value.proxyPort !== "number" || !Number.isInteger(value.proxyPort))) {
    throw new Error("invalid capture agent status");
  }
  if (value.error !== undefined && typeof value.error !== "string") {
    throw new Error("invalid capture agent status");
  }

  return {
    phase: value.phase as CapturePhase,
    ...(value.proxyPort === undefined ? {} : { proxyPort: value.proxyPort }),
    credential: {
      available: credentialAvailable,
      ...(credential.serverId === undefined ? {} : { serverId: credential.serverId }),
      ...(credential.capturedAt === undefined ? {} : { capturedAt: credential.capturedAt }),
      uidAvailable: credential.uidAvailable === true,
    },
    pairingCodeSet: value.pairingCodeSet,
    ...(value.error === undefined ? {} : { error: value.error }),
  };
}

function loopbackUrl(baseUrl: string): URL {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new Error("local capture agent URL is invalid");
  }
  const hostname = base.hostname.toLowerCase();
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "[::1]" && hostname !== "::1") {
    throw new Error("local capture agent URL must use a loopback host");
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error("local capture agent URL must use HTTP or HTTPS");
  }
  return base;
}

export async function fetchCaptureAgentStatus(baseUrl: string, fetchImpl: FetchLike = fetch): Promise<CaptureAgentStatus> {
  const base = loopbackUrl(baseUrl);
  let response: Response;
  try {
    response = await fetchImpl(new URL("/v1/status", base.origin).toString(), { method: "GET" });
  } catch {
    throw new Error("local capture agent is unavailable");
  }
  if (!response.ok) throw new Error(`local capture agent status request failed: HTTP ${response.status}`);
  try {
    return parseCaptureAgentStatus(await response.json() as unknown);
  } catch (error) {
    if (error instanceof Error && error.message === "invalid capture agent status") throw error;
    throw new Error("local capture agent returned an invalid status");
  }
}

function defaultStorage(): StringStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readRememberedUid(storage: StringStorage | undefined = defaultStorage()): string {
  try {
    return normalizeUid(storage?.getItem(REMEMBERED_UID_STORAGE_KEY)) ?? "";
  } catch {
    return "";
  }
}

export function rememberUid(uid: string, storage: StringStorage | undefined = defaultStorage()): void {
  try {
    const normalized = normalizeUid(uid);
    if (normalized) storage?.setItem(REMEMBERED_UID_STORAGE_KEY, normalized);
    else storage?.removeItem(REMEMBERED_UID_STORAGE_KEY);
  } catch {
    // Private browsing and blocked storage should not prevent imports.
  }
}
