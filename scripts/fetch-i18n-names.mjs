#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { extractWikiruNameRecord, isWikiruUnavailablePage, parseWikiruCharacterDetailLinks } from "./wikiru-names.mjs";
import { fetchWithRetry } from "./fetch-with-retry.mjs";
import { parseGfl2BannersHtml, parseGfl2CharacterNames, parseGfl2WeaponNames } from "./gfl2-banners.mjs";
import { parseBbsCategoryResponse, parseBbsHandbookResponse } from "./exilium-bbs.mjs";
import { mergeAuthoritativeNames, preserveExistingNameFields } from "./authoritative-names.mjs";
import { parseMccNameFromHtml } from "./mcc-wiki.mjs";

const MCC_ORIGIN = "https://gf2.mcc.wiki";
const GFL2_HELP_ORIGIN = "https://gfl2.help";
const WIKIRU_ORIGIN = "https://dollsfrontline2.wikiru.jp";
const BBS_API_ORIGIN = "https://gf2-bbs-api.exiliumgf.com";

const DEFAULT_INDEX = "public/images/resource-index.json";
const DEFAULT_EXISTING_I18N = "src/i18n.json";
const DEFAULT_OUT = "src/i18n-names.json";
const DEFAULT_SOURCES_OUT = "src/i18n-name-sources.json";
const DEFAULT_REPORT_OUT = "output/name-update-report.json";

const WIKIRU_CHARACTER_PAGE = WIKIRU_ORIGIN + "/?%E3%82%AD%E3%83%A3%E3%83%A9%E3%82%AF%E3%82%BF%E3%83%BC%E4%B8%80%E8%A6%A7%28%E3%83%95%E3%82%A3%E3%83%AB%E3%82%BF%E3%83%86%E3%83%BC%E3%83%96%E3%83%AB%E7%89%88%29";
const WIKIRU_WEAPON_PAGE = WIKIRU_ORIGIN + "/?cmd=read&page=%E6%AD%A6%E5%99%A8%E4%B8%80%E8%A6%A7";

const MANUAL_EN_OVERRIDES = {
  Clukay: "Klukai",
  Dusevnyj: "Dushevnaya",
  Lene: "Lainie",
  Macqiato: "Macchiato",
  Mishty: "Mechty",
  Mosinnagant: "Mosin-Nagant",
  OTs14: "OTs-14",
  NemesisGnosis: "Nemesis Gnosis",
  YooHee: "Yoohee",
};

const WIKIRU_RECOVERY_HINTS = {
  BastiSSR: "バスティ",
  CheyanneSSR: "シャイアン",
  DusevnyjSSR: "ドゥシェーヴヌイ",
  KseniaSR: "クシーニヤ",
  LittaraSR: "リッタラ",
  NemesisGnosisSSR: "ネメシス・グノーシス",
  OTs14SSR: "OTs-14",
  PapashaSSR: "ペーペーシャ",
  PeriSSR: "ペリー",
  VectorSSR: "ヴェクター",
  AsteriaSSR: "アステリア",
};

const WIKIRU_WEAPON_RECOVERY_HINTS = {
  Weapon_HK416_4: "HK416",
  Weapon_MK23_3: "MK23",
  Weapon_MK23_4: "MK23",
  Weapon_MK23_5: "MK23",
};

function parseArgs(argv) {
  const args = {
    index: DEFAULT_INDEX,
    existingI18n: DEFAULT_EXISTING_I18N,
    existingSources: DEFAULT_SOURCES_OUT,
    out: DEFAULT_OUT,
    sourcesOut: DEFAULT_SOURCES_OUT,
    reportOut: DEFAULT_REPORT_OUT,
    mode: "normal",
    concurrency: 8,
    timeoutMs: 15000,
    retries: 2,
    proxyUrl: undefined,
    sources: new Set(["mcc", "gfl2help", "wikiru"]),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--index") args.index = argv[++i];
    else if (value === "--existing-i18n") args.existingI18n = argv[++i];
    else if (value === "--existing-sources") args.existingSources = argv[++i];
    else if (value === "--out") args.out = argv[++i];
    else if (value === "--sources-out") args.sourcesOut = argv[++i];
    else if (value === "--report-out") args.reportOut = argv[++i];
    else if (value === "--mode") args.mode = argv[++i] === "bootstrap" ? "bootstrap" : "normal";
    else if (value === "--concurrency") args.concurrency = Math.max(1, Number(argv[++i]) || 8);
    else if (value === "--timeout-ms") args.timeoutMs = Math.max(1000, Number(argv[++i]) || 15000);
    else if (value === "--retries") args.retries = Math.max(0, Number(argv[++i]) || 2);
    else if (value === "--proxy-url") args.proxyUrl = argv[++i];
    else if (value === "--sources") args.sources = new Set(String(argv[++i]).split(",").map((s) => s.trim()).filter(Boolean));
    else if (value === "--help" || value === "-h") {
      console.log("Usage: node scripts/fetch-i18n-names.mjs [options]");
      console.log("  --mode normal|bootstrap");
      console.log("  --sources mcc,gfl2help,wikiru,exilium-bbs");
      console.log("  --proxy-url http://127.0.0.1:7890");
      process.exit(0);
    }
  }
  return args;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]+>/g, " "));
}

function validName(value) {
  if (typeof value !== "string") return undefined;
  const name = decodeHtml(value).replace(/\s+/g, " ").trim();
  return name && !/^\d+$/.test(name) ? name : undefined;
}

function normalizeName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cleanDollCode(code) {
  return String(code ?? "").replace(/(?:SSR|SR)$/i, "");
}

function cleanWeaponCode(code) {
  return String(code ?? "").replace(/^Weapon_/, "").replace(/_[345]$/, "");
}

function enFallback(item) {
  if (item.type === "doll") {
    const base = cleanDollCode(item.code);
    return MANUAL_EN_OVERRIDES[base] ?? base;
  }
  if (item.type === "weapon") {
    const base = cleanWeaponCode(item.code);
    return item.rarity === 3 ? "Retired " + base : base;
  }
  return undefined;
}

function candidateKeys(item, entry) {
  return [
    entry?.en,
    entry?.cn,
    item.en,
    item.cn,
    enFallback(item),
    item.type === "doll" ? cleanDollCode(item.code) : cleanWeaponCode(item.code),
  ].map(normalizeName).filter(Boolean);
}

function matchesName(item, entry, value) {
  const normalized = normalizeName(value);
  return normalized && candidateKeys(item, entry).includes(normalized);
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function fetchText(url, args) {
  const response = await fetchWithRetry(url, {
    proxyUrl: args.proxyUrl,
    attempts: args.retries + 1,
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
    signalFactory: () => AbortSignal.timeout(args.timeoutMs),
  });
  if (!response.ok) throw new Error("GET " + url + " failed: HTTP " + response.status);
  const text = await response.text();
  if (isWikiruUnavailablePage(text)) {
    throw new Error("source returned an unavailable or challenge page");
  }
  return text;
}

async function fetchJson(url, body, args) {
  const response = await fetchWithRetry(url, {
    proxyUrl: args.proxyUrl,
    attempts: args.retries + 1,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "yoohee-tracker-resource-updater/1.0",
    },
    body: JSON.stringify(body),
    signalFactory: () => AbortSignal.timeout(args.timeoutMs),
  });
  if (!response.ok) throw new Error("POST " + url + " failed: HTTP " + response.status);
  return response.json();
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  }));
}

function visibleWikiruNames(html) {
  const names = new Set();
  for (const match of String(html ?? "").matchAll(/<(?:a|td)\b[^>]*>([\s\S]*?)<\/(?:a|td)>/gi)) {
    const name = validName(stripTags(match[1]));
    if (name && name.length <= 48) names.add(name);
  }
  return names;
}

function addCandidate(map, id, value, source, url) {
  const clean = validName(value);
  if (!clean || map.has(String(id))) return;
  map.set(String(id), { value: clean, source, url });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const index = JSON.parse(await fs.readFile(args.index, "utf8"));
  const existingI18n = await readJsonIfExists(args.existingI18n);
  const existingSources = await readJsonIfExists(args.existingSources);
  const existingNames = isObject(existingI18n?.names) ? existingI18n.names : {};
  const items = Object.values(index.items ?? {}).filter((item) => item?.id && item?.code && item?.type);
  const entries = {};
  for (const item of items) {
    const id = String(item.id);
    const old = existingNames[id] ?? {};
    const fallbackEn = validName(enFallback(item));
    const oldEn = validName(old.en);
    const canonicalEn = oldEn && (!fallbackEn || normalizeName(oldEn) !== normalizeName(fallbackEn))
      ? oldEn
      : fallbackEn ?? validName(item.en);
    entries[id] = preserveExistingNameFields({
      code: item.code,
      type: item.type,
      cn: validName(old.cn) ?? validName(item.cn),
      en: canonicalEn,
      jp: validName(old.jp) ?? validName(item.jp),
    }, old, existingSources?.[id]);
  }

  const candidates = { cn: new Map(), en: new Map(), jp: new Map() };
  const failures = [];

  if (args.sources.has("mcc")) {
    await runPool(items, args.concurrency, async (item, itemIndex) => {
      const url = MCC_ORIGIN + "/" + item.type + "/" + encodeURIComponent(item.code);
      try {
        const html = await fetchText(url, args);
        addCandidate(candidates.cn, item.id, parseMccNameFromHtml(html, item.type), "mcc-wiki", url);
      } catch (error) {
        failures.push({ id: item.id, code: item.code, source: "mcc-wiki", error: String(error.message ?? error) });
      }
      if ((itemIndex + 1) % 30 === 0) console.log("  MCC progress: " + (itemIndex + 1) + "/" + items.length);
    });
  }

  if (args.sources.has("gfl2help")) {
    const bannersUrl = GFL2_HELP_ORIGIN + "/en/banners";
    const charactersUrl = GFL2_HELP_ORIGIN + "/en/characters";
    const weaponsUrl = GFL2_HELP_ORIGIN + "/en/weapons";
    try {
      const bannerNames = parseGfl2BannersHtml(await fetchText(bannersUrl, args), bannersUrl)
        .flatMap((banner) => banner.characterNames);
      for (const item of items.filter((candidate) => candidate.type === "doll")) {
        const entry = entries[String(item.id)];
        const match = bannerNames.find((name) => matchesName(item, entry, name));
        if (match) addCandidate(candidates.en, item.id, match, "gfl2.help", bannersUrl);
      }
    } catch (error) {
      failures.push({ source: "gfl2.help:banners", error: String(error.message ?? error) });
    }
    try {
      const characterNames = parseGfl2CharacterNames(await fetchText(charactersUrl, args), charactersUrl);
      for (const item of items.filter((candidate) => candidate.type === "doll")) {
        if (candidates.en.has(String(item.id))) continue;
        const entry = entries[String(item.id)];
        const match = characterNames.find((candidate) => matchesName(item, entry, candidate.name));
        if (match) addCandidate(candidates.en, item.id, match.name, "gfl2.help-characters", charactersUrl);
      }
    } catch (error) {
      failures.push({ source: "gfl2.help:characters", error: String(error.message ?? error) });
    }
    try {
      const weaponNames = parseGfl2WeaponNames(await fetchText(weaponsUrl, args), weaponsUrl);
      for (const item of items.filter((candidate) => candidate.type === "weapon")) {
        const entry = entries[String(item.id)];
        const match = weaponNames.find((candidate) => matchesName(item, entry, candidate.name));
        if (match) addCandidate(candidates.en, item.id, match.name, "gfl2.help-weapons", weaponsUrl);
      }
    } catch (error) {
      failures.push({ source: "gfl2.help:weapons", error: String(error.message ?? error) });
    }
  }

  if (args.sources.has("wikiru")) {
    if (args.mode === "bootstrap") {
      for (const item of items.filter((candidate) => candidate.type === "doll")) {
        const recoveryName = WIKIRU_RECOVERY_HINTS[item.code];
        if (recoveryName) {
          addCandidate(candidates.jp, item.id, recoveryName, "wikiru-recovery", WIKIRU_ORIGIN + "/?" + encodeURIComponent(recoveryName));
        }
      }
    }
    try {
      const indexHtml = await fetchText(WIKIRU_CHARACTER_PAGE, args);
      const detailLinks = parseWikiruCharacterDetailLinks(indexHtml, WIKIRU_ORIGIN + "/");
      if (!detailLinks.length) throw new Error("Wikiru character list contained no detail links");
      await runPool(detailLinks, 1, async ({ url }) => {
        try {
          const detail = extractWikiruNameRecord(await fetchText(url, args));
          if (!detail) return;
          const matches = items.filter((item) => item.type === "doll" && matchesName(item, entries[String(item.id)], detail.en ?? detail.cn));
          if (matches.length === 1) addCandidate(candidates.jp, matches[0].id, detail.jp, "wikiru-detail", url);
        } catch (error) {
          failures.push({ source: "wikiru:doll-detail", url, error: String(error.message ?? error) });
        }
      });
      console.log("  wikiru doll details: " + detailLinks.length + " linked");
    } catch (error) {
      console.log("  wikiru doll list unavailable; trying direct detail pages");
    }

    const directTargets = items
      .filter((item) => item.type === "doll" && !candidates.jp.has(String(item.id)))
      .map((item) => {
        const entry = entries[String(item.id)];
        const pageName = entry.jp || WIKIRU_RECOVERY_HINTS[item.code];
        return pageName ? { item, pageName } : undefined;
      })
      .filter(Boolean);
    await runPool(directTargets, 1, async ({ item, pageName }) => {
      const url = WIKIRU_ORIGIN + "/?" + encodeURIComponent(pageName);
      try {
        const detail = extractWikiruNameRecord(await fetchText(url, args));
        if (detail?.jp) addCandidate(candidates.jp, item.id, detail.jp, "wikiru-detail", url);
      } catch (error) {
        failures.push({ source: "wikiru:doll-direct", id: item.id, code: item.code, url, error: String(error.message ?? error) });
      }
    });
    console.log("  wikiru direct details: " + directTargets.length + " attempted");

    try {
      const weaponHtml = await fetchText(WIKIRU_WEAPON_PAGE, args);
      const visibleNames = visibleWikiruNames(weaponHtml);
      for (const item of items.filter((candidate) => candidate.type === "weapon")) {
        const current = entries[String(item.id)]?.jp ?? item.jp;
        const currentMatch = current && visibleNames.has(current) ? current : undefined;
        const asciiKeys = [item.en, enFallback(item), cleanWeaponCode(item.code)]
          .map(normalizeName)
          .filter(Boolean);
        const asciiMatch = [...visibleNames].find((name) => asciiKeys.includes(normalizeName(name)));
        const match = currentMatch ?? asciiMatch;
        if (match) addCandidate(candidates.jp, item.id, match, "wikiru", WIKIRU_WEAPON_PAGE);
      }
    } catch (error) {
      failures.push({ source: "wikiru:weapon-index", error: String(error.message ?? error) });
    }

    if (args.mode === "bootstrap") {
      for (const item of items.filter((candidate) => candidate.type === "weapon")) {
        if (candidates.jp.has(String(item.id))) continue;
        const existing = entries[String(item.id)]?.jp;
        const recovery = existing ?? WIKIRU_WEAPON_RECOVERY_HINTS[item.code];
        if (recovery) {
          addCandidate(
            candidates.jp,
            item.id,
            recovery,
            "wikiru-recovery",
            WIKIRU_ORIGIN + "/?" + encodeURIComponent(recovery),
          );
        }
      }
    }
  }

  if (args.mode === "bootstrap" && args.sources.has("exilium-bbs")) {
    try {
      const categoryUrl = BBS_API_ORIGIN + "/wiki/category";
      const category = parseBbsCategoryResponse(await fetchJson(categoryUrl, {}, args));
      if (!category) throw new Error("missing handbook category IDs");
      const [dolls, weapons] = await Promise.all([
        fetchJson(BBS_API_ORIGIN + "/wiki/handbook", { type: category.dollCategoryId, limit: 1000 }, args),
        fetchJson(BBS_API_ORIGIN + "/wiki/handbook", { type: category.weaponCategoryId, limit: 1000 }, args),
      ]);
      for (const row of parseBbsHandbookResponse(dolls, "doll", categoryUrl).concat(parseBbsHandbookResponse(weapons, "weapon", categoryUrl))) {
        if (!candidates.cn.has(String(row.id))) {
          addCandidate(candidates.cn, row.id, row.cn, "exilium-bbs-bootstrap", row.sourceUrl);
        }
      }
    } catch (error) {
      failures.push({ source: "exilium-bbs-bootstrap", error: String(error.message ?? error) });
    }
  }

  const merged = mergeAuthoritativeNames(entries, candidates, { mode: args.mode, failures });
  for (const [id, fields] of Object.entries(existingSources ?? {})) {
    for (const [field, source] of Object.entries(fields ?? {})) {
      if (merged.sources[id]?.[field] || source?.value !== merged.names[id]?.[field]) continue;
      merged.sources[id] = merged.sources[id] ?? {};
      merged.sources[id][field] = source;
    }
  }
  for (const [id, aliases] of Object.entries(merged.aliases)) {
    merged.names[id].aliases = aliases;
  }

  const sortedNames = {};
  const sortedSources = {};
  for (const id of Object.keys(merged.names).sort((a, b) => Number(a) - Number(b))) {
    sortedNames[id] = Object.fromEntries(Object.entries(merged.names[id]).filter(([, value]) => value !== undefined));
    if (merged.sources[id]) sortedSources[id] = merged.sources[id];
  }

  const report = {
    mode: args.mode,
    counts: {
      items: items.length,
      added: merged.changes.added,
      overwritten: merged.changes.overwritten,
      ignored: merged.changes.ignored,
      missing: merged.missing.length,
      failures: merged.failures.length,
    },
    missing: merged.missing,
    failures: merged.failures,
  };
  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.mkdir(path.dirname(args.sourcesOut), { recursive: true });
  await fs.mkdir(path.dirname(args.reportOut), { recursive: true });
  await fs.writeFile(args.out, JSON.stringify(sortedNames, null, 2) + "\n", "utf8");
  await fs.writeFile(args.sourcesOut, JSON.stringify(sortedSources, null, 2) + "\n", "utf8");
  await fs.writeFile(args.reportOut, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log("Wrote " + Object.keys(sortedNames).length + " authoritative name entries to " + args.out);
  console.log("Name changes: added=" + report.counts.added + ", overwritten=" + report.counts.overwritten + ", missing=" + report.counts.missing + ", failures=" + report.counts.failures);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
