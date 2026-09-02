import { fetchWithRetry } from "./fetch-with-retry.mjs";
import { parseDandegateAvatarHtml } from "./catalog-sources.mjs";

const DANDegate_ORIGIN = "https://dandegate.net";

const DANDEGATE_DOLL_TRANSFORM = {
  format: "png",
  width: 128,
  height: 128,
  crop: { left: 36, top: 0, width: 440, height: 440, referenceWidth: 512, referenceHeight: 512 },
};

const DANDEGATE_NO_CROP_CODES = new Set(["EaglettaSSR"]);

const PAGE_ALIASES = new Map([
  ["Biyoca", "Belka"],
  ["Charolic", "Krolik"],
  ["Clukay", "Klukai"],
  ["Dusevnyj", "Dushevnaya"],
  ["Lene", "Lainie"],
  ["Macqiato", "Makiatto"],
  ["Mishty", "Mechty"],
  ["NemesisSR", "Nemesis"],
  ["YooHee", "Yoohee"],
]);

function pageKey(value) {
  let decoded = String(value ?? "");
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the URL text when a remote sitemap contains malformed escaping.
  }
  return decoded.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function codeBase(code) {
  const value = String(code ?? "");
  const direct = PAGE_ALIASES.get(value);
  if (direct) return direct;
  const base = value.replace(/S{1,2}R$/i, "");
  return PAGE_ALIASES.get(base) ?? base;
}

export function parseDandegateSitemap(html) {
  return [...new Set(
    [...String(html ?? "").matchAll(/<loc>(https:\/\/dandegate\.net\/dolls\/[^<]+)<\/loc>/gi)]
      .map((match) => match[1]),
  )];
}

export function findDandegatePage(code, pageUrls) {
  const expected = pageKey(codeBase(code));
  return (pageUrls ?? []).find((url) => pageKey(String(url).split("/").pop()) === expected);
}

export function buildDandegateAssetSource(code, avatarUrl, pageUrl) {
  if (!code || !avatarUrl || !pageUrl) return undefined;
  return {
    sourceUrl: avatarUrl,
    targetPath: "doll/Avatar_Head_" + code + ".png",
    localIcon: "/images/doll/Avatar_Head_" + code + ".png",
    source: "dandegate",
    transform: DANDEGATE_NO_CROP_CODES.has(code)
      ? { format: "png", width: 128, height: 128 }
      : DANDEGATE_DOLL_TRANSFORM,
    sourcePage: pageUrl,
  };
}

export function selectDandegateSyncTargets(items = [], options = {}) {
  const refresh = options.refresh === true;
  return items.filter((item) => (
    item?.type === "doll"
    && item.code
    && item.assetSource?.frozen !== true
    && (refresh || item.assetSource?.source !== "dandegate")
  ));
}

export function classifyDandegateFailure(failure = {}) {
  const reason = String(failure.reason ?? failure.error ?? "");
  if (reason === "page_missing" || reason === "avatar_missing" || /^HTTP (404|410)\b/i.test(reason)) {
    return "source_pending";
  }
  if (/^HTTP (408|425|429|5\d\d)\b/i.test(reason) || /timed? ?out|ETIMEDOUT|ECONN|failed after \d+ attempts/i.test(reason)) {
    return "transient_error";
  }
  return "hard_failure";
}

export async function fetchDandegateAssetSources(items, options = {}) {
  const proxyUrl = options.proxyUrl;
  const targets = (items ?? []).filter((item) => item.type === "doll" && item.code && !item.assetSource?.frozen);
  if (!targets.length) return { updates: [], failures: [], pages: [] };

  const attempts = Math.max(1, Number(options.attempts) || 4);
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 20000);
  const sitemapUrl = DANDegate_ORIGIN + "/sitemap.xml";
  const sitemapResponse = await fetchWithRetry(sitemapUrl, {
    proxyUrl,
    fetchImpl: options.fetchImpl,
    attempts,
    signalFactory: () => AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "yoohee-tracker-resource-updater/1.0" },
  });
  if (!sitemapResponse.ok) throw new Error("Dandegate sitemap failed: HTTP " + sitemapResponse.status);
  const pages = parseDandegateSitemap(await sitemapResponse.text());
  const result = [];
  const failures = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Number(options.concurrency) || 6, targets.length || 1));

  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= targets.length) return;
      const item = targets[index];
      const pageUrl = findDandegatePage(item.code, pages);
      if (!pageUrl) {
        failures.push({ id: item.id, code: item.code, reason: "page_missing", kind: "source_pending" });
        continue;
      }
      try {
        const response = await fetchWithRetry(pageUrl + "/skills", {
          proxyUrl,
          fetchImpl: options.fetchImpl,
          attempts,
          signalFactory: () => AbortSignal.timeout(timeoutMs),
          headers: { "user-agent": "yoohee-tracker-resource-updater/1.0" },
        });
        if (!response.ok) {
          const reason = "HTTP " + response.status;
          const kind = classifyDandegateFailure({ reason });
          failures.push({ id: item.id, code: item.code, pageUrl, reason, kind });
          continue;
        }
        const avatar = parseDandegateAvatarHtml(await response.text(), pageUrl + "/skills");
        if (!avatar) {
          failures.push({ id: item.id, code: item.code, pageUrl, reason: "avatar_missing", kind: "source_pending" });
          continue;
        }
        result.push({ id: item.id, assetSource: buildDandegateAssetSource(item.code, avatar.avatarUrl, pageUrl) });
      } catch (error) {
        const reason = String(error.message ?? error);
        failures.push({ id: item.id, code: item.code, pageUrl, reason, kind: classifyDandegateFailure({ reason }) });
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { updates: result, failures, pages };
}
