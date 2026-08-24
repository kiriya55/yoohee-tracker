#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fetchWithRetry } from "./fetch-with-retry.mjs";
import { buildAssetDescriptor } from "./asset-mapping.mjs";
import { fetchDandegateAssetSources, selectDandegateSyncTargets } from "./dandegate-assets.mjs";
import { convertDollToPng } from "./image-assets.mjs";

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
    force: false,
    dryRun: false,
    proxyUrl: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--index") args.index = argv[++i];
    else if (arg === "--out-dir") args.outDir = argv[++i];
    else if (arg === "--concurrency") args.concurrency = Math.max(1, Number(argv[++i]) || 16);
    else if (arg === "--timeout-ms") args.timeoutMs = Math.max(1000, Number(argv[++i]) || 20000);
    else if (arg === "--retries") args.retries = Math.max(0, Number(argv[++i]) || 2);
    else if (arg === "--force") args.force = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--proxy-url") args.proxyUrl = argv[++i];
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
  --force                 Download and overwrite existing local images
  --dry-run               List targets without downloading
`);
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function localPathForItem(item, outDir) {
  const asset = buildAssetDescriptor(item.type, item.code);
  if (asset) return path.join(outDir, ...asset.targetPath.split("/"));
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
  const asset = buildAssetDescriptor(item.type, item.code);
  if (asset) return asset.localIcon;
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

async function downloadWithRetry(url, dest, timeoutMs, retries, item, proxyUrl) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithRetry(url, {
        proxyUrl,
        attempts: 1,
        headers: { "user-agent": "yoohee-tracker-resource-updater/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const sourceBuffer = Buffer.from(await response.arrayBuffer());
      const buffer = item.type === "doll"
        ? await convertDollToPng(sourceBuffer, item.assetSource?.transform)
        : sourceBuffer;
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
  if (!args.dryRun) {
    const dandegate = await fetchDandegateAssetSources(selectDandegateSyncTargets(items), { proxyUrl: args.proxyUrl });
    for (const update of dandegate.updates) {
      const item = index.items[String(update.id)];
      if (!item || item.assetSource?.frozen) continue;
      item.assetSource = update.assetSource;
      item.iconUrl = update.assetSource.sourceUrl;
      item.imageSource = update.assetSource.source;
      item.assetPath = update.assetSource.targetPath;
      item.localIcon = update.assetSource.localIcon;
    }
    if (dandegate.failures.length) {
      throw new Error("Dandegate assets unresolved: " + JSON.stringify(dandegate.failures));
    }
  }
  const updatedItems = Object.values(index.items ?? {});
  const targets = [];
  const frozenMissing = [];
  for (const item of updatedItems) {
    const dest = localPathForItem(item, args.outDir);
    const asset = buildAssetDescriptor(item.type, item.code);
    if (asset?.frozen) {
      if (!dest || !await fileExists(dest)) frozenMissing.push({ id: item.id, dest });
      continue;
    }
    const sourceUrl = item.assetSource?.sourceUrl ?? asset?.sourceUrl ?? item.iconUrl ?? buildFallbackUrl(item);
    if (!dest || !sourceUrl) continue;
    if (!args.force && await fileExists(dest)) continue;
    targets.push({ item, dest, sourceUrl });
  }

  if (frozenMissing.length) {
    throw new Error("Frozen image assets are missing locally: " + frozenMissing.map((item) => `${item.id} (${item.dest ?? "unknown path"})`).join(", "));
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
        const size = await downloadWithRetry(sourceUrl, dest, args.timeoutMs, args.retries, item, args.proxyUrl);
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
    const asset = buildAssetDescriptor(item.type, item.code);
    const pub = localPublicPath(item);
    const dest = localPathForItem(item, args.outDir);
    if (pub && dest && await fileExists(dest)) {
      item.localIcon = pub;
      if (asset) {
        item.assetPath = asset.targetPath;
        if (!item.assetSource) item.assetSource = asset;
      }
    }
    else delete item.localIcon;
  }
  const outIndexPath = path.join(args.outDir, "resource-index.json");
  await fs.mkdir(args.outDir, { recursive: true });
 await fs.writeFile(outIndexPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
 console.log(`Wrote updated index with localIcon fields to ${outIndexPath}`);
  if (failures.length) process.exitCode = 1;
}

function buildFallbackUrl(item) {
  if (item.type === "doll" && item.code) return `${MCC_ORIGIN}/image/doll/Avatar_Head_${encodeURIComponent(item.code)}.png`;
  if (item.type === "weapon" && item.code) return `${MCC_ORIGIN}/static/image/weapon/${encodeURIComponent(item.code)}_1024.png`;
  return undefined;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
