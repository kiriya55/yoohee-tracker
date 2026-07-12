import { readFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../src/i18n.json", import.meta.url), "utf8"));
const locales = ["zh", "en", "jp"];
const baseline = Object.keys(catalog.ui.zh).sort();
const problems = [];

for (const locale of locales) {
  const keys = Object.keys(catalog.ui[locale] ?? {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify(baseline)) problems.push(`${locale}: UI key set differs from zh`);
  for (const key of keys) {
    if (typeof catalog.ui[locale][key] !== "string" || !catalog.ui[locale][key].trim()) problems.push(`${locale}.${key}: empty translation`);
  }
}

for (const file of ["importers.ts", "elmobeaconDb.ts", "remoteImport.ts"]) {
  const source = await readFile(new URL(`../src/lib/${file}`, import.meta.url), "utf8");
  if (/errors:\s*\[\s*["'`]/.test(source)) problems.push(`${file}: errors must use structured localization messages`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`i18n check passed: ${baseline.length} UI keys across ${locales.length} locales; structured import errors verified.`);
