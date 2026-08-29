#!/usr/bin/env node
/**
 * 把 tools/gfl2-capture-agent 打包成面向最终用户的独立 Windows 压缩包：
 *   release/gfl2-capture-agent-windows/gfl2-capture-agent-windows.zip
 *
 * 包结构：
 *   gfl2-capture-agent-windows/
 *     ├─ 启动gfl2捕获助手.cmd        （一键启动，无需 npm / 构建）
 *     ├─ 使用说明.txt
 *     └─ agent/                      （编译后的助手 + 生产依赖）
 *         ├─ dist/
 *         ├─ node_modules/           （仅生产依赖）
 *         ├─ package.json / README.md
 *
 * 用法：node scripts/pack-capture-agent.mjs
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = resolve(repoRoot, "tools", "gfl2-capture-agent");
const packagingDir = resolve(agentDir, "packaging");
const releaseDir = resolve(repoRoot, "release");
const stageName = "gfl2-capture-agent-windows";
const stageDir = resolve(releaseDir, stageName);
const stagedAgentDir = resolve(stageDir, "agent");
const zipPath = resolve(releaseDir, `${stageName}.zip`);

const KEEP_AGENT_ENTRIES = new Set(["dist", "node_modules", "package.json", "package-lock.json", "README.md"]);

function log(message) {
  process.stdout.write(`${message}\n`);
}

function run(command, args, cwd) {
  log(`$ ${command} ${args.join(" ")}  (cwd: ${cwd})`);
  // shell:true so that npm.cmd / powershell.exe resolve on Windows without a file extension.
  execFileSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
}

function stageAgent() {
  log(`Staging agent into ${stagedAgentDir}`);
  mkdirSync(stagedAgentDir, { recursive: true });

  // Copy whitelisted entries from the agent source folder.
  for (const entry of KEEP_AGENT_ENTRIES) {
    const src = resolve(agentDir, entry);
    if (!existsSync(src)) {
      if (entry === "dist") {
        throw new Error("agent dist/ is missing; build the agent first");
      }
      continue;
    }
    cpSync(src, resolve(stagedAgentDir, entry), {
      recursive: true,
      // Never leak the packaging template folder or captures.
      filter: (source) => !/[\\/]packaging([\\/]|$)/.test(source) && !/[\\/]captures([\\/]|$)/.test(source),
    });
  }

  // Drop dev dependencies (tsx / typescript / vitest …): runtime only needs mockttp.
  run("npm", ["prune", "--omit=dev"], stagedAgentDir);
}

function stageLauncher() {
  const template = readFileSync(resolve(packagingDir, "启动gfl2捕获助手.cmd"), "utf8");
  writeFileSync(resolve(stageDir, "启动gfl2捕获助手.cmd"), template.replace(/\r?\n/g, "\r\n"), { encoding: "utf8" });
  cpSync(resolve(packagingDir, "使用说明.txt"), resolve(stageDir, "使用说明.txt"));
}

function makeZip() {
  log(`Writing zip -> ${zipPath}`);
  rmSync(zipPath, { force: true });
  // Compress-Archive ships with Windows PowerShell 5+.
  const ps = [
    `Compress-Archive -Path '${stageDir.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
  ].join("; ");
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps], repoRoot);
}

function verifyZip() {
  const listing = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/'/g, "''")}').Entries | Select-Object -First 6 -ExpandProperty FullName`],
    { encoding: "utf8" },
  );
  log("Zip entries (first 6):");
  for (const line of listing.split(/\r?\n/).filter(Boolean)) log(`  ${line.trim()}`);
}

function main() {
  if (process.platform !== "win32") {
    throw new Error("This packager builds a Windows .cmd bundle and must run on Windows.");
  }
  if (!existsSync(resolve(agentDir, "dist", "src", "cli.js"))) {
    throw new Error("agent dist/ not found; run `npm run build` in tools/gfl2-capture-agent first.");
  }

  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  try {
    stageAgent();
    stageLauncher();
    makeZip();
    verifyZip();
    log("");
    log("Done.");
    log(`  Folder : ${stageDir}`);
    log(`  Zip    : ${zipPath}`);
    log("Upload the zip to GitHub Releases (asset name must stay gfl2-capture-agent-windows.zip");
    log("for the website's /releases/latest/download/ link) and/or R2.");
  } finally {
    // Keep the staging folder? Remove it so only the zip is delivered.
    rmSync(stageDir, { recursive: true, force: true });
  }
}

main();
