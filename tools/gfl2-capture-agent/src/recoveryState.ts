import os from "node:os";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { ProxySnapshot } from "./windowsProxy.js";

export type RecoveryState = {
  version: 1;
  startedAt: string;
  certificateThumbprint: string;
  proxy: ProxySnapshot;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : undefined;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export function parseRecoveryState(text: string): RecoveryState {
  try {
    const value = JSON.parse(text) as unknown;
    if (!isObject(value) || value.version !== 1 || typeof value.startedAt !== "string"
      || !Number.isFinite(new Date(value.startedAt).getTime())
      || typeof value.certificateThumbprint !== "string"
      || !isObject(value.proxy)) throw new Error();

    const proxy: ProxySnapshot = {
      server: parseOptionalString(value.proxy.server),
      enable: parseOptionalNumber(value.proxy.enable),
      autoConfigUrl: parseOptionalString(value.proxy.autoConfigUrl),
      autoDetect: parseOptionalNumber(value.proxy.autoDetect),
    };
    const encodedProxy = JSON.stringify(value.proxy);
    if (encodedProxy.includes("authorization") || encodedProxy.includes("token")) throw new Error();
    return {
      version: 1,
      startedAt: new Date(value.startedAt).toISOString(),
      certificateThumbprint: value.certificateThumbprint,
      proxy,
    };
  } catch {
    throw new Error("invalid recovery state");
  }
}

export function serializeRecoveryState(state: RecoveryState): string {
  return JSON.stringify(parseRecoveryState(JSON.stringify(state)), null, 2);
}

export function createRecoveryStatePath(): string {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, "GFL2CaptureAgent", "recovery.json");
}

export async function writeRecoveryState(filePath: string, state: RecoveryState): Promise<void> {
  const encoded = serializeRecoveryState(state);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, `${encoded}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function readRecoveryState(filePath: string): Promise<RecoveryState | undefined> {
  try {
    return parseRecoveryState(await readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof Error && error.message === "invalid recovery state") throw error;
    throw new Error("could not read recovery state");
  }
}

export type RecoveryOperations = {
  restoreProxy: (snapshot: ProxySnapshot) => Promise<void>;
  removeCertificate: (thumbprint: string) => Promise<void>;
};

export async function recoverInterruptedState(filePath: string, operations: RecoveryOperations): Promise<boolean> {
  const state = await readRecoveryState(filePath);
  if (!state) return false;
  try {
    await operations.restoreProxy(state.proxy);
    await operations.removeCertificate(state.certificateThumbprint);
    await rm(filePath, { force: true });
    return true;
  } catch {
    throw new Error("could not recover the previous capture session");
  }
}
