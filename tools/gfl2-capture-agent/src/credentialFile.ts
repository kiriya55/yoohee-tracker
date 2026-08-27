import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateCredential } from "./credential.js";
import type { CaptureCredential } from "./credential.js";

export async function writeCredentialFile(filePath: string, credential: CaptureCredential): Promise<void> {
  const validated = validateCredential(credential);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(validated, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function readCredentialFile(filePath: string): Promise<CaptureCredential> {
  try {
    const text = await readFile(filePath, "utf8");
    return validateCredential(JSON.parse(text) as unknown);
  } catch {
    throw new Error("invalid GFL2 capture credential file");
  }
}
