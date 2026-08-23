import { ProxyAgent } from "undici";

const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

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
    attempts = 3,
    delayMs = 250,
    proxyUrl,
    dispatcher,
    ...fetchOptions
  } = options;
  const requestOptions = {
    ...fetchOptions,
    dispatcher: dispatcherFor(proxyUrl, dispatcher),
  };
  if (!requestOptions.dispatcher) delete requestOptions.dispatcher;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchImpl(url, requestOptions);
    } catch (error) {
      lastError = error;
      if (attempt < attempts && delayMs > 0) await wait(delayMs * attempt);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`GET ${url} failed after ${attempts} attempts: ${message}`, { cause: lastError });
}
