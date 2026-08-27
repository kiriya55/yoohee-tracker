import path from "node:path";

const DEFAULT_CONTROL_HOST = "127.0.0.1" as const;
const DEFAULT_CONTROL_PORT = 17890;
const DEFAULT_CAPTURE_TIMEOUT_MS = 120_000;
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://yoohee-tracker.kiriya55.cn",
];

export type CaptureAgentConfig = {
  controlHost: typeof DEFAULT_CONTROL_HOST;
  controlPort: number;
  proxyPort: number;
  upstreamProxy?: string;
  allowedOrigins: string[];
  captureTimeoutMs: number;
  outputDirectory: string;
  useSystemProxy: boolean;
  exportPath?: string;
};

export function defaultConfig(): CaptureAgentConfig {
  return {
    controlHost: DEFAULT_CONTROL_HOST,
    controlPort: DEFAULT_CONTROL_PORT,
    proxyPort: 0,
    allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS],
    captureTimeoutMs: DEFAULT_CAPTURE_TIMEOUT_MS,
    outputDirectory: path.resolve(process.cwd(), "captures"),
    useSystemProxy: true,
  };
}

function parsePort(value: string, name: string, allowZero = false): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a number`);
  const port = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(port) || port < minimum || port > 65_535) {
    throw new Error(`${name} must be between ${minimum} and 65535`);
  }
  return port;
}

function parseUpstream(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--upstream must be a valid HTTP proxy URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("--upstream must use http or https");
  }
  if (!url.hostname || url.port === "") throw new Error("--upstream must include a proxy port");
  if (url.username || url.password) throw new Error("--upstream credentials are not supported");
  return url.origin;
}

function parseOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--allow-origin must be a valid origin URL");
  }
  if (!/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("--allow-origin must contain only an HTTP(S) origin");
  }
  return url.origin;
}

export function parseCliConfig(args: string[]): CaptureAgentConfig {
  const config = defaultConfig();
  const origins = new Set(config.allowedOrigins);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-system-proxy") {
      config.useSystemProxy = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") continue;

    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);

    switch (arg) {
      case "--upstream":
        config.upstreamProxy = parseUpstream(value);
        break;
      case "--allow-origin":
        origins.add(parseOrigin(value));
        break;
      case "--control-port":
        config.controlPort = parsePort(value, "--control-port");
        break;
      case "--proxy-port":
        config.proxyPort = parsePort(value, "--proxy-port", true);
        break;
      case "--capture-timeout-ms":
        if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error("--capture-timeout-ms must be a positive number");
        config.captureTimeoutMs = Number(value);
        break;
      case "--output-dir":
        if (!value.trim()) throw new Error("--output-dir must not be empty");
        config.outputDirectory = path.resolve(value);
        break;
      case "--export":
        if (!value.trim()) throw new Error("--export must not be empty");
        config.exportPath = path.resolve(value);
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
    index += 1;
  }

  if (config.controlPort === config.proxyPort && config.proxyPort !== 0) {
    throw new Error("--control-port and --proxy-port must be different");
  }
  config.allowedOrigins = [...origins];
  return config;
}
