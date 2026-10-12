import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { preserveResourceTimestamps } from "./resource-change-policy.mjs";

// Run after image/i18n merges and before artifacts or R2 publication so all
// published copies share the same stable timestamps. Missing files fail safe.
for (const file of process.argv.slice(2)) {
  const candidate = JSON.parse(await readFile(file, "utf8"));
  const previous = JSON.parse(execFileSync("git", ["show", `HEAD:${file}`], {
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  }));
  await writeFile(file, `${JSON.stringify(preserveResourceTimestamps(previous, candidate), null, 2)}\n`);
}
