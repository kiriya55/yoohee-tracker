import { execFile } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateCACertificate } from "mockttp";
import type { CommandRunner, CommandResult } from "./windowsProxy.js";

export type CertificateMaterial = {
  key: string;
  cert: string;
};

export type InstalledCertificate = CertificateMaterial & {
  thumbprint: string;
};

type CertificateControllerOptions = {
  runner?: CommandRunner;
  platform?: NodeJS.Platform;
  generate?: () => Promise<CertificateMaterial>;
  fingerprint?: (certificate: string) => string;
  tempRoot?: string;
};

const CERTUTIL = "certutil.exe";

const runCertutil: CommandRunner = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, maxBuffer: 1_048_576 }, (error, stdout, stderr) => {
    if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      reject(new Error("CertUtil is not available"));
      return;
    }
    resolve({ exitCode: error ? 1 : 0, stdout, stderr } satisfies CommandResult);
  });
});

function defaultFingerprint(certificate: string): string {
  return new X509Certificate(certificate).fingerprint.replace(/:/g, "");
}

function assertSuccess(result: CommandResult, message: string): void {
  if (result.exitCode !== 0) throw new Error(message);
}

export class CertificateController {
  private readonly runner: CommandRunner;
  private readonly platform: NodeJS.Platform;
  private readonly generate: () => Promise<CertificateMaterial>;
  private readonly fingerprint: (certificate: string) => string;
  private readonly tempRoot: string;

  public constructor(options: CertificateControllerOptions = {}) {
    this.runner = options.runner ?? runCertutil;
    this.platform = options.platform ?? process.platform;
    this.generate = options.generate ?? (async () => generateCACertificate({
      bits: 2048,
      subject: { commonName: "GFL2 Capture Agent CA", organizationName: "Yoohee Tracker" },
    }));
    this.fingerprint = options.fingerprint ?? defaultFingerprint;
    this.tempRoot = options.tempRoot ?? os.tmpdir();
  }

  private assertWindows(): void {
    if (this.platform !== "win32") throw new Error("the certificate adapter requires Windows");
  }

  public async install(): Promise<InstalledCertificate> {
    this.assertWindows();
    const material = await this.generate();
    const thumbprint = this.fingerprint(material.cert).replace(/:/g, "").toUpperCase();
    if (!/^[A-F0-9]{8,}$/.test(thumbprint)) throw new Error("generated certificate has an invalid thumbprint");

    const directory = await mkdtemp(path.join(this.tempRoot, "gfl2-capture-ca-"));
    const certificatePath = path.join(directory, "ca.cer");
    try {
      await writeFile(certificatePath, material.cert, "utf8");
      const result = await this.runner(CERTUTIL, ["-user", "-addstore", "Root", certificatePath]);
      assertSuccess(result, "could not install the capture certificate");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }

    return { ...material, thumbprint };
  }

  public async remove(thumbprint: string): Promise<void> {
    this.assertWindows();
    const normalized = thumbprint.replace(/:/g, "").toUpperCase();
    if (!/^[A-F0-9]{8,}$/.test(normalized)) throw new Error("invalid certificate thumbprint");
    const result = await this.runner(CERTUTIL, ["-user", "-delstore", "Root", normalized]);
    assertSuccess(result, "could not remove the capture certificate");
  }
}
