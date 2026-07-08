#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DECRYPT_ACTION = "4028fcc7fd7d2eab2289b47a723dd4ee08fb9e1d23";

function usage() {
  console.error("Usage: node scripts/decrypt-exilium-backup.mjs <backup.json> [output.json]");
}

function parseRscPayload(text) {
  const marker = "10:T";
  const idx = text.indexOf(marker);
  if (idx < 0) throw new Error("exilium response did not include the expected RSC payload marker");
  const comma = text.indexOf(",", idx);
  if (comma < 0) throw new Error("exilium response payload was malformed");
  const length = Number.parseInt(text.slice(idx + marker.length, comma), 16);
  if (!Number.isFinite(length)) throw new Error("exilium response payload length was invalid");
  return JSON.parse(text.slice(comma + 1, comma + 1 + length));
}

async function decryptBackup(inputPath, outputPath) {
  const backup = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!backup.data) throw new Error("backup JSON does not contain a data field");

  const response = await fetch("https://exilium.xyz/settings", {
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
  const json = zlib.gunzipSync(Buffer.from(payload, "base64")).toString("utf8");
  fs.writeFileSync(outputPath, `${JSON.stringify(JSON.parse(json), null, 2)}\n`);
  return outputPath;
}

const input = process.argv[2];
const output = process.argv[3] ?? (input ? path.join(path.dirname(input), "exilium-decrypted.json") : undefined);

if (!input || !output) {
  usage();
  process.exit(1);
}

decryptBackup(input, output)
  .then((file) => console.log(`Wrote ${file}`))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
