#!/usr/bin/env node
import fs from "node:fs/promises";

function parseArgs(argv) {
  const args = {
    index: "public/images/resource-index.json",
    names: "src/i18n-names.json",
    sources: "src/i18n-name-sources.json",
    out: "public/images/resource-index.json",
    appI18n: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--index") args.index = argv[++i];
    else if (a === "--names") args.names = argv[++i];
    else if (a === "--sources") args.sources = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--app-i18n") args.appI18n = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const index = JSON.parse(await fs.readFile(args.index, "utf8"));
  const names = JSON.parse(await fs.readFile(args.names, "utf8"));
  let sources = {};
  try {
    sources = JSON.parse(await fs.readFile(args.sources, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  let merged = 0;
  for (const [id, entry] of Object.entries(names)) {
    const item = index.items?.[id];
    if (item) {
      if (entry.cn) item.cn = entry.cn;
      if (entry.en) item.en = entry.en;
      if (entry.jp) item.jp = entry.jp;
      if (entry.aliases?.length) item.aliases = entry.aliases;
      if (sources[id]) item.nameSources = sources[id];
      merged += 1;
    }
  }

  await fs.writeFile(args.out, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  console.log(`Merged ${merged} i18n names into ${args.out}`);

  if (args.appI18n) {
    const appI18n = JSON.parse(await fs.readFile(args.appI18n, "utf8"));
    const nextNames = { ...(appI18n.names ?? {}) };
    for (const [id, entry] of Object.entries(names)) {
      nextNames[id] = {
        ...(nextNames[id] ?? {}),
        code: entry.code ?? nextNames[id]?.code,
        cn: entry.cn ?? nextNames[id]?.cn,
        type: entry.type ?? nextNames[id]?.type,
        en: entry.en ?? nextNames[id]?.en,
        jp: entry.jp ?? nextNames[id]?.jp,
        aliases: entry.aliases ?? nextNames[id]?.aliases,
      };
    }
    const sortedNames = {};
    for (const key of Object.keys(nextNames).sort((a, b) => Number(a) - Number(b))) {
      sortedNames[key] = nextNames[key];
    }
    appI18n.names = sortedNames;
    await fs.writeFile(args.appI18n, `${JSON.stringify(appI18n, null, 2)}\n`, "utf8");
    console.log(`Merged ${Object.keys(names).length} i18n names into ${args.appI18n}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
