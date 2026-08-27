import { inspectGachaRequest, normalizeGfl2Uid } from "./targets.js";
import type { Gfl2ServerId } from "./targets.js";

export type CaptureCredential = {
  format: "gfl2-capture-credential";
  version: 1;
  serverId: Gfl2ServerId;
  endpoint: string;
  authorization: string;
  uid?: string;
  capturedAt: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isServerId(value: unknown): value is Gfl2ServerId {
  return value === "dw-us"
    || value === "dw-cn"
    || value === "haoplay-intl"
    || value === "haoplay-asia"
    || value === "haoplay-kr"
    || value === "haoplay-jp";
}

export function validateCredential(value: unknown): CaptureCredential {
  if (!isObject(value)
    || value.format !== "gfl2-capture-credential"
    || value.version !== 1
    || !isServerId(value.serverId)
    || typeof value.endpoint !== "string"
    || typeof value.authorization !== "string"
    || typeof value.capturedAt !== "string") {
    throw new Error("invalid GFL2 capture credential");
  }

  const capturedAt = new Date(value.capturedAt);
  if (!Number.isFinite(capturedAt.getTime())) throw new Error("invalid GFL2 capture timestamp");
  const uid = value.uid === undefined ? undefined : normalizeGfl2Uid(value.uid);
  if (value.uid !== undefined && !uid) throw new Error("invalid GFL2 capture UID");

  const request = inspectGachaRequest({
    method: "POST",
    url: value.endpoint,
    headers: { Authorization: value.authorization },
    ...(uid ? { body: `uid=${encodeURIComponent(uid)}` } : {}),
  });
  if (!request || request.serverId !== value.serverId) throw new Error("credential endpoint is not an allowed GFL2 gacha endpoint");

  return {
    format: "gfl2-capture-credential",
    version: 1,
    serverId: value.serverId,
    endpoint: request.endpoint,
    authorization: request.authorization,
    ...(uid ? { uid } : {}),
    capturedAt: capturedAt.toISOString(),
  };
}

export function publicCredentialStatus(credential?: CaptureCredential): {
  available: boolean;
  serverId?: Gfl2ServerId;
  capturedAt?: string;
  uidAvailable: boolean;
} {
  if (!credential) return { available: false, uidAvailable: false };
  return {
    available: true,
    serverId: credential.serverId,
    capturedAt: credential.capturedAt,
    uidAvailable: Boolean(credential.uid),
  };
}
