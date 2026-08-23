#!/usr/bin/env node
import fs from "node:fs/promises";
import { validateAuthoritativeNames } from "./authoritative-names.mjs";

function parseArgs(argv) {
  const args = {
    names: "src/i18n-names.json",
    sources: "src/i18n-name-sources.json",
    requiredFields: ["cn"],
    strict: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--names") args.names = argv[++index];
    else if (value === "--sources") args.sources = argv[++index];
    else if (value === "--all-locales") args.requiredFields = ["cn", "en", "jp"];
    else if (value === "--strict") args.strict = true;
  }
  return args;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const names = await readJson(args.names);
  const sources = await readJson(args.sources).catch((error) => {
    if (error?.code === "ENOENT") return {};
    throw error;
  });
  const result = validateAuthoritativeNames(names, sources, { requiredFields: args.requiredFields });

  console.log("authoritative names: missing=" + result.missing.length
    + ", conflicts=" + result.conflicts.length
    + ", invalidEncoding=" + result.invalidEncoding.length);
  for (const value of result.missing.slice(0, 20)) console.log("  missing " + value);
  for (const value of result.conflicts.slice(0, 20)) console.log("  conflict " + value);
  for (const value of result.invalidEncoding.slice(0, 20)) console.log("  invalid encoding " + value);
  if (args.strict && !result.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
