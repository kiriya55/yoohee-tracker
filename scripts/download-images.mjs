#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const MCC_ORIGIN = "https://gf2.mcc.wiki";
const DEFAULT_INDEX = "examples/gf2-resource-index.haoplay.json";
const DEFAULT_OUT_DIR = "public/images";

function parseArgs(argv) {
  const args = {
    index: DEFAULT_INDEX,
    outDir: DEFAULT_OUT_DIR,
    concurrency: 16,
    timeoutMs: 20000,
    retries: 2,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--index") args.index = argv[++i];
    else if (arg === "--out-dir") args.outDir = argv[++i];
    else if (arg === "--concurrency") args.concurrency = Math.max(1, Number(argv[++i]) || 16);
    else if (arg === "--timeout-ms") args.timeoutMs = Math.max(1000, Number(argv[++i]) || 20000);
    else if (arg === "--retries") args.retries = Math.max(0, Number(argv[++i]) || 2);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/download-images.mjs [options]

Options:
  --index <file>          Resource index JSON. Default: ${DEFAULT_INDEX}
  --out-dir <dir>         Output directory. Default: ${DEFAULT_OUT_DIR}
  --concurrency <n>       Parallel downloads. Default: 16
  --timeout-ms <ms>       Per-image timeout. Default: 20000
  --retries <n>           Retries on failure. Default: 2
  --dry-run               List targets without downloading
`);
}

function localPathForItem(item, outDir) {
  if (item.type === "doll" && item.code) {
    return path.join(outDir, "doll", `Avatar_Head_${item.code}.png`);
  }
  if (item.type === "weapon" && item.code) {
    return path.join(outDir, "weapon", `${item.code}_1024.png`);
  }
  if (item.iconUrl) {
    const url = new URL(item.iconUrl);
    return path.join(outDir, ...url.pathname.split("/").filter(Boolean));
  }
  return undefined;
}

function localPublicPath(item) {
  if (item.type === "doll" && item.code) {
    return `/images/doll/Avatar_Head_${item.code}.png`;
  }
  if (item.type === "weapon" && item.code) {
    return `/images/weapon/${item.code}_1024.png`;
  }
  if (item.iconUrl) {
    const url = new URL(item.iconUrl);
    return "/" + url.pathname.split("/").filter(Boolean).join("/");
  }
  return undefined;
}

async function downloadWithRetry(url, dest, timeoutMs, retries) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, buffer);
      return buffer.length;
    } catch (error) {
      if (attempt === retries) throw error;
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const index = JSON.parse(await fs.readFile(args.index, "utf8"));
  const items = Object.values(index.items ?? {});
  const targets = [];
  for (const item of items) {
    const dest = localPathForItem(item, args.outDir);
    const sourceUrl = item.iconUrl ?? buildFallbackUrl(item);
    if (!dest || !sourceUrl) continue;
    targets.push({ item, dest, sourceUrl });
  }

  console.log(`Found ${targets.length} images to download into ${args.outDir}`);
  if (args.dryRun) {
    for (const t of targets.slice(0, 20)) console.log(`  ${t.sourceUrl} -> ${t.dest}`);
    console.log(`  ... (${targets.length} total)`);
    return;
  }

  let cursor = 0;
  let ok = 0;
  let failed = 0;
  const failures = [];

  async function worker() {
    for (;;) {
      const idx = cursor;
      cursor += 1;
      if (idx >= targets.length) return;
      const { item, dest, sourceUrl } = targets[idx];
      try {
        const size = await downloadWithRetry(sourceUrl, dest, args.timeoutMs, args.retries);
        ok += 1;
        if (ok % 20 === 0 || idx < 3) console.log(`  [${ok}/${targets.length}] ${path.basename(dest)} (${size} bytes)`);
      } catch (error) {
        failed += 1;
        failures.push({ id: item.id, name: item.name, url: sourceUrl, error: String(error.message ?? error) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(args.concurrency, targets.length) }, () => worker()));
  console.log(`Done: ${ok} downloaded, ${failed} failed`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures.slice(0, 20)) console.log(`  id=${f.id} ${f.name ?? ""} ${f.url} : ${f.error}`);
    if (failures.length > 20) console.log(`  ... (${failures.length} total)`);
  }

  const updated = { ...index };
  for (const item of Object.values(updated.items ?? {})) {
    const pub = localPublicPath(item);
    if (pub) item.localIcon = pub;
  }
  const outIndexPath = path.join(args.outDir, "resource-index.json");
  await fs.mkdir(args.outDir, { recursive: true });
  await fs.writeFile(outIndexPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  console.log(`Wrote updated index with localIcon fields to ${outIndexPath}`);
}

function buildFallbackUrl(item) {
  if (item.type === "doll" && item.code) return `${MCC_ORIGIN}/image/doll/Avatar_Head_${encodeURIComponent(item.code)}.png`;
  if (item.type === "weapon" && item.code) return `${MCC_ORIGIN}/image/weapon/${encodeURIComponent(item.code)}_1024.png`;
  return undefined;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
