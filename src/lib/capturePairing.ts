import type { FetchLike } from "./captureAgent";

export const CAPTURE_PAIRING_MESSAGE_TYPE = "gfl2-capture-pairing-approved";

export type LocalPairingResponse = {
  requestId: string;
  state: string;
  origin: string;
  approvalUrl: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function loopbackUrl(baseUrl: string): URL {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new Error("local capture agent URL is invalid");
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error("local capture agent URL must use HTTP or HTTPS");
  }
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(base.hostname.toLowerCase())) {
    throw new Error("local capture agent URL must use a loopback host");
  }
  return base;
}

function parsePairingResponse(value: unknown, expectedState: string): LocalPairingResponse {
  if (!isObject(value)
    || typeof value.requestId !== "string"
    || typeof value.state !== "string"
    || value.state !== expectedState
    || typeof value.origin !== "string"
    || typeof value.approvalUrl !== "string") {
    throw new Error("local capture agent returned an invalid pairing response");
  }
  const approval = loopbackUrl(value.approvalUrl);
  if (approval.pathname !== "/pairing/approve") {
    throw new Error("local capture agent returned an invalid pairing response");
  }
  return {
    requestId: value.requestId,
    state: value.state,
    origin: value.origin,
    approvalUrl: approval.toString(),
  };
}

export function parseCapturePairingMessage(
  value: unknown,
  expectedState: string,
  messageOrigin?: string,
  expectedOrigin?: string,
): string | undefined {
  if (!isObject(value)
    || value.type !== CAPTURE_PAIRING_MESSAGE_TYPE
    || value.state !== expectedState
    || (expectedOrigin !== undefined && messageOrigin !== expectedOrigin)
    || typeof value.grantToken !== "string"
    || !value.grantToken.trim()) {
    return undefined;
  }
  return value.grantToken;
}

export async function requestLocalPairing(
  baseUrl: string,
  state: string,
  fetchImpl: FetchLike = fetch,
): Promise<LocalPairingResponse> {
  const base = loopbackUrl(baseUrl);
  if (!state.trim()) throw new Error("pairing state is required");
  const requestUrl = new URL("/v1/pairing/request", base.origin);
  requestUrl.searchParams.set("state", state);
  let response: Response;
  try {
    response = await fetchImpl(requestUrl.toString(), { method: "GET" });
  } catch {
    throw new Error("local capture agent is unavailable");
  }
  if (!response.ok) {
    if (response.status === 403) throw new Error("local pairing origin is not allowed");
    throw new Error(`local capture agent pairing request failed: HTTP ${response.status}`);
  }
  return parsePairingResponse(await response.json() as unknown, state);
}
