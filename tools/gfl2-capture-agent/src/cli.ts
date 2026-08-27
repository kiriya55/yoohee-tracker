import { createControlServer } from "./controlServer.js";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { writeCredentialFile } from "./credentialFile.js";
import { CertificateController } from "./certificate.js";
import { defaultConfig, parseCliConfig } from "./config.js";
import { createRecoveryStatePath, recoverInterruptedState, writeRecoveryState } from "./recoveryState.js";
import { MockttpInterceptionProxy } from "./proxy.js";
import { CaptureSession } from "./session.js";
import type { CaptureAgentConfig } from "./config.js";
import type { ControlServerOptions } from "./controlServer.js";
import type { InstalledCertificate } from "./certificate.js";
import type { InterceptionProxy, InterceptionProxyOptions } from "./proxy.js";
import type { CaptureSession as CaptureSessionType } from "./session.js";
import type { PublicSessionStatus } from "./session.js";
import type { SystemProxyController, ProxySnapshot } from "./windowsProxy.js";
import { WindowsSystemProxyController } from "./windowsProxy.js";

export type ControlServerLike = {
  listen(): Promise<void>;
  close(): Promise<void>;
  address(): string;
};

export type CliDependencies = {
  recoverInterruptedState?: () => Promise<void>;
  confirmCertificateInstall?: () => Promise<boolean>;
  systemProxy?: SystemProxyController;
  certificate?: Pick<CertificateController, "install" | "remove">;
  createProxy?: (options: InterceptionProxyOptions) => InterceptionProxy;
  createControlServer?: (options: ControlServerOptions) => ControlServerLike;
  waitUntilStopped?: (stop: () => Promise<void>, stopped: Promise<void>) => Promise<void>;
  writeLine?: (line: string) => void;
  now?: () => Date;
  platform?: NodeJS.Platform;
  recoveryPath?: string;
};

const USAGE = [
  "GFL2 Capture Agent",
  "  node dist/src/cli.js [options]",
  "",
  "Options:",
  "  --upstream <http-url>       chain through an upstream proxy such as http://127.0.0.1:7890",
  "  --allow-origin <origin>     allow a deployed Tracker origin to claim credentials",
  "  --control-port <port>       localhost control API port (default: 17890)",
  "  --proxy-port <port>         local interception port (default: dynamic)",
  "  --export <path>             explicitly export one captured credential file",
  "  --no-system-proxy           do not modify Windows WinINET proxy settings",
  "  --help                      show this message",
].join("\n");

const SAFE_ERROR_MESSAGES = new Set([
  "--upstream must be a valid HTTP proxy URL",
  "--upstream must use http or https",
  "--upstream must include a proxy port",
  "--upstream credentials are not supported",
  "--allow-origin must be a valid origin URL",
  "--allow-origin must contain only an HTTP(S) origin",
  "--export must not be empty",
  "capture certificate installation was declined",
  "capture certificate confirmation requires an interactive terminal",
  "could not recover the previous capture session",
  "could not read Windows proxy settings",
  "could not enable the Windows proxy",
  "could not restore the Windows proxy",
  "could not install the capture certificate",
  "could not remove the capture certificate",
  "capture proxy could not start",
  "capture proxy could not stop",
  "capture agent cleanup failed",
  "CertUtil is not available",
  "PowerShell is not available",
]);

function defaultWaitUntilStopped(stop: () => Promise<void>, stopped: Promise<void>): Promise<void> {
  return Promise.race([
    stopped,
    new Promise<void>((resolve, reject) => {
      const onSignal = () => {
        void stop().then(resolve, reject);
      };
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
    }),
  ]);
}

function errorText(error: unknown, stage?: string): string {
  if (error instanceof Error && SAFE_ERROR_MESSAGES.has(error.message)) return error.message;
  return stage ? `capture agent could not start during ${stage}` : "capture agent could not start";
}

export function formatCapturedStatus(status: PublicSessionStatus): string {
  const server = status.credential.serverId ?? "unknown server";
  const uid = status.credential.uidAvailable ? "UID detected" : "UID not detected";
  const capturedAt = status.credential.capturedAt ?? "unknown time";
  return `Captured official GFL2 /list request: ${server}; ${uid}; ${capturedAt}`;
}

async function confirmCertificateInstall(): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("capture certificate confirmation requires an interactive terminal");
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(
      "This will install a temporary GFL2 Capture Agent CA for the current Windows user. Continue? [y/N] ",
    );
    return /^(?:y|yes)$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

async function waitForCredential(session: CaptureSessionType, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!session.status().credential.available) {
    if (Date.now() >= deadline) throw new Error("capture timed out without an allowed GFL2 request");
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
}

function defaultRecover(platform: NodeJS.Platform): () => Promise<void> {
  return async () => {
    if (platform !== "win32") return;
    const systemProxy = new WindowsSystemProxyController(undefined, platform);
    const certificate = new CertificateController({ platform });
    await recoverInterruptedState(createRecoveryStatePath(), {
      restoreProxy: (snapshot) => systemProxy.restore(snapshot),
      removeCertificate: (thumbprint) => certificate.remove(thumbprint),
    });
  };
}

export async function run(argv: string[], dependencies: CliDependencies = {}): Promise<number> {
  const writeLine = dependencies.writeLine ?? ((line: string) => process.stdout.write(`${line}\n`));
  const platform = dependencies.platform ?? process.platform;
  if (argv.includes("--help") || argv.includes("-h")) {
    writeLine(USAGE);
    return 0;
  }

  let config: CaptureAgentConfig;
  try {
    config = parseCliConfig(argv);
  } catch (error) {
    writeLine(`ERROR: ${errorText(error, "argument parsing")}`);
    return 1;
  }

  const recoverPrevious = dependencies.recoverInterruptedState ?? defaultRecover(platform);
  let systemProxy: SystemProxyController | undefined;
  let proxySnapshot: ProxySnapshot | undefined;
  let certificate: Pick<CertificateController, "install" | "remove"> | undefined;
  let installedCertificate: InstalledCertificate | undefined;
  let proxy: InterceptionProxy | undefined;
  let session: CaptureSession | undefined;
  let controlServer: ControlServerLike | undefined;
  let recoveryWritten = false;
  let cleaned = false;
  let startupStage = "startup";

  let resolveStopped!: () => void;
  let rejectStopped!: (error: unknown) => void;
  const stopped = new Promise<void>((resolve, reject) => {
    resolveStopped = resolve;
    rejectStopped = reject;
  });

  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    let failure: unknown;
    if (controlServer) {
      try { await controlServer.close(); } catch (error) { failure ??= error; }
    }
    if (session) {
      try { await session.stop(); } catch (error) { failure ??= error; }
    } else if (proxy) {
      try { await proxy.stop(); } catch (error) { failure ??= error; }
    }
    if (installedCertificate && certificate) {
      try { await certificate.remove(installedCertificate.thumbprint); } catch (error) { failure ??= error; }
    }
    if (proxySnapshot && systemProxy) {
      try { await systemProxy.restore(proxySnapshot); } catch (error) { failure ??= error; }
    }
    if (recoveryWritten && !failure) {
      try {
        const { rm } = await import("node:fs/promises");
        await rm(dependencies.recoveryPath ?? createRecoveryStatePath(), { force: true });
      } catch (error) { failure ??= error; }
    }
    if (failure) throw new Error("capture agent cleanup failed");
  };

  const requestStop = async (): Promise<void> => {
    try {
      await cleanup();
      resolveStopped();
    } catch (error) {
      rejectStopped(error);
      throw error;
    }
  };

  try {
    startupStage = "previous session recovery";
    await recoverPrevious();
    startupStage = "certificate confirmation";
    const confirmed = await (dependencies.confirmCertificateInstall ?? confirmCertificateInstall)();
    if (!confirmed) throw new Error("capture certificate installation was declined");
    if (config.useSystemProxy) {
      startupStage = "Windows proxy snapshot";
      systemProxy = dependencies.systemProxy ?? new WindowsSystemProxyController(undefined, platform);
      proxySnapshot = await systemProxy.snapshot();
    }
    startupStage = "certificate installation";
    certificate = dependencies.certificate ?? new CertificateController({ platform });
    installedCertificate = await certificate.install();
    startupStage = "interception proxy startup";
    proxy = (dependencies.createProxy ?? ((options) => new MockttpInterceptionProxy(options)))({
      port: config.proxyPort,
      upstreamProxy: config.upstreamProxy,
      ca: { key: installedCertificate.key, cert: installedCertificate.cert },
    });
    session = new CaptureSession({
      proxy,
      now: dependencies.now,
      onStatus: (status) => {
        if (status.phase === "captured") writeLine(formatCapturedStatus(status));
      },
    });
    startupStage = "capture session startup";
    await session.start();

    if (proxySnapshot && systemProxy) {
      startupStage = "recovery state write";
      const recoveryPath = dependencies.recoveryPath ?? createRecoveryStatePath();
      await writeRecoveryState(recoveryPath, {
        version: 1,
        startedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
        certificateThumbprint: installedCertificate.thumbprint,
        proxy: proxySnapshot,
      });
      recoveryWritten = true;
      startupStage = "Windows proxy enable";
      await systemProxy.enable("127.0.0.1", session.status().proxyPort ?? config.proxyPort);
    }

    startupStage = "control server startup";
    controlServer = (dependencies.createControlServer ?? ((options) => createControlServer(options)))({
      session,
      host: config.controlHost,
      port: config.controlPort,
      allowedOrigins: config.allowedOrigins,
      onStop: requestStop,
    });
    await controlServer.listen();
    writeLine(`Control API: ${controlServer.address()}`);
    writeLine(`Capture proxy port: ${session.status().proxyPort ?? "unknown"}`);
    writeLine(`Pairing code: ${session.getPairingCode()}`);
    writeLine("Waiting for an official GFL2 /list request...");

    if (config.exportPath) {
      startupStage = "credential capture";
      await waitForCredential(session, config.captureTimeoutMs);
      await writeCredentialFile(config.exportPath, session.claim(session.getPairingCode()));
      writeLine(`Credential exported to: ${config.exportPath}`);
      await requestStop();
      return 0;
    }

    startupStage = "capture wait";
    await (dependencies.waitUntilStopped ?? defaultWaitUntilStopped)(requestStop, stopped);
    await cleanup();
    return 0;
  } catch (error) {
    writeLine(`ERROR: ${errorText(error, startupStage)}`);
    try { await cleanup(); } catch { writeLine("ERROR: capture agent cleanup failed"); }
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
