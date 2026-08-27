import { REMOTE_SERVERS, serverOptionForId } from "./remoteImport";
import type { RemoteServerId } from "./remoteImport";
import { normalizeUid } from "./captureAgent";

export type CaptureCredential = {
  format: "gfl2-capture-credential";
  version: 1;
  serverId: RemoteServerId;
  endpoint: string;
  authorization: string;
  uid?: string;
  capturedAt: string;
};

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]" || normalized === "::1";
}

function serverIdIsValid(value: unknown): value is RemoteServerId {
  return typeof value === "string" && REMOTE_SERVERS.some((server) => server.id === value);
}

function canonicalEndpoint(serverId: RemoteServerId, endpoint: string): string {
  let actual: URL;
  try {
    actual = new URL(endpoint);
  } catch {
    throw new Error("capture credential endpoint is invalid");
  }
  const expected = new URL(serverOptionForId(serverId).endpoint);
  actual.hash = "";
  actual.searchParams.delete("type_id");
  actual.searchParams.delete("next");
  if (actual.protocol !== "https:" || actual.hostname !== expected.hostname || actual.pathname !== "/list" || actual.toString() !== expected.toString()) {
    throw new Error("capture credential endpoint is not an allowed GFL2 gacha endpoint");
  }
  return actual.toString();
}

export function parseCaptureCredential(value: unknown): CaptureCredential {
  if (!isObject(value)
    || value.format !== "gfl2-capture-credential"
    || value.version !== 1
    || !serverIdIsValid(value.serverId)
    || typeof value.endpoint !== "string"
    || typeof value.authorization !== "string"
    || typeof value.capturedAt !== "string") {
    throw new Error("invalid GFL2 capture credential");
  }
  const authorization = value.authorization.trim();
  if (authorization.length < 8) throw new Error("capture credential authorization is invalid");
  const uid = value.uid === undefined ? undefined : normalizeUid(value.uid);
  if (value.uid !== undefined && !uid) throw new Error("capture credential UID is invalid");
  const capturedAt = new Date(value.capturedAt);
  if (!Number.isFinite(capturedAt.getTime())) throw new Error("capture credential timestamp is invalid");
  return {
    format: "gfl2-capture-credential",
    version: 1,
    serverId: value.serverId,
    endpoint: canonicalEndpoint(value.serverId, value.endpoint),
    authorization,
    ...(uid ? { uid } : {}),
    capturedAt: capturedAt.toISOString(),
  };
}

export async function claimLocalCaptureCredential(
  baseUrl: string,
  pairingCode: string,
  fetchImpl: FetchLike = fetch,
): Promise<CaptureCredential> {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new Error("local capture agent URL is invalid");
  }
  if (!isLoopbackHost(base.hostname)) throw new Error("local capture agent URL must use a loopback host");
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("local capture agent URL must use HTTP or HTTPS");
  if (!pairingCode.trim()) throw new Error("pairing code is required");

  let response: Response;
  try {
    response = await fetchImpl(new URL("/v1/credential/claim", base.origin).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingCode }),
    });
  } catch {
    throw new Error("local capture agent is unavailable");
  }
  if (!response.ok) throw new Error(response.status === 409 ? "local capture credential is not available" : "local capture agent rejected the credential claim");

  try {
    const body = await response.json() as unknown;
    if (!isObject(body)) throw new Error();
    return parseCaptureCredential(body.credential);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("capture credential")) throw error;
    throw new Error("local capture agent returned an invalid credential");
  }
}

export async function claimLocalCaptureGrant(
  baseUrl: string,
  grantToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<CaptureCredential> {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new Error("local capture agent URL is invalid");
  }
  if (!isLoopbackHost(base.hostname)) throw new Error("local capture agent URL must use a loopback host");
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("local capture agent URL must use HTTP or HTTPS");
  if (!grantToken.trim()) throw new Error("pairing grant is required");

  let response: Response;
  try {
    response = await fetchImpl(new URL("/v1/credential/claim", base.origin).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grantToken }),
    });
  } catch {
    throw new Error("local capture agent is unavailable");
  }
  if (!response.ok) throw new Error(response.status === 409 ? "local capture credential is not available" : "local capture agent rejected the credential claim");

  try {
    const body = await response.json() as unknown;
    if (!isObject(body)) throw new Error();
    return parseCaptureCredential(body.credential);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("capture credential")) throw error;
    throw new Error("local capture agent returned an invalid credential");
  }
}
