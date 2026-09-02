import { ProxyAgent } from "undici";

const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

export const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429]);

export function isRetryableStatus(status) {
  return RETRYABLE_HTTP_STATUSES.has(Number(status)) || Number(status) >= 500;
}

function retryAfterMs(response, now = Date.now()) {
  const value = response?.headers?.get?.("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : undefined;
}

function backoffMs(base, attempt, maxDelay, jitter, random) {
  const exponential = Math.min(maxDelay, base * (2 ** Math.max(0, attempt - 1)));
  const spread = exponential * Math.max(0, Math.min(1, jitter));
  return Math.max(0, Math.round(exponential - spread + (random() * spread * 2)));
}

const proxyAgents = new Map();

function dispatcherFor(proxyUrl, dispatcher) {
  if (dispatcher || !proxyUrl) return dispatcher;
  let agent = proxyAgents.get(proxyUrl);
  if (!agent) {
    agent = new ProxyAgent(proxyUrl);
    proxyAgents.set(proxyUrl, agent);
  }
  return agent;
}

export async function fetchWithRetry(url, options = {}) {
  const {
    fetchImpl = fetch,
    attempts = 4,
    delayMs = 500,
    maxDelayMs = 8000,
    jitter = 0.25,
    sleep = wait,
    random = Math.random,
    now = () => Date.now(),
    onAttempt,
    signalFactory,
    proxyUrl,
    dispatcher,
    ...fetchOptions
  } = options;
  const maxAttempts = Math.max(1, Number(attempts) || 4);
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    onAttempt?.(attempt);
    const requestOptions = {
      ...fetchOptions,
      ...(signalFactory ? { signal: signalFactory() } : {}),
      dispatcher: dispatcherFor(proxyUrl, dispatcher),
    };
    if (!requestOptions.dispatcher) delete requestOptions.dispatcher;
    try {
      const response = await fetchImpl(url, requestOptions);
      if (!isRetryableStatus(response?.status) || attempt === maxAttempts) return response;
      // Release a retryable response before opening the next connection. This
      // matters for undici's connection pool when an upstream returns a large
      // error body repeatedly.
      try {
        await response?.body?.cancel?.();
      } catch {
        // A failed body cancellation should not hide the original retry path.
      }
      const serverDelay = retryAfterMs(response, now());
      const delay = serverDelay === undefined
        ? backoffMs(delayMs, attempt, maxDelayMs, jitter, random)
        : Math.min(maxDelayMs, serverDelay);
      if (delay > 0) await sleep(delay);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const delay = backoffMs(delayMs, attempt, maxDelayMs, jitter, random);
        if (delay > 0) await sleep(delay);
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`GET ${url} failed after ${maxAttempts} attempts: ${message}`, { cause: lastError });
}
