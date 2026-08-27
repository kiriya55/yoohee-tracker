import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { CaptureSession } from "./session.js";
import { LocalPairingManager } from "./pairing.js";
import type { PairingRequest } from "./pairing.js";

export type ControlServerOptions = {
  session: CaptureSession;
  pairing?: LocalPairingManager;
  host: "127.0.0.1";
  port: number;
  allowedOrigins: string[];
  onStop?: () => Promise<void>;
};

type JsonObject = Record<string, unknown>;

const MAX_BODY_BYTES = 16 * 1024;

function writeJson(response: ServerResponse, status: number, body: unknown, origin?: string): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Private-Network", "true");
    response.setHeader("Vary", "Origin");
  }
  response.end(JSON.stringify(body));
}

function requestOrigin(request: IncomingMessage, allowedOrigins: string[]): string | undefined {
  const origin = request.headers.origin;
  if (!origin) return undefined;
  return allowedOrigins.includes(origin) ? origin : "";
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body is too large");
    chunks.push(buffer);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("request body is not valid JSON");
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLoopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1");
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function writeHtml(response: ServerResponse, status: number, body: string): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'");
  response.end(body);
}

function pairingApprovalPage(request: PairingRequest): string {
  const scriptData = JSON.stringify({ requestId: request.requestId }).replace(/</g, "\\u003c");
  const displayOrigin = escapeHtml(request.origin);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>允许本地助手连接</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111827; color: #f9fafb; }
    main { width: min(420px, calc(100vw - 40px)); padding: 28px; border: 1px solid #374151; border-radius: 16px; background: #1f2937; box-sizing: border-box; }
    h1 { margin: 0 0 12px; font-size: 1.25rem; }
    p { color: #d1d5db; line-height: 1.6; }
    code { color: #fbbf24; overflow-wrap: anywhere; }
    .actions { display: flex; gap: 10px; margin-top: 22px; }
    button { flex: 1; border: 0; border-radius: 9px; padding: 11px 14px; cursor: pointer; font-weight: 700; }
    #allow { background: #f59e0b; color: #111827; }
    #deny { background: #374151; color: #f9fafb; }
    #result { min-height: 1.5em; margin-bottom: 0; }
  </style>
</head>
<body>
  <main>
    <h1>允许本地捕获助手连接？</h1>
    <p><strong>${displayOrigin}</strong> 正在请求连接本机的 GFL2 捕获助手。</p>
    <p>只会共享本次抽卡记录同步所需的临时凭据，助手停止后授权失效。</p>
    <div class="actions">
      <button id="deny" type="button">拒绝</button>
      <button id="allow" type="button">允许本次连接</button>
    </div>
    <p id="result" role="status"></p>
  </main>
  <script>
    const request = ${scriptData};
    const result = document.querySelector("#result");
    const buttons = [...document.querySelectorAll("button")];
    async function decide(decision) {
      buttons.forEach((button) => { button.disabled = true; });
      try {
        const response = await fetch("/v1/pairing/" + decision, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "请求失败");
        if (decision === "approve" && window.opener) {
          window.opener.postMessage({
            type: "gfl2-capture-pairing-approved",
            state: body.state,
            grantToken: body.token,
          }, body.origin);
          result.textContent = "已允许连接，可以返回 Tracker。";
          window.setTimeout(() => window.close(), 500);
        } else {
          result.textContent = decision === "approve" ? "已允许，请返回 Tracker。" : "已拒绝连接。";
        }
      } catch (error) {
        result.textContent = error instanceof Error ? error.message : "请求失败";
        buttons.forEach((button) => { button.disabled = false; });
      }
    }
    document.querySelector("#allow").addEventListener("click", () => void decide("approve"));
    document.querySelector("#deny").addEventListener("click", () => void decide("reject"));
  </script>
</body>
</html>`;
}

export function createControlServer(options: ControlServerOptions): {
  listen(): Promise<void>;
  close(): Promise<void>;
  address(): string;
} {
  let addressValue: string | undefined;
  let server: Server | undefined;
  const pairing = options.pairing ?? new LocalPairingManager({ allowedOrigins: options.allowedOrigins });

  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const origin = requestOrigin(request, options.allowedOrigins);
    const pathname = new URL(request.url ?? "/", `http://${options.host}`).pathname;
    const isLocalPairingDecision = pathname === "/v1/pairing/approve" || pathname === "/v1/pairing/reject";
    if (origin === "" && !isLocalPairingDecision) {
      writeJson(response, 403, { error: "origin is not allowed" });
      return;
    }
    if (isLocalPairingDecision && request.headers.origin && !isLoopbackOrigin(request.headers.origin)) {
      writeJson(response, 403, { error: "pairing decisions must come from the local machine" });
      return;
    }

    if (request.method === "OPTIONS") {
      if (origin) writeJson(response, 204, undefined, origin);
      else response.writeHead(204).end();
      return;
    }

    try {
      if (request.method === "GET" && pathname === "/v1/status") {
        writeJson(response, 200, options.session.status(), origin);
        return;
      }

      if (request.method === "GET" && pathname === "/v1/pairing/request") {
        const trackerOrigin = request.headers.origin;
        if (!trackerOrigin || origin !== trackerOrigin) {
          writeJson(response, 403, { error: "a permitted tracker origin is required" });
          return;
        }
        const url = new URL(request.url ?? "/", `http://${options.host}`);
        const pending = pairing.createRequest(trackerOrigin, url.searchParams.get("state") ?? "");
        const controlOrigin = addressValue ?? `http://${options.host}:${options.port}`;
        writeJson(response, 200, {
          ...pending,
          approvalUrl: `${controlOrigin}/pairing/approve?requestId=${encodeURIComponent(pending.requestId)}`,
        }, origin);
        return;
      }

      if (request.method === "GET" && pathname === "/pairing/approve") {
        const url = new URL(request.url ?? "/", `http://${options.host}`);
        const requestId = url.searchParams.get("requestId") ?? "";
        const pending = pairing.getRequest(requestId);
        if (!pending) {
          writeHtml(response, 404, "<!doctype html><meta charset=\"utf-8\"><p>配对请求不存在或已过期。</p>");
          return;
        }
        writeHtml(response, 200, pairingApprovalPage(pending));
        return;
      }

      if (request.method === "POST" && pathname === "/v1/pairing/approve") {
        const body = await readJson(request);
        const requestId = isObject(body) && typeof body.requestId === "string" ? body.requestId : "";
        try {
          writeJson(response, 200, pairing.approve(requestId));
        } catch (error) {
          const message = error instanceof Error ? error.message : "pairing request is not available";
          writeJson(response, 404, { error: message });
        }
        return;
      }

      if (request.method === "POST" && pathname === "/v1/pairing/reject") {
        const body = await readJson(request);
        const requestId = isObject(body) && typeof body.requestId === "string" ? body.requestId : "";
        pairing.reject(requestId);
        writeJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && pathname === "/v1/credential/claim") {
        const body = await readJson(request);
        const pairingCode = isObject(body) && typeof body.pairingCode === "string" ? body.pairingCode : "";
        const grantToken = isObject(body) && typeof body.grantToken === "string" ? body.grantToken : "";
        if (!pairingCode && !grantToken) {
          writeJson(response, 400, { error: "pairing code is required" }, origin);
          return;
        }
        try {
          if (grantToken) {
            if (!origin || !pairing.hasGrant(grantToken, origin)) {
              writeJson(response, 403, { error: "pairing grant is invalid" }, origin);
              return;
            }
            const credential = options.session.claimApproved();
            pairing.consumeGrant(grantToken, origin);
            writeJson(response, 200, { credential }, origin);
            return;
          }
          const credential = options.session.claim(pairingCode);
          writeJson(response, 200, { credential }, origin);
        } catch (error) {
          const message = error instanceof Error ? error.message : "credential claim failed";
          const status = message === "credential is not available" ? 409 : 403;
          writeJson(response, status, { error: message }, origin);
        }
        return;
      }

      if (request.method === "POST" && pathname === "/v1/session/stop") {
        pairing.clear();
        writeJson(response, 200, { ok: true }, origin);
        response.once("finish", () => {
          setImmediate(() => {
            if (options.onStop) {
              void options.onStop?.().catch(() => undefined);
              return;
            }
            void options.session.stop().catch(() => undefined);
          });
        });
        return;
      }

      if (["GET", "POST"].includes(request.method ?? "")) {
        writeJson(response, 404, { error: "not found" }, origin);
      } else {
        writeJson(response, 405, { error: "method not allowed" }, origin);
      }
    } catch (error) {
      const message = error instanceof Error && error.message === "request body is too large"
        ? error.message
        : "request could not be processed";
      writeJson(response, 400, { error: message }, origin);
    }
  };

  return {
    async listen(): Promise<void> {
      if (server) return;
      server = createServer((request, response) => {
        void handler(request, response);
      });
      await new Promise<void>((resolve, reject) => {
        server?.once("error", reject);
        server?.listen(options.port, options.host, () => {
          server?.removeListener("error", reject);
          const address = server?.address();
          if (!address || typeof address === "string") {
            reject(new Error("control server did not expose an address"));
            return;
          }
          addressValue = `http://${options.host}:${address.port}`;
          resolve();
        });
      });
    },
    async close(): Promise<void> {
      if (!server) return;
      const current = server;
      server = undefined;
      addressValue = undefined;
      await new Promise<void>((resolve, reject) => {
        current.close((error) => error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
      });
    },
    address(): string {
      if (!addressValue) throw new Error("control server is not listening");
      return addressValue;
    },
  };
}
