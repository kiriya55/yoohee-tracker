#!/usr/bin/env node
import fs from "node:fs/promises";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const file = process.argv.find((arg, index) => index > 1 && !arg.startsWith("--") && !process.argv[index - 1]?.startsWith("--"));
const concurrency = Math.max(1, Number(option("--concurrency", "16")) || 16);
const timeoutMs = Math.max(1000, Number(option("--timeout-ms", "10000")) || 10000);

if (!file || process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: node scripts/check-resource-images.mjs <gf2-resource-index.json> [options]

Options:
  --concurrency <n>   Parallel HEAD requests. Default: 16
  --timeout-ms <ms>   Per-request timeout. Default: 10000
`);
  process.exit(file ? 0 : 1);
}

const index = JSON.parse(await fs.readFile(file, "utf8"));
const items = Object.values(index.items ?? {}).filter((item) => item.iconUrl);
async function checkItem(item) {
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    const response = await fetch(item.iconUrl, { method: "HEAD", signal });
    if (response.ok) {
      return { ok: true };
    }
    return { ok: false, message: `MISS ${item.id} ${response.status} ${item.iconUrl}` };
  } catch (error) {
    return { ok: false, message: `ERR  ${item.id} ${error instanceof Error ? error.message : String(error)}` };
  }
}

let cursor = 0;
let ok = 0;
let failed = 0;

async function worker() {
  for (;;) {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) return;
    const result = await checkItem(items[index]);
    if (result.ok) ok += 1;
    else {
      failed += 1;
      console.log(result.message);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
console.log(`Checked ${items.length} image URLs: ${ok} ok, ${failed} failed.`);
process.exit(failed ? 1 : 0);
