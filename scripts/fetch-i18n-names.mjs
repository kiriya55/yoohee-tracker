#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const MCC_ORIGIN = "https://gf2.mcc.wiki";
const GFL2_HELP_ORIGIN = "https://gfl2.help";
const DANDEGATE_ORIGIN = "https://www.dandegate.net";
const WIKIRU_ORIGIN = "https://dollsfrontline2.wikiru.jp";

const DEFAULT_INDEX = "public/images/resource-index.json";
const DEFAULT_EXISTING_I18N = "src/i18n.json";
const DEFAULT_OUT = "src/i18n-names.json";

const WIKIRU_CHARACTER_PAGE = `${WIKIRU_ORIGIN}/?cmd=read&page=%E3%82%AD%E3%83%A3%E3%83%A9%E3%82%AF%E3%82%BF%E3%83%BC%E4%B8%80%E8%A6%A7`;
const WIKIRU_WEAPON_PAGE = `${WIKIRU_ORIGIN}/?cmd=read&page=%E6%AD%A6%E5%99%A8%E4%B8%80%E8%A6%A7`;

const MANUAL_EN_OVERRIDES = {
  Clukay: "Klukai",
  Dusevnyj: "Dushevnaya",
  Lene: "Lainie",
  Macqiato: "Macchiato",
  Mishty: "Mechty",
  Mosinnagant: "Mosin-Nagant",
  YooHee: "Yoohee",
};

const MANUAL_DANDEGATE_SLUGS = {
  Mosinnagant: "mosin-nagant",
};

function parseArgs(argv) {
  const args = {
    index: DEFAULT_INDEX,
    existingI18n: DEFAULT_EXISTING_I18N,
    out: DEFAULT_OUT,
    concurrency: 8,
    timeoutMs: 15000,
    retries: 2,
    sources: new Set(["mcc", "gfl2help", "dandegate", "wikiru"]),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--index") args.index = argv[++i];
    else if (a === "--existing-i18n") args.existingI18n = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--concurrency") args.concurrency = Math.max(1, Number(argv[++i]) || 8);
    else if (a === "--timeout-ms") args.timeoutMs = Math.max(1000, Number(argv[++i]) || 15000);
    else if (a === "--retries") args.retries = Math.max(0, Number(argv[++i]) || 2);
    else if (a === "--sources") args.sources = new Set(String(argv[++i]).split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/fetch-i18n-names.mjs [options]

Options:
  --index <file>          Resource index JSON. Default: ${DEFAULT_INDEX}
  --existing-i18n <file>  Existing app i18n JSON used as a safe seed. Default: ${DEFAULT_EXISTING_I18N}
  --out <file>            Output i18n names JSON. Default: ${DEFAULT_OUT}
  --sources <list>        Comma-separated sources: mcc,gfl2help,dandegate,wikiru
  --concurrency <n>       Parallel fetches. Default: 8
  --timeout-ms <ms>       Per-request timeout. Default: 15000
`);
      process.exit(0);
    }
  }
  return args;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validName(value) {
  if (typeof value !== "string") return undefined;
  const name = decodeHtml(value).replace(/\s+/g, " ").trim();
  if (!name || /^\d+$/.test(name)) return undefined;
  return name;
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function cleanDollCode(code) {
  return String(code ?? "").replace(/(?:SSR|SR)$/i, "");
}

function cleanWeaponCode(code) {
  return String(code ?? "").replace(/^Weapon_/, "").replace(/_[345]$/, "");
}

function enFallback(item) {
  if (item.type === "doll") return MANUAL_EN_OVERRIDES[cleanDollCode(item.code)] ?? cleanDollCode(item.code);
  if (item.type === "weapon") {
    const code = cleanWeaponCode(item.code);
    if (!code) return undefined;
    return item.rarity === 3 ? `Retired ${code}` : code;
  }
  return undefined;
}

function dandegateSlugFor(item) {
  const base = cleanDollCode(item.code);
  const name = MANUAL_EN_OVERRIDES[base] ?? base;
  if (MANUAL_DANDEGATE_SLUGS[base]) return MANUAL_DANDEGATE_SLUGS[base];
  return name
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function fetchText(url, timeoutMs, retries) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "yoohee-tracker-resource-updater/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt === retries) throw error;
    }
  }
  return "";
}

function extractMccNameFromTitle(title, type) {
  const text = decodeHtml(title);
  const prefixes = type === "doll" ? ["人形:", "Doll:"] : type === "weapon" ? ["武器:", "Weapon:"] : [];
  for (const prefix of prefixes) {
    if (text.startsWith(prefix)) return validName(text.slice(prefix.length).split("|")[0]);
  }
  return undefined;
}

function extractTitle(html) {
  return html.match(/<title>([^<]+)<\/title>/i)?.[1];
}

function extractDandegateName(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  return h1 ? validName(stripTags(h1).replace(/^#\s*/, "")) : undefined;
}

function extractVisibleNames(html) {
  const names = new Set();
  for (const match of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const name = validName(stripTags(match[1]));
    if (name && name.length <= 48) names.add(name);
  }
  for (const match of html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)) {
    const name = validName(stripTags(match[1]));
    if (name && name.length <= 48) names.add(name);
  }
  return names;
}

function normalizeName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function applySourceName(entry, field, name, source, changes) {
  const clean = validName(name);
  if (!clean) return false;
  if (entry[field] === clean) return false;
  if (entry[field] && entry[field] !== clean) {
    changes.conflicts.push({ id: entry.id, code: entry.code, field, existing: entry[field], incoming: clean, source });
    return false;
  }
  entry[field] = clean;
  changes.added += 1;
  return true;
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      await worker(items[idx], idx);
    }
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const index = JSON.parse(await fs.readFile(args.index, "utf8"));
  const existingI18n = await readJsonIfExists(args.existingI18n);
  const existingNames = isObject(existingI18n?.names) ? existingI18n.names : {};
  const items = Object.values(index.items ?? {}).filter((item) => item?.id && item?.code && item?.type);

  const entries = {};
  for (const item of items) {
    const id = String(item.id);
    const existing = existingNames[id] ?? {};
    entries[id] = {
      id,
      code: item.code,
      type: item.type,
      cn: validName(existing.cn) ?? validName(item.cn),
      en: validName(existing.en) ?? validName(item.en) ?? validName(enFallback(item)),
      jp: validName(existing.jp) ?? validName(item.jp),
    };
  }

  const changes = { added: 0, conflicts: [], failures: [] };

  if (args.sources.has("mcc")) {
    const targets = items.map((item) => ({ item, url: `${MCC_ORIGIN}/${item.type}/${encodeURIComponent(item.code)}` }));
    console.log(`Fetching Chinese names from MCC Wiki (${targets.length} pages)...`);
    await runPool(targets, args.concurrency, async ({ item, url }, idx) => {
      try {
        const html = await fetchText(url, args.timeoutMs, args.retries);
        const cn = extractMccNameFromTitle(extractTitle(html) ?? "", item.type);
        applySourceName(entries[String(item.id)], "cn", cn, "mcc-wiki", changes);
      } catch (error) {
        changes.failures.push({ id: item.id, code: item.code, source: "mcc-wiki", error: String(error.message ?? error) });
      }
      if ((idx + 1) % 30 === 0) console.log(`  MCC progress: ${idx + 1}/${targets.length}`);
    });
  }

  if (args.sources.has("dandegate")) {
    const dolls = items.filter((item) => item.type === "doll");
    console.log(`Fetching English doll names from Dandegate (${dolls.length} pages)...`);
    await runPool(dolls, Math.min(args.concurrency, 4), async (item) => {
      const url = `${DANDEGATE_ORIGIN}/dolls/${dandegateSlugFor(item)}`;
      try {
        const html = await fetchText(url, args.timeoutMs, Math.min(args.retries, 1));
        applySourceName(entries[String(item.id)], "en", extractDandegateName(html), "dandegate", changes);
      } catch (error) {
        changes.failures.push({ id: item.id, code: item.code, source: "dandegate", error: String(error.message ?? error) });
      }
    });
  }

  if (args.sources.has("gfl2help")) {
    console.log("Checking English names against gfl2.help indexes...");
    for (const [kind, url] of Object.entries({
      dolls: `${GFL2_HELP_ORIGIN}/en/characters/t-dolls`,
      weapons: `${GFL2_HELP_ORIGIN}/en/weapons`,
    })) {
      try {
        const html = await fetchText(url, args.timeoutMs, Math.min(args.retries, 1));
        const visibleNames = extractVisibleNames(html);
        for (const item of items.filter((candidate) => (kind === "dolls" ? candidate.type === "doll" : candidate.type === "weapon"))) {
          const entry = entries[String(item.id)];
          if (entry.en && [...visibleNames].some((name) => normalizeName(name) === normalizeName(entry.en))) continue;
          const fallback = enFallback(item);
          const matched = [...visibleNames].find((name) => normalizeName(name) === normalizeName(fallback));
          if (matched) applySourceName(entry, "en", matched, "gfl2.help", changes);
        }
      } catch (error) {
        changes.failures.push({ source: `gfl2.help:${kind}`, error: String(error.message ?? error) });
      }
    }
  }

  if (args.sources.has("wikiru")) {
    console.log("Checking Japanese names against wikiru indexes...");
    for (const [kind, url] of Object.entries({ dolls: WIKIRU_CHARACTER_PAGE, weapons: WIKIRU_WEAPON_PAGE })) {
      try {
        const html = await fetchText(url, args.timeoutMs, args.retries);
        const visibleNames = extractVisibleNames(html);
        for (const item of items.filter((candidate) => (kind === "dolls" ? candidate.type === "doll" : candidate.type === "weapon"))) {
          const entry = entries[String(item.id)];
          if (entry.jp && [...visibleNames].some((name) => name === entry.jp)) continue;
          if (item.jp && visibleNames.has(item.jp)) applySourceName(entry, "jp", item.jp, "wikiru", changes);
        }
      } catch (error) {
        changes.failures.push({ source: `wikiru:${kind}`, error: String(error.message ?? error) });
      }
    }
  }

  const sorted = {};
  for (const key of Object.keys(entries).sort((a, b) => Number(a) - Number(b))) {
    const { id: _id, ...entry } = entries[key];
    sorted[key] = Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));
  }

  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  console.log(`Wrote ${Object.keys(sorted).length} i18n name entries to ${args.out}`);
  console.log(`Added missing fields: ${changes.added}`);
  if (changes.conflicts.length) {
    console.log(`Conflicts kept existing values: ${changes.conflicts.length}`);
    for (const conflict of changes.conflicts.slice(0, 20)) {
      console.log(`  ${conflict.id} ${conflict.code} ${conflict.field}: existing="${conflict.existing}" incoming="${conflict.incoming}" source=${conflict.source}`);
    }
  }
  if (changes.failures.length) {
    console.log(`Source fetch failures: ${changes.failures.length}`);
    for (const failure of changes.failures.slice(0, 20)) {
      console.log(`  ${failure.source} ${failure.id ?? ""} ${failure.code ?? ""}: ${failure.error}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
