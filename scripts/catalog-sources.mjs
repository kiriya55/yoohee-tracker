import { fetchWithRetry } from "./fetch-with-retry.mjs";

const MCC_ORIGIN = "https://gf2.mcc.wiki";
const BBS_ORIGIN = "https://gf2-bbs-api.exiliumgf.com";

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function cleanText(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeJoinKey(value) {
  return cleanText(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[·・]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function validType(type) {
  return type === "doll" || type === "weapon";
}

function mccAssetSource(type, code, imagePath) {
  if (type === "weapon") {
    return {
      sourceUrl: MCC_ORIGIN + "/static/image/weapon/" + encodeURIComponent(code) + "_1024.png",
      source: "mcc-wiki",
    };
  }
  return {
    sourceUrl: new URL(imagePath, MCC_ORIGIN).href,
    source: "mcc-wiki",
  };
}

export function parseBbsCatalogResponse(payload, type, sourceUrl) {
  if (!validType(type) || Number(payload?.Code) !== 0) return [];
  const rows = Array.isArray(payload?.data?.list) ? payload.data.list : [];
  return rows.flatMap((row) => {
    const id = Number(type === "doll" ? row.hero_id : row.weapon_id);
    const cn = cleanText(type === "doll" ? row.hero_name : row.weapon_name);
    if (!Number.isFinite(id) || id <= 0 || !cn) return [];
    return [{ id, type, cn, sourceUrl }];
  });
}

export function parseMccCatalogHtml(html, type, sourceUrl) {
  if (!validType(type)) return [];
  const result = [];
  const cardPattern = new RegExp('<a href="/' + type + '/([^"]+)"[\\s\\S]*?</a>', "gi");
  for (const match of String(html ?? "").matchAll(cardPattern)) {
    const card = match[0];
    const imagePath = card.match(/<img[^>]+src="([^"]+\.png)"/i)?.[1];
    const cn = cleanText(card.match(/<div[^>]*class="[^"]*h-8[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/a>/i)?.[1]);
    const code = cleanText(match[1]);
    if (!code || !cn || !imagePath) continue;
    result.push({
      type,
      code,
      cn,
      sourceUrl,
      assetSource: mccAssetSource(type, code, imagePath),
    });
  }
  return result;
}

export function parseDandegateAvatarHtml(html, sourceUrl) {
  const text = String(html ?? "");
  const avatarUrl = text.match(/"avatarUrl"\s*:\s*"(https:\/\/cdn\.dandegate\.net\/dolls\/[^"]+?\.webp)"/i)?.[1];
  if (!avatarUrl) return undefined;
  const name = text.match(/"name"\s*:\s*"([^"]+)"/i)?.[1];
  return {
    name: cleanText(name),
    avatarUrl,
    sourceUrl,
  };
}

function assetPathFor(type, code) {
  return type === "doll"
    ? "doll/Avatar_Head_" + code + ".png"
    : "weapon/" + code + "_1024.png";
}

function localIconFor(type, code) {
  return "/images/" + assetPathFor(type, code);
}

function codeToName(code) {
  return String(code).replace(/S{1,2}R$/i, "").replace(/_5$|_4$|_3$|_2$/, "");
}

function appendUnique(values, next) {
  return [...new Set([...(values ?? []), ...(next ?? [])])];
}

export function mergeCatalogSources(bbsItems = [], mccItems = [], existingItems = {}) {
  const items = { ...existingItems };
  const added = [];
  const changed = [];
  const conflicts = [];
  const missing = [];
  const bbsByKey = new Map();

  for (const item of bbsItems) {
    const key = item.type + ":" + normalizeJoinKey(item.cn);
    const previous = bbsByKey.get(key);
    if (previous && previous.id !== item.id) {
      conflicts.push({ kind: "duplicate-bbs-name", key, ids: [previous.id, item.id] });
      continue;
    }
    bbsByKey.set(key, item);
  }

  const mccIds = new Set();
  for (const mcc of mccItems) {
    const key = mcc.type + ":" + normalizeJoinKey(mcc.cn);
    const bbs = bbsByKey.get(key);
    if (!bbs) {
      missing.push({ kind: "mcc-without-bbs", type: mcc.type, code: mcc.code, cn: mcc.cn });
      continue;
    }
    const id = String(bbs.id);
    if (mccIds.has(id)) {
      conflicts.push({ kind: "duplicate-mcc-id", id, code: mcc.code });
      continue;
    }
    mccIds.add(id);
    const incoming = {
      id: bbs.id,
      type: mcc.type,
      name: codeToName(mcc.code),
      cn: mcc.cn,
      code: mcc.code,
      iconUrl: mcc.assetSource?.sourceUrl,
      imageSource: mcc.assetSource?.source,
      assetPath: assetPathFor(mcc.type, mcc.code),
      assetSource: mcc.assetSource,
      localIcon: localIconFor(mcc.type, mcc.code),
      aliases: [],
      nameSources: {
        cn: { value: mcc.cn, source: "mcc-wiki", url: mcc.sourceUrl },
      },
    };
    const current = items[id];
    if (!current) {
      items[id] = incoming;
      added.push(id);
      continue;
    }
    const isFrozen = current.assetSource?.frozen === true;
    const next = {
      ...current,
      ...incoming,
      aliases: appendUnique(current.aliases, incoming.aliases),
    };
    if (isFrozen) {
      next.localIcon = current.localIcon;
      next.assetPath = current.assetPath;
      next.assetSource = current.assetSource;
      next.iconUrl = current.iconUrl;
      next.imageSource = current.imageSource;
    }
    if (current.type !== incoming.type || current.code !== incoming.code) changed.push(id);
    items[id] = next;
  }

  for (const bbs of bbsItems) {
    if (!mccIds.has(String(bbs.id))) {
      missing.push({ kind: "bbs-without-mcc", id: bbs.id, type: bbs.type, cn: bbs.cn });
    }
  }

  return { items, added, changed, conflicts, missing };
}

async function fetchJson(path, options = {}) {
  const response = await fetchWithRetry(BBS_ORIGIN + path, {
    proxyUrl: options.proxyUrl,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "yoohee-tracker-resource-updater/1.0",
    },
    body: JSON.stringify(options.body ?? {}),
  });
  if (!response.ok) throw new Error("BBS " + path + " failed: HTTP " + response.status);
  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetchWithRetry(url, {
    proxyUrl: options.proxyUrl,
    headers: { "user-agent": "yoohee-tracker-resource-updater/1.0" },
  });
  if (!response.ok) throw new Error("GET " + url + " failed: HTTP " + response.status);
  return response.text();
}

export async function fetchCompleteCatalog(options = {}) {
  const [bbsDollPayload, bbsWeaponPayload, mccDollHtml, mccWeaponHtml] = await Promise.all([
    fetchJson("/wiki/handbook", { ...options, body: { type: 1, limit: 1000 } }),
    fetchJson("/wiki/handbook", { ...options, body: { type: 2, limit: 1000 } }),
    fetchText(MCC_ORIGIN + "/doll", options),
    fetchText(MCC_ORIGIN + "/weapon", options),
  ]);
  const bbsItems = [
    ...parseBbsCatalogResponse(bbsDollPayload, "doll", BBS_ORIGIN + "/wiki/handbook"),
    ...parseBbsCatalogResponse(bbsWeaponPayload, "weapon", BBS_ORIGIN + "/wiki/handbook"),
  ];
  const mccItems = [
    ...parseMccCatalogHtml(mccDollHtml, "doll", MCC_ORIGIN + "/doll"),
    ...parseMccCatalogHtml(mccWeaponHtml, "weapon", MCC_ORIGIN + "/weapon"),
  ];
  const merged = mergeCatalogSources(bbsItems, mccItems, options.existingItems ?? {});
  return { ...merged, bbsItems, mccItems };
}
