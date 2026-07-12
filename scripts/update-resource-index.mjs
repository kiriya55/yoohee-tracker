#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fetchWithRetry } from "./fetch-with-retry.mjs";
import { buildMccImageUrl, findResourceCatalogChanges, selectResourceCatalogUpdates } from "./resource-catalog.mjs";

const EXILIUM_ORIGIN = "https://exilium.xyz";
const MCC_ORIGIN = "https://gf2.mcc.wiki";
const RESOURCE_MODULES = {
  dolls: 16845,
  weapons: 22822,
};

function parseArgs(argv) {
  const args = {
    servers: ["haoplay"],
    outDir: ".",
    existing: undefined,
    chunksDir: undefined,
    probeImages: false,
    probeConcurrency: 16,
    probeTimeoutMs: 10000,
    checkOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--server" || arg === "--servers") args.servers = argv[++index].split(",").map((value) => value.trim()).filter(Boolean);
    else if (arg === "--out-dir") args.outDir = argv[++index];
    else if (arg === "--existing") args.existing = argv[++index];
    else if (arg === "--chunks-dir") args.chunksDir = argv[++index];
    else if (arg === "--probe-images") args.probeImages = true;
    else if (arg === "--probe-concurrency") args.probeConcurrency = Math.max(1, Number(argv[++index]) || 16);
    else if (arg === "--probe-timeout-ms") args.probeTimeoutMs = Math.max(1000, Number(argv[++index]) || 10000);
    else if (arg === "--check-only") args.checkOnly = true;
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
  --server, --servers <list>   Comma-separated exilium server codes. Default: haoplay
  --out-dir <dir>              Output directory. Default: current directory
  --existing <file>            Existing gf2-resource-index JSON to merge
  --chunks-dir <dir>           Read already downloaded exilium chunks from a directory
  --probe-images               HEAD-check generated MCC image URLs
  --probe-concurrency <n>      Parallel image probes. Default: 16
  --probe-timeout-ms <ms>      Per-image probe timeout. Default: 10000
  --check-only                 Compare the current resource catalog with --existing.
                               Exits 0 if images changed, 1 if unchanged. Requires --existing.

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

function codeToName(code) {
  return code.replace(/S{1,2}R$/i, "").replace(/_5$|_4$|_3$|_2$/, "");
}

async function fetchJson(url) {
  const response = await fetchWithRetry(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetchWithRetry(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  return response.text();
}

async function loadChunkTexts(chunksDir) {
  if (chunksDir) {
    const entries = await fs.readdir(chunksDir, { withFileTypes: true });
    const chunks = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".js")) {
        chunks.push(await fs.readFile(path.join(chunksDir, entry.name), "utf8"));
      }
    }
    return chunks;
  }

  const home = await fetchText(EXILIUM_ORIGIN);
  const urls = unique([...home.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((match) => new URL(match[1], EXILIUM_ORIGIN).href));
  const chunks = [];
  for (const url of urls) {
    const text = await fetchText(url);
    if (text.includes("dolls/Avatar_Head_") || text.includes("weapons/") || text.includes("RESOURCE_MODULE_MARKER_NEVER")) {
      chunks.push(text);
    }
  }
  return chunks;
}

function captureWebpackModules(chunkTexts) {
  const modules = {};
  const context = {
    self: {
      webpackChunk_N_E: [],
    },
    console,
    setInterval: () => 0,
    clearInterval: () => undefined,
    window: {
      setInterval: () => 0,
      clearInterval: () => undefined,
    },
  };
  context.self.webpackChunk_N_E.push = (payload) => {
    Object.assign(modules, payload[1] ?? {});
  };

  for (const text of chunkTexts) {
    vm.runInNewContext(text, context, { timeout: 5000 });
  }
  return modules;
}

function executeWebpackModule(modules, id) {
  const fn = modules[id];
  if (typeof fn !== "function") return undefined;
  const exports = {};
  const module = { exports };
  const fakeRequire = (requestId) => {
    if (requestId === 99575) return { s: (value) => value };
    if (requestId === 49867) return { Y: (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-") };
    return {};
  };
  fakeRequire.d = (target, definitions) => {
    for (const [key, getter] of Object.entries(definitions)) {
      Object.defineProperty(target, key, { enumerable: true, get: getter });
    }
  };
  fn(module, exports, fakeRequire);
  return module.exports;
}

function normalizeDoll(raw, server, generatedAt) {
  const code = raw.avatar_name ?? raw.avatar;
  if (!raw.id || !code) return undefined;
  const iconUrl = buildMccImageUrl("doll", code);
  const rawName = raw.name ? String(raw.name) : undefined;
  return {
    id: Number(raw.id),
    name: rawName && !/^\d+$/.test(rawName) ? rawName : codeToName(code),
    type: "doll",
    rarity: Number.isFinite(Number(raw.rarity)) ? Number(raw.rarity) : undefined,
    code,
    server,
    iconUrl,
    imageSource: "mcc-wiki",
    verifiedAt: generatedAt,
  };
}

function normalizeWeapon(raw, server, generatedAt) {
  const code = raw.imageCode;
  if (!raw.id || !code) return undefined;
  const iconUrl = buildMccImageUrl("weapon", code);
  const rawName = raw.name ? String(raw.name) : undefined;
  return {
    id: Number(raw.id),
    name: rawName && !/^\d+$/.test(rawName) ? rawName : codeToName(code),
    type: "weapon",
    rarity: Number.isFinite(Number(raw.rarity)) ? Number(raw.rarity) : undefined,
    code,
    server,
    iconUrl,
    imageSource: "mcc-wiki",
    verifiedAt: generatedAt,
  };
}

function extractResourcesFromChunks(chunkTexts, server, generatedAt) {
  const modules = captureWebpackModules(chunkTexts);
  const dollExports = executeWebpackModule(modules, RESOURCE_MODULES.dolls);
  const weaponExports = executeWebpackModule(modules, RESOURCE_MODULES.weapons);
  const dolls = Array.isArray(dollExports?.n3) ? dollExports.n3 : [];
  const weapons = Array.isArray(weaponExports?.g) ? weaponExports.g : [];

  return [
    ...dolls.map((item) => normalizeDoll(item, server, generatedAt)).filter(Boolean),
    ...weapons.map((item) => normalizeWeapon(item, server, generatedAt)).filter(Boolean),
  ];
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
      const response = await fetch(item.iconUrl, { method: "HEAD", signal: AbortSignal.timeout(options.timeoutMs) });
      probed[index] = response.ok ? item : { ...item, iconUrl: undefined, imageSource: undefined, verifiedAt: undefined };
    } catch {
      probed[index] = { ...item, iconUrl: undefined, imageSource: undefined, verifiedAt: undefined };
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

function mergeIndex(existing, incomingItems, metadata) {
  const items = { ...(existing?.items ?? {}) };
  for (const incoming of incomingItems) {
    const current = items[String(incoming.id)];
    items[String(incoming.id)] = current
      ? {
          ...current,
          ...incoming,
          name: current.name || incoming.name,
          icon: current.icon || incoming.icon,
          iconUrl: current.iconUrl || incoming.iconUrl,
          aliases: unique([...(current.aliases ?? []), ...(incoming.aliases ?? [])]),
        }
      : incoming;
  }
  return {
    format: "gf2-resource-index",
    version: Math.max(existing?.version ?? 1, 1),
    source: "exilium-events-and-mcc-wiki",
    generatedAt: metadata.generatedAt,
    servers: metadata.servers,
    updateSignals: metadata.updateSignals,
    items,
    pools: existing?.pools,
  };
}

async function readExisting(file) {
  if (!file) return undefined;
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const existing = await readExisting(args.existing);
  const chunkTexts = await loadChunkTexts(args.chunksDir);
  if (!chunkTexts.length) throw new Error("No exilium chunks were loaded.");

  if (args.checkOnly) {
    if (!existing || !existing.items) {
      console.error("Error: --check-only requires a valid --existing resource index.");
      process.exit(2);
    }
    const server = args.servers[0] ?? "haoplay";
    const incomingItems = extractResourcesFromChunks(chunkTexts, server, generatedAt);
    const changes = findResourceCatalogChanges(existing.items, incomingItems);
    console.log(`Catalog check: ${changes.added.length} added, ${changes.changed.length} changed.`);
    if (changes.added.length) console.log(`  added: ${changes.added.join(", ")}`);
    if (changes.changed.length) console.log(`  changed: ${changes.changed.join(", ")}`);

    if (changes.hasChanges) {
      console.log("Status check: Resource catalog changed. Exiting with 0.");
      process.exit(0);
    }
    console.log("Status check: Resource catalog unchanged. Exiting with 1.");
    process.exit(1);
  }

  await fs.mkdir(args.outDir, { recursive: true });
  for (const server of args.servers) {
    const events = await fetchJson(`${EXILIUM_ORIGIN}/api/event?server=${encodeURIComponent(server)}`);
    const signals = extractSignals(server, events);
    const catalogItems = extractResourcesFromChunks(chunkTexts, server, generatedAt);
    let updatedItems = existing?.items
      ? selectResourceCatalogUpdates(existing.items, catalogItems)
      : catalogItems;
    if (args.probeImages) updatedItems = await probeItems(updatedItems, { concurrency: args.probeConcurrency, timeoutMs: args.probeTimeoutMs });
    const index = mergeIndex(existing, updatedItems, {
      generatedAt,
      servers: [server],
      updateSignals: { [server]: signals },
    });
    const outPath = path.join(args.outDir, `gf2-resource-index.${server}.json`);
    await fs.writeFile(outPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    console.log(`${server}: wrote ${Object.keys(index.items).length} items to ${outPath}`);
    console.log(`  resource updates: ${updatedItems.length}`);
    console.log(`  new dolls: ${signals.newDolls.join(", ") || "(none)"}`);
    console.log(`  rate ups: ${signals.rateUpNames.join(", ") || "(none)"}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
