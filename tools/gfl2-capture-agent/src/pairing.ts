import { randomBytes } from "node:crypto";

export type PairingRequest = {
  requestId: string;
  state: string;
  origin: string;
};

export type PairingGrant = {
  token: string;
  state: string;
  origin: string;
};

type PendingRequest = PairingRequest & { expiresAt: number };
type StoredGrant = PairingGrant & { expiresAt: number };

export type LocalPairingManagerOptions = {
  allowedOrigins: readonly string[];
  ttlMs?: number;
  now?: () => number;
  requestIdFactory?: () => string;
  grantTokenFactory?: () => string;
};

const DEFAULT_TTL_MS = 10 * 60 * 1_000;

function randomToken(): string {
  return randomBytes(24).toString("hex");
}

export class LocalPairingManager {
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly requestIdFactory: () => string;
  private readonly grantTokenFactory: () => string;
  private readonly requests = new Map<string, PendingRequest>();
  private readonly grants = new Map<string, StoredGrant>();

  public constructor(options: LocalPairingManagerOptions) {
    this.allowedOrigins = new Set(options.allowedOrigins);
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
    this.requestIdFactory = options.requestIdFactory ?? randomToken;
    this.grantTokenFactory = options.grantTokenFactory ?? randomToken;
  }

  public createRequest(origin: string, state: string): PairingRequest {
    this.removeExpired();
    if (!this.allowedOrigins.has(origin)) throw new Error("origin is not allowed");
    if (!state.trim()) throw new Error("pairing state is required");
    const request = {
      requestId: this.requestIdFactory(),
      state,
      origin,
      expiresAt: this.now() + this.ttlMs,
    } satisfies PendingRequest;
    this.requests.set(request.requestId, request);
    return this.publicRequest(request);
  }

  public getRequest(requestId: string): PairingRequest | undefined {
    this.removeExpired();
    const request = this.requests.get(requestId);
    return request ? this.publicRequest(request) : undefined;
  }

  public approve(requestId: string): PairingGrant {
    this.removeExpired();
    const request = this.requests.get(requestId);
    if (!request) throw new Error("pairing request is not available");
    this.requests.delete(requestId);
    const grant = {
      token: this.grantTokenFactory(),
      state: request.state,
      origin: request.origin,
      expiresAt: this.now() + this.ttlMs,
    } satisfies StoredGrant;
    this.grants.set(grant.token, grant);
    return this.publicGrant(grant);
  }

  public reject(requestId: string): boolean {
    this.removeExpired();
    return this.requests.delete(requestId);
  }

  public hasGrant(token: string, origin: string): boolean {
    this.removeExpired();
    const grant = this.grants.get(token);
    return Boolean(grant && grant.origin === origin);
  }

  public consumeGrant(token: string, origin: string): boolean {
    this.removeExpired();
    const grant = this.grants.get(token);
    if (!grant || grant.origin !== origin) return false;
    this.grants.delete(token);
    return true;
  }

  public clear(): void {
    this.requests.clear();
    this.grants.clear();
  }

  private removeExpired(): void {
    const now = this.now();
    for (const [id, request] of this.requests) {
      if (request.expiresAt <= now) this.requests.delete(id);
    }
    for (const [token, grant] of this.grants) {
      if (grant.expiresAt <= now) this.grants.delete(token);
    }
  }

  private publicRequest(request: PendingRequest): PairingRequest {
    return { requestId: request.requestId, state: request.state, origin: request.origin };
  }

  private publicGrant(grant: StoredGrant): PairingGrant {
    return { token: grant.token, state: grant.state, origin: grant.origin };
  }
}
