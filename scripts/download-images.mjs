#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { fetchWithRetry } from "./fetch-with-retry.mjs";
import { buildAssetDescriptor } from "./asset-mapping.mjs";
import {
  classifyDandegateFailure,
  fetchDandegateAssetSources,
  selectDandegateSyncTargets,
} from "./dandegate-assets.mjs";
import { convertDollToPng } from "./image-assets.mjs";
import {
  canMarkAvatarPending,
  clearAvatarPendingMarker,
  isAvatarPendingItem,
  markAvatarPending,
} from "./avatar-pending.mjs";

const MCC_ORIGIN = "https://gf2.mcc.wiki";
const DEFAULT_INDEX = "examples/gf2-resource-index.haoplay.json";
const DEFAULT_OUT_DIR = "public/images";
const DEFAULT_REPORT_OUT = "output/download-report.json";
const PENDING_EXIT_CODE = 2;

function parseArgs(argv) {
  const args = {
    index: DEFAULT_INDEX,
    outDir: DEFAULT_OUT_DIR,
    concurrency: 16,
    timeoutMs: 20000,
    retries: 2,
    reportOut: DEFAULT_REPORT_OUT,
    dandegateConcurrency: 4,
    force: false,
    forceDolls: false,
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
    else if (arg === "--report-out") args.reportOut = argv[++i];
    else if (arg === "--dandegate-concurrency") args.dandegateConcurrency = Math.max(1, Number(argv[++i]) || 4);
    else if (arg === "--force") args.force = true;
    else if (arg === "--force-dolls") args.forceDolls = true;
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
  --report-out <file>     JSON report path. Default: ${DEFAULT_REPORT_OUT}
  --dandegate-concurrency <n>
                          Parallel Dandegate page lookups. Default: 4
  --force                 Download and overwrite existing local images
  --force-dolls           Reprocess existing doll images, leaving weapons untouched
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
  let attempts = 0;
  try {
    const response = await fetchWithRetry(url, {
      proxyUrl,
      attempts: Math.max(1, Number(retries) + 1),
      onAttempt: () => { attempts += 1; },
      headers: { "user-agent": "yoohee-tracker-resource-updater/1.0" },
      signalFactory: () => AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const sourceBuffer = Buffer.from(await response.arrayBuffer());
    const buffer = item.type === "doll"
      ? await convertDollToPng(sourceBuffer, item.assetSource?.transform)
      : sourceBuffer;
    await validateImageBuffer(buffer, item);
    await writeBufferAtomic(dest, buffer);
    return { size: buffer.length, attempts };
  } catch (error) {
    if (error && typeof error === "object") error.attempts = attempts;
    throw error;
  }
}

function classifyDownloadFailure(error) {
  const reason = String(error?.message ?? error ?? "");
  if (/HTTP (404|410)\b/i.test(reason)) return "source_pending";
  if (/HTTP (408|425|429|5\d\d)\b|timed? ?out|ETIMEDOUT|ECONN|failed after \d+ attempts/i.test(reason)) {
    return "transient_error";
  }
  return "hard_failure";
}

function initialReport(args) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "running",
    input: { index: args.index, outDir: args.outDir },
    counts: { catalogItems: 0, targets: 0, downloaded: 0, pending: 0, avatarPending: 0, failed: 0 },
    pending: [],
    avatarPending: [],
    failures: [],
    stages: {},
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = initialReport(args);
  try {
    await writeJsonAtomic(args.reportOut, report);
    const index = JSON.parse(await fs.readFile(args.index, "utf8"));
    const items = Object.values(index.items ?? {});
    report.counts.catalogItems = items.length;

    let dandegate = { updates: [], failures: [], pages: [] };
    if (!args.dryRun) {
      try {
        dandegate = await fetchDandegateAssetSources(
          selectDandegateSyncTargets(items, { refresh: args.forceDolls }),
          {
            proxyUrl: args.proxyUrl,
            concurrency: args.dandegateConcurrency,
            timeoutMs: args.timeoutMs,
            attempts: Math.max(1, args.retries + 1),
          },
        );
        const pendingCount = dandegate.failures.filter((failure) => (
          (failure.kind ?? classifyDandegateFailure(failure)) === "source_pending"
        )).length;
        const hardFailureCount = dandegate.failures.length - pendingCount;
        report.stages.dandegate = {
          status: hardFailureCount ? "hard_failure" : pendingCount ? "avatar_pending" : "success",
          updated: dandegate.updates.length,
          failures: hardFailureCount,
          pending: pendingCount,
        };
      } catch (error) {
        report.stages.dandegate = { status: "hard_failure", error: String(error.message ?? error) };
        report.status = "hard_failure";
        report.error = String(error.message ?? error);
        await writeJsonAtomic(args.reportOut, report);
        throw error;
      }
      for (const update of dandegate.updates) {
        const item = index.items[String(update.id)];
        if (!item || item.assetSource?.frozen) continue;
        item.assetSource = update.assetSource;
        item.iconUrl = update.assetSource.sourceUrl;
        item.imageSource = update.assetSource.source;
        item.assetPath = update.assetSource.targetPath;
        item.localIcon = update.assetSource.localIcon;
        clearAvatarPendingMarker(item);
      }

      const pending = dandegate.failures.filter((failure) => (
        (failure.kind ?? classifyDandegateFailure(failure)) === "source_pending"
      ));
      const dandegateHardFailures = dandegate.failures.filter((failure) => !pending.includes(failure));
      report.failures.push(...dandegateHardFailures);
      const markedAt = new Date().toISOString();
      for (const failure of pending) {
        const item = index.items[String(failure.id)];
        if (canMarkAvatarPending(item)) {
          markAvatarPending(item, failure, markedAt);
          report.avatarPending.push({
            id: failure.id,
            code: failure.code,
            reason: failure.reason,
            pageUrl: failure.pageUrl,
            fallbackUrl: item.iconUrl,
          });
        } else {
          report.pending.push(failure);
        }
      }
      report.counts.avatarPending = report.avatarPending.length;
      if (report.avatarPending.length) {
        console.log(`Doll avatars temporarily using remote fallbacks: ${report.avatarPending.map((failure) => failure.code).join(", ")}`);
      }
    }

    const pendingIds = new Set(report.pending.map((failure) => String(failure.id)));
    const avatarPendingIds = new Set(report.avatarPending.map((failure) => String(failure.id)));
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
      if (avatarPendingIds.has(String(item.id))) continue;
      if (pendingIds.has(String(item.id)) && (!dest || !await fileExists(dest))) continue;
      const sourceUrl = item.assetSource?.sourceUrl ?? asset?.sourceUrl ?? item.iconUrl ?? buildFallbackUrl(item);
      if (!dest || !sourceUrl) continue;
      const shouldForce = args.force || (args.forceDolls && item.type === "doll");
      if (!shouldForce && await fileExists(dest)) continue;
      targets.push({ item, dest, sourceUrl });
    }

    if (frozenMissing.length) {
      report.failures.push(...frozenMissing.map((item) => ({
        ...item,
        kind: "hard_failure",
        reason: "frozen_asset_missing",
      })));
    }

    report.counts.targets = targets.length;
    console.log(`Found ${targets.length} images to download into ${args.outDir}`);
    if (args.dryRun) {
      for (const t of targets.slice(0, 20)) console.log(`  ${t.sourceUrl} -> ${t.dest}`);
      console.log(`  ... (${targets.length} total)`);
      report.status = "dry_run";
      await writeJsonAtomic(args.reportOut, report);
      return;
    }

    let cursor = 0;
    let ok = 0;
    const failures = [];
    async function worker() {
      for (;;) {
        const idx = cursor;
        cursor += 1;
        if (idx >= targets.length) return;
        const { item, dest, sourceUrl } = targets[idx];
        try {
          const result = await downloadWithRetry(sourceUrl, dest, args.timeoutMs, args.retries, item, args.proxyUrl);
          ok += 1;
          if (ok % 20 === 0 || idx < 3) console.log(`  [${ok}/${targets.length}] ${path.basename(dest)} (${result.size} bytes)`);
        } catch (error) {
          failures.push({
            id: item.id,
            name: item.name,
            url: sourceUrl,
            attempts: error?.attempts ?? Math.max(1, args.retries + 1),
            kind: classifyDownloadFailure(error),
            error: String(error.message ?? error),
          });
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(args.concurrency, targets.length) }, () => worker()));
    console.log(`Done: ${ok} downloaded, ${failures.length} failed`);
    if (failures.length) {
      console.log("Failures:");
      for (const failure of failures.slice(0, 20)) console.log(`  id=${failure.id} ${failure.name ?? ""} ${failure.url} : ${failure.error}`);
      if (failures.length > 20) console.log(`  ... (${failures.length} total)`);
    }
    report.pending.push(...failures.filter((failure) => failure.kind === "source_pending"));
    report.failures.push(...failures.filter((failure) => failure.kind !== "source_pending"));
    report.counts.downloaded = ok;
    report.counts.pending = report.pending.length;
    report.counts.failed = report.failures.length;
    report.stages.download = {
      status: failures.length ? "degraded" : "success",
      targets: targets.length,
      downloaded: ok,
      pending: failures.filter((failure) => failure.kind === "source_pending").length,
      failed: failures.filter((failure) => failure.kind !== "source_pending").length,
    };

    const updated = { ...index };
    for (const item of Object.values(updated.items ?? {})) {
      if (isAvatarPendingItem(item)) {
        delete item.localIcon;
        continue;
      }
      const asset = buildAssetDescriptor(item.type, item.code);
      const pub = localPublicPath(item);
      const dest = localPathForItem(item, args.outDir);
      if (pub && dest && await fileExists(dest)) {
        item.localIcon = pub;
        if (asset) {
          item.assetPath = asset.targetPath;
          if (!item.assetSource) item.assetSource = asset;
        }
      } else delete item.localIcon;
    }
    const outIndexPath = path.join(args.outDir, "resource-index.json");
    await writeJsonAtomic(outIndexPath, updated);
    console.log(`Wrote updated index with localIcon fields to ${outIndexPath}`);

    if (report.failures.length) report.status = "hard_failure";
    else if (report.pending.length) report.status = "source_pending";
    else if (report.avatarPending.length) report.status = "avatar_pending";
    else report.status = "success";
    await writeJsonAtomic(args.reportOut, report);
    if (report.status === "hard_failure") process.exitCode = 1;
    else if (report.status === "source_pending") process.exitCode = PENDING_EXIT_CODE;
  } catch (error) {
    if (report.status === "running") {
      report.status = "hard_failure";
      report.error = String(error.message ?? error);
    }
    await writeJsonAtomic(args.reportOut, report).catch(() => {});
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

async function writeJsonAtomic(file, value) {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeBufferAtomic(file, buffer) {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(temporary, buffer);
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function validateImageBuffer(buffer, item) {
  const metadata = await sharp(buffer, { failOn: "error" }).metadata();
  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new Error("Downloaded image has no valid dimensions or format");
  }
  if (item.type === "doll" && (metadata.width !== 128 || metadata.height !== 128)) {
    throw new Error(`Converted doll image has unexpected dimensions ${metadata.width}x${metadata.height}`);
  }
  return metadata;
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
