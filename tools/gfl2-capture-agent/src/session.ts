import { randomBytes } from "node:crypto";
import { publicCredentialStatus, validateCredential } from "./credential.js";
import type { CaptureCredential } from "./credential.js";
import type { InterceptionProxy } from "./proxy.js";
import { inspectGachaRequest } from "./targets.js";
import type { CapturedRequest, Gfl2ServerId } from "./targets.js";

export type CapturePhase = "idle" | "starting" | "waiting" | "captured" | "stopping" | "error";

export type PublicSessionStatus = {
  phase: CapturePhase;
  proxyPort?: number;
  credential: {
    available: boolean;
    serverId?: Gfl2ServerId;
    capturedAt?: string;
    uidAvailable: boolean;
  };
  pairingCodeSet: boolean;
  error?: string;
};

export type CaptureSessionOptions = {
  pairingCode?: string;
  proxy: InterceptionProxy;
  now?: () => Date;
  onStatus?: (status: PublicSessionStatus) => void;
};

function newPairingCode(): string {
  return randomBytes(16).toString("hex");
}

export class CaptureSession {
  private readonly proxy: InterceptionProxy;
  private readonly now: () => Date;
  private readonly onStatus?: (status: PublicSessionStatus) => void;
  private pairingCode?: string;
  private phase: CapturePhase = "idle";
  private proxyPort?: number;
  private credential?: CaptureCredential;
  private error?: string;

  public constructor(options: CaptureSessionOptions) {
    this.proxy = options.proxy;
    this.now = options.now ?? (() => new Date());
    this.onStatus = options.onStatus;
    this.pairingCode = options.pairingCode ?? newPairingCode();
  }

  public async start(): Promise<void> {
    if (this.phase !== "idle" && this.phase !== "error") throw new Error("capture session is already running");
    this.phase = "starting";
    this.error = undefined;
    try {
      const started = await this.proxy.start();
      this.proxyPort = started.port;
      await this.proxy.onRequest((request) => {
        this.observe(request);
      });
      this.phase = "waiting";
    } catch {
      this.phase = "error";
      this.error = "capture proxy could not start";
      throw new Error(this.error);
    }
  }

  public observe(request: CapturedRequest): boolean {
    if (this.phase !== "waiting" && this.phase !== "captured") return false;
    if (this.credential) return false;
    const info = inspectGachaRequest(request);
    if (!info) return false;

    this.credential = validateCredential({
      format: "gfl2-capture-credential",
      version: 1,
      serverId: info.serverId,
      endpoint: info.endpoint,
      authorization: info.authorization,
      ...(info.uid ? { uid: info.uid } : {}),
      capturedAt: this.now().toISOString(),
    });
    this.phase = "captured";
    this.onStatus?.(this.status());
    return true;
  }

  public claim(pairingCode: string): CaptureCredential {
    if (!this.pairingCode || pairingCode !== this.pairingCode) throw new Error("invalid pairing code");
    return this.consumeCredential();
  }

  public claimApproved(): CaptureCredential {
    return this.consumeCredential();
  }

  private consumeCredential(): CaptureCredential {
    if (!this.credential) throw new Error("credential is not available");
    const credential = this.credential;
    this.credential = undefined;
    this.pairingCode = undefined;
    this.phase = "waiting";
    return credential;
  }

  public clear(): void {
    this.credential = undefined;
    this.pairingCode = undefined;
  }

  public getPairingCode(): string {
    if (!this.pairingCode) throw new Error("pairing code is no longer available");
    return this.pairingCode;
  }

  public status(): PublicSessionStatus {
    return {
      phase: this.phase,
      proxyPort: this.proxyPort,
      credential: publicCredentialStatus(this.credential),
      pairingCodeSet: Boolean(this.pairingCode),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  public async stop(): Promise<void> {
    if (this.phase === "idle") return;
    this.phase = "stopping";
    this.clear();
    try {
      await this.proxy.stop();
      this.proxyPort = undefined;
      this.phase = "idle";
    } catch {
      this.phase = "error";
      this.error = "capture proxy could not stop";
      throw new Error(this.error);
    }
  }
}
