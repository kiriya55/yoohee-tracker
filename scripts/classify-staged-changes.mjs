import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const volatileTimestampPatterns = [
  '^[[:space:]]*"verifiedAt":',
  '^[[:space:]]*"generatedAt":',
];

export function classifyStagedChanges(cwd = process.cwd()) {
  const hasStagedChanges = gitDiffHasChanges(["diff", "--cached", "--quiet"], cwd);
  if (!hasStagedChanges) return "none";

  const hasNonTimestampChanges = gitDiffHasChanges([
    "diff",
    "--cached",
    "--quiet",
    ...volatileTimestampPatterns.flatMap((pattern) => ["-I", pattern]),
  ], cwd);

  return hasNonTimestampChanges ? "substantive" : "timestamps-only";
}

function gitDiffHasChanges(args, cwd) {
  const result = spawnSync("git", args, { cwd, stdio: "ignore" });
  if (result.error) throw result.error;
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  throw new Error(`git diff failed with exit status ${result.status ?? "unknown"}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(classifyStagedChanges());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
