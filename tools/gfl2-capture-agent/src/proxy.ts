import { getLocal } from "mockttp";
import type { CompletedRequest, Mockttp } from "mockttp";
import { GFL2_GACHA_HOSTS } from "./targets.js";
import type { CapturedRequest } from "./targets.js";

export type InterceptionProxyOptions = {
  port?: number;
  upstreamProxy?: string;
  ca: {
    key: string;
    cert: string;
  };
};

export interface InterceptionProxy {
  start(): Promise<{ port: number }>;
  stop(): Promise<void>;
  onRequest(handler: (request: CapturedRequest) => void): Promise<void>;
}

function toHeaderMap(headers: CompletedRequest["headers"]): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key,
    Array.isArray(value) ? value[0] : value,
  ]));
}

export class MockttpInterceptionProxy implements InterceptionProxy {
  private readonly options: InterceptionProxyOptions;
  private readonly server: Mockttp;

  public constructor(options: InterceptionProxyOptions) {
    this.options = options;
    this.server = getLocal({
      cors: false,
      debug: false,
      recordTraffic: false,
      suggestChanges: false,
      https: {
        key: options.ca.key,
        cert: options.ca.cert,
        tlsInterceptOnly: GFL2_GACHA_HOSTS.map((hostname) => ({ hostname })),
      },
    });
  }

  public async start(): Promise<{ port: number }> {
    if (this.options.port && this.options.port > 0) await this.server.start(this.options.port);
    else await this.server.start();

    await this.server.forAnyRequest().thenPassThrough({
      proxyConfig: this.options.upstreamProxy ? { proxyUrl: this.options.upstreamProxy } : undefined,
      simulateConnectionErrors: true,
    });
    return { port: this.server.port };
  }

  public async stop(): Promise<void> {
    await this.server.stop();
  }

  public async onRequest(handler: (request: CapturedRequest) => void): Promise<void> {
    await this.server.on("request", (request) => {
      void request.body.getText().then((body) => {
        handler({ method: request.method, url: request.url, headers: toHeaderMap(request.headers), ...(body ? { body } : {}) });
      }).catch(() => {
        handler({ method: request.method, url: request.url, headers: toHeaderMap(request.headers) });
      });
    });
  }
}
