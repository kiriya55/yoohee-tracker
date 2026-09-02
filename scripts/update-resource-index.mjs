#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fetchWithRetry } from "./fetch-with-retry.mjs";
import { findResourceCatalogChanges } from "./resource-catalog.mjs";
import { computeTimesetHash, mergeServerResourceIndexes, normalizeTimesets } from "./timeset.mjs";
import { fetchCompleteCatalog } from "./catalog-sources.mjs";
import { buildGfl2Timesets, parseGfl2BannersHtml } from "./gfl2-banners.mjs";
import { mergeIndex as stableMergeIndex, combinedIndexChanged } from "./resource-index-stability.mjs";

const EXILIUM_ORIGIN = "https://exilium.xyz";

function parseArgs(argv) {
  const args = {
    servers: ["dw-cn", "haoplay"],
    outDir: ".",
    existing: undefined,
    probeImages: false,
    probeConcurrency: 16,
    probeTimeoutMs: 10000,
    checkOnly: false,
    checkTimesets: false,
    proxyUrl: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--server" || arg === "--servers") args.servers = argv[++index].split(",").map((value) => value.trim()).filter(Boolean);
    else if (arg === "--out-dir") args.outDir = argv[++index];
    else if (arg === "--existing") args.existing = argv[++index];
    else if (arg === "--probe-images") args.probeImages = true;
    else if (arg === "--probe-concurrency") args.probeConcurrency = Math.max(1, Number(argv[++index]) || 16);
    else if (arg === "--probe-timeout-ms") args.probeTimeoutMs = Math.max(1000, Number(argv[++index]) || 10000);
    else if (arg === "--check-only") args.checkOnly = true;
    else if (arg === "--check-timesets") args.checkTimesets = true;
    else if (arg === "--proxy-url") args.proxyUrl = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/update-resource-index.mjs [options]

Options:
  --server, --servers <list>   Comma-separated exilium server codes. Default: dw-cn,haoplay
  --out-dir <dir>              Output directory. Default: current directory
  --existing <file>            Existing gf2-resource-index JSON to merge
  --probe-images               HEAD-check generated MCC image URLs
  --probe-concurrency <n>      Parallel image probes. Default: 16
  --probe-timeout-ms <ms>      Per-image probe timeout. Default: 10000
  --check-only                 Compare the current resource catalog with --existing.
                               Exits 0 if resources or timesets changed, 1 if unchanged. Requires --existing.
  --check-timesets              Include the deterministic event timeset hash in the check report.

Examples:
  node scripts/update-resource-index.mjs --server haoplay --out-dir examples
  node scripts/update-resource-index.mjs --servers haoplay,haoplay-jp,darkwinter --probe-images
  node scripts/update-resource-index.mjs --existing public/images/resource-index.json --check-only
`);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function stripHtml(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractSection(text, startLabel) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes(startLabel));
  if (start < 0) return "";
  const section = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (/^-\s+[^-\n]+-\s*$/.test(line)) break;
    if (/^(Rate Up Event|Limited-Time Rate Up Event)\b/i.test(line)) break;
    section.push(line);
  }
  return section.join("\n");
}

function extractBracketNames(section) {
  return unique([...section.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]));
}

function extractSignals(server, payload) {
  const newDolls = [];
  const newWeapons = [];
  const rateUpNames = [];
  const sourceNoticeIds = [];

  for (const notice of payload.notice ?? []) {
    if (typeof notice.id === "number") sourceNoticeIds.push(notice.id);
    const content = stripHtml(notice.content);
    newDolls.push(...extractBracketNames(extractSection(content, "- New Doll -")));
    newWeapons.push(...extractBracketNames(extractSection(content, "- New Weapons -")));
  }

  for (const banner of payload.banner ?? []) {
    if (typeof banner.id === "number") sourceNoticeIds.push(banner.id);
    const match = String(banner.name ?? "").match(/^(.+?)\s+Is\s+Rate\s+Up!?$/i);
    if (match?.[1]) rateUpNames.push(match[1].replace(/^\[|\]$/g, ""));
  }

  return {
    server,
    newDolls: unique(newDolls),
    newWeapons: unique(newWeapons),
    rateUpNames: unique(rateUpNames),
    sourceNoticeIds: [...new Set(sourceNoticeIds)],
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithRetry(url, options);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetchWithRetry(url, options);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  return response.text();
}

async function probeItems(items, options) {
  const probed = new Array(items.length);
  let cursor = 0;

  async function check(index) {
    const item = items[index];
    if (!item.iconUrl) {
      probed[index] = item;
      return;
    }
    try {
      const response = await fetchWithRetry(item.iconUrl, {
        method: "HEAD",
        proxyUrl: options.proxyUrl,
        attempts: 4,
        signalFactory: () => AbortSignal.timeout(options.timeoutMs),
      });
      if (response.ok) {
        probed[index] = item;
      } else if (response.status === 404 || response.status === 410) {
        probed[index] = { ...item, iconUrl: undefined, imageSource: undefined, verifiedAt: undefined };
      } else {
        console.warn(`Image probe temporarily unavailable for ${item.iconUrl}: HTTP ${response.status}; preserving the existing source.`);
        probed[index] = item;
      }
    } catch (error) {
      console.warn(`Image probe failed for ${item.iconUrl}; preserving the existing source: ${String(error.message ?? error)}`);
      probed[index] = item;
    }
  }

  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await check(index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(options.concurrency, items.length) }, () => worker()));
  return probed;
}

// mergeIndex (timestamp-stable catalog merge) and combinedIndexChanged live in
// resource-index-stability.mjs so they can be unit-tested without network I/O.

async function readExisting(file) {
  if (!file) return undefined;
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const existing = await readExisting(args.existing);
  const completeCatalog = await fetchCompleteCatalog({
    proxyUrl: args.proxyUrl,
    existingItems: existing?.items ?? {},
  });
  if (completeCatalog.conflicts.length || completeCatalog.missing.length) {
    throw new Error("Complete catalog could not be joined: " + JSON.stringify({
      conflicts: completeCatalog.conflicts,
      missing: completeCatalog.missing,
    }));
  }
  const catalogItems = Object.values(completeCatalog.items);
  let gfl2Cards = [];
  try {
    const bannersUrl = "https://gfl2.help/en/banners";
    gfl2Cards = parseGfl2BannersHtml(await fetchText(bannersUrl, { proxyUrl: args.proxyUrl }), bannersUrl);
  } catch (error) {
    console.warn("gfl2.help banner warning: " + String(error.message ?? error));
  }

  if (args.checkOnly) {
    if (!existing || !existing.items) {
      console.error("Error: --check-only requires a valid --existing resource index.");
      process.exit(2);
    }
    const incomingIndexes = [];
    for (const server of args.servers) {
      const events = await fetchJson(`${EXILIUM_ORIGIN}/api/event?server=${encodeURIComponent(server)}`, { proxyUrl: args.proxyUrl });
      incomingIndexes.push({
        servers: [server],
        items: Object.fromEntries(catalogItems.map((item) => [String(item.id), { ...item, server, verifiedAt: generatedAt }])),
        timesets: normalizeTimesets(server, events).concat(buildGfl2Timesets(gfl2Cards, catalogItems, server)),
      });
    }
    const incoming = mergeServerResourceIndexes(incomingIndexes);
    const changes = findResourceCatalogChanges(existing.items, Object.values(incoming.items));
    const existingTimesetHash = computeTimesetHash(existing.timesets);
    const incomingTimesetHash = computeTimesetHash(incoming.timesets);
    const timesetChanged = args.checkTimesets && existingTimesetHash !== incomingTimesetHash;
    console.log(`Catalog check: ${changes.added.length} added, ${changes.changed.length} changed.`);
    if (changes.added.length) console.log(`  added: ${changes.added.join(", ")}`);
    if (changes.changed.length) console.log(`  changed: ${changes.changed.join(", ")}`);
    if (args.checkTimesets) {
      console.log(`Timeset check: ${existingTimesetHash} -> ${incomingTimesetHash}${timesetChanged ? " (changed)" : " (unchanged)"}`);
    } else {
      console.log("Timeset check: skipped (pass --check-timesets to include event schedules).");
    }

    if (changes.hasChanges || timesetChanged) {
      console.log("Status check: Resource catalog or timeset changed. Exiting with 0.");
      process.exit(0);
    }
    console.log("Status check: Resource catalog and timeset unchanged. Exiting with 1.");
    process.exit(1);
  }

  await fs.mkdir(args.outDir, { recursive: true });
  const serverIndexes = [];
  for (const server of args.servers) {
    const events = await fetchJson(`${EXILIUM_ORIGIN}/api/event?server=${encodeURIComponent(server)}`, { proxyUrl: args.proxyUrl });
    const signals = extractSignals(server, events);
    let updatedItems = catalogItems.map((item) => ({ ...item, server, verifiedAt: generatedAt }));
    if (args.probeImages) updatedItems = await probeItems(updatedItems, {
      concurrency: args.probeConcurrency,
      timeoutMs: args.probeTimeoutMs,
      proxyUrl: args.proxyUrl,
    });
    const timesets = normalizeTimesets(server, events).concat(buildGfl2Timesets(gfl2Cards, catalogItems, server));
    const { index } = stableMergeIndex(existing, updatedItems, {
      generatedAt,
      servers: [server],
      updateSignals: { [server]: signals },
      timesets,
      timesetHash: computeTimesetHash(timesets),
    });
    serverIndexes.push(index);
    const outPath = path.join(args.outDir, `gf2-resource-index.${server}.json`);
    await fs.writeFile(outPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    console.log(`${server}: wrote ${Object.keys(index.items).length} items to ${outPath}`);
    console.log(`  resource updates: ${updatedItems.length}`);
    console.log(`  new dolls: ${signals.newDolls.join(", ") || "(none)"}`);
    console.log(`  rate ups: ${signals.rateUpNames.join(", ") || "(none)"}`);
  }

  const combined = mergeServerResourceIndexes(serverIndexes);
  combined.timesetHash = computeTimesetHash(combined.timesets);
  // Keep the catalog's generation time stable across routine syncs: only stamp
  // it with this run's time when the catalog, event timesets, or update signals
  // for the synced servers actually differ from the previous index.
  const combinedChanged = combinedIndexChanged(existing, combined, args.servers);
  combined.generatedAt = combinedChanged ? generatedAt : existing?.generatedAt ?? generatedAt;
  const combinedPath = path.join(args.outDir, `gf2-resource-index.${args.servers[0] ?? "haoplay"}.json`);
  await fs.writeFile(combinedPath, `${JSON.stringify(combined, null, 2)}\n`, "utf8");
  console.log(`combined: wrote ${Object.keys(combined.items).length} items for ${combined.servers.join(", ")} to ${combinedPath}`);
  console.log(combinedChanged
    ? `combined: catalog/timeset/signals changed -> generatedAt ${combined.generatedAt}`
    : "combined: no catalog/timeset/signals change -> kept previous generatedAt");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
