import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { comparableResourceIndex } from "./resource-change-policy.mjs";

const volatileTimestampPatterns = ['^[[:space:]]*"verifiedAt":', '^[[:space:]]*"generatedAt":'];

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout;
}

export function classifyStagedChanges(cwd = process.cwd()) {
  const files = git(["diff", "--cached", "--name-only", "-z"], cwd).split("\0").filter(Boolean);
  if (!files.length) return "none";
  for (const file of files) {
    // Only existing resource indexes receive semantic filtering. Additions,
    // deletions, images and unrelated JSON must remain meaningful.
    if (/(?:^|\/)(?:resource-index|gf2-resource-index\.[^/]+)\.json$/.test(file)) {
      const before = spawnSync("git", ["show", `HEAD:${file}`], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      const after = spawnSync("git", ["show", `:${file}`], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      if (before.status === 0 && after.status === 0) {
        try {
          if (JSON.stringify(comparableResourceIndex(JSON.parse(before.stdout))) ===
              JSON.stringify(comparableResourceIndex(JSON.parse(after.stdout)))) continue;
        } catch { /* Malformed JSON is substantive; never silently skip it. */ }
      }
      return "substantive";
    }
    const result = spawnSync("git", ["diff", "--cached", "--quiet",
      ...volatileTimestampPatterns.flatMap((pattern) => ["-I", pattern]), "--", file], { cwd });
    if (result.error) throw result.error;
    if (result.status === 1) return "substantive";
    if (result.status !== 0) throw new Error(`git diff failed with exit status ${result.status}`);
  }
  return "metadata-only";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(classifyStagedChanges());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
