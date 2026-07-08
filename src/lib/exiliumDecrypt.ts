const DECRYPT_ACTION = "4028fcc7fd7d2eab2289b47a723dd4ee08fb9e1d23";

type FetchLike = typeof fetch;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseRscPayload(text: string): unknown {
  const marker = "10:T";
  const idx = text.indexOf(marker);
  if (idx < 0) throw new Error("exilium response did not include the expected RSC payload marker");

  const comma = text.indexOf(",", idx);
  if (comma < 0) throw new Error("exilium response payload was malformed");

  const length = Number.parseInt(text.slice(idx + marker.length, comma), 16);
  if (!Number.isFinite(length)) throw new Error("exilium response payload length was invalid");

  return JSON.parse(text.slice(comma + 1, comma + 1 + length));
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function gunzipBase64Json(base64: string): Promise<unknown> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("this browser does not support gzip decompression; please use a recent Chrome, Edge, Firefox, or Safari");
  }

  const bytes = base64ToBytes(base64);
  const copy: Uint8Array<ArrayBuffer> = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  return JSON.parse(text);
}

export async function decryptExiliumBackupText(text: string, fetchImpl: FetchLike = fetch): Promise<unknown> {
  const backup = JSON.parse(text);
  if (!isObject(backup) || typeof backup.data !== "string" || !backup.data) {
    throw new Error("backup JSON does not contain a data field");
  }

  const response = await fetchImpl("https://exilium.xyz/settings", {
    method: "POST",
    headers: {
      accept: "text/x-component",
      "content-type": "text/plain;charset=UTF-8",
      "next-action": DECRYPT_ACTION,
      origin: "https://exilium.xyz",
      referer: "https://exilium.xyz/settings",
    },
    body: JSON.stringify([backup.data]),
  });

  if (!response.ok) {
    throw new Error(`exilium decrypt request failed: HTTP ${response.status}`);
  }

  const payload = parseRscPayload(await response.text());
  if (typeof payload !== "string") {
    throw new Error("exilium response payload was not a base64 string");
  }

  return gunzipBase64Json(payload);
}
