import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const classifierScript = resolve(process.cwd(), "scripts/classify-staged-changes.mjs");
const temporaryRepositories: string[] = [];

afterEach(() => {
  for (const repository of temporaryRepositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

describe("staged generated change classification", () => {
  it("reports an empty staged diff", () => {
    const repository = createRepository();

    expect(runClassifier(repository)).toMatchObject({ status: 0, output: "none" });
  });

  it("ignores generatedAt and verifiedAt timestamp-only changes", () => {
    const repository = createRepository();
    const indexPath = join(repository, "resource-index.json");
    const index = JSON.parse(readFileSync(indexPath, "utf8"));
    index.generatedAt = "2026-10-01T00:00:00.000Z";
    index.items["1084"].verifiedAt = "2026-10-01T00:00:00.000Z";
    writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
    execFileSync("git", ["add", "resource-index.json"], { cwd: repository });

    expect(runClassifier(repository)).toMatchObject({ status: 0, output: "timestamps-only" });
  });

  it("keeps a real index change meaningful even when timestamps also change", () => {
    const repository = createRepository();
    const indexPath = join(repository, "resource-index.json");
    const index = JSON.parse(readFileSync(indexPath, "utf8"));
    index.generatedAt = "2026-10-01T00:00:00.000Z";
    index.items["1084"].verifiedAt = "2026-10-01T00:00:00.000Z";
    index.items["1084"].name = "New name";
    writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
    execFileSync("git", ["add", "resource-index.json"], { cwd: repository });

    expect(runClassifier(repository)).toMatchObject({ status: 0, output: "substantive" });
  });

  it("keeps new image files meaningful", () => {
    const repository = createRepository();
    const imagePath = join(repository, "public", "images", "new-avatar.png");
    mkdirSync(join(repository, "public", "images"), { recursive: true });
    writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    execFileSync("git", ["add", "public/images/new-avatar.png"], { cwd: repository });

    expect(runClassifier(repository)).toMatchObject({ status: 0, output: "substantive" });
  });
});

function createRepository() {
  const repository = mkdtempSync(join(tmpdir(), "yoohee-staged-changes-"));
  temporaryRepositories.push(repository);
  execFileSync("git", ["init", "--quiet"], { cwd: repository });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: repository });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repository });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repository });
  writeFileSync(join(repository, "resource-index.json"), `${JSON.stringify({
    generatedAt: "2026-09-30T00:00:00.000Z",
    items: {
      "1084": {
        id: 1084,
        name: "Colphne Doppelgaenger",
        verifiedAt: "2026-09-30T00:00:00.000Z",
      },
    },
  }, null, 2)}\n`);
  execFileSync("git", ["add", "resource-index.json"], { cwd: repository });
  execFileSync("git", ["commit", "--quiet", "-m", "baseline"], { cwd: repository });
  return repository;
}

function runClassifier(repository: string) {
  const result = spawnSync(process.execPath, [classifierScript], {
    cwd: repository,
    encoding: "utf8",
  });
  return {
    status: result.status,
    output: result.stdout.trim(),
    error: result.stderr.trim(),
  };
}
