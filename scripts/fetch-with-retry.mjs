const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

export async function fetchWithRetry(url, options = {}) {
  const {
    fetchImpl = fetch,
    attempts = 3,
    delayMs = 250,
    ...fetchOptions
  } = options;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchImpl(url, fetchOptions);
    } catch (error) {
      lastError = error;
      if (attempt < attempts && delayMs > 0) await wait(delayMs * attempt);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`GET ${url} failed after ${attempts} attempts: ${message}`, { cause: lastError });
}
