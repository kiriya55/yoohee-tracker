// Pure helpers that keep the generated resource index stable across routine
// (unchanged-catalog) syncs. A scheduled run with no new content must not
// rewrite every item's verifiedAt or the top-level generatedAt, otherwise the
// job produces a noisy "update" commit every day.

import { computeTimesetHash } from "./timeset.mjs";

export const CATALOG_SIGNATURE_KEYS = ["type", "code", "name", "rarity", "iconUrl", "imageSource"];

// Volatile/downstream keys are intentionally excluded: verifiedAt changes every
// run, while localIcon / cn / en / jp / nameSources are added later by
// download-images and merge-i18n-names and are not part of the source catalog.
export function catalogSignature(item) {
  const entry = {};
  for (const key of CATALOG_SIGNATURE_KEYS) {
    if (item?.[key] !== undefined) entry[key] = item[key];
  }
  return JSON.stringify(entry);
}

export function sameJson(left, right) {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

export function findAvatarPendingIds(index) {
  return Object.values(index?.items ?? {})
    .filter((item) => item?.type === "doll" && item?.code && item?.avatarPending === true)
    .map((item) => String(item.id));
}

// Merge freshly fetched catalog items into an existing index.
// Returns the merged index plus metadata describing what changed.
export function mergeIndex(existing, incomingItems, metadata) {
  const items = { ...(existing?.items ?? {}) };
  let catalogChanged = !existing;
  for (const incoming of incomingItems) {
    const current = items[String(incoming.id)];
    if (current) {
      const unchanged = catalogSignature(current) === catalogSignature(incoming);
      if (!unchanged) catalogChanged = true;
      items[String(incoming.id)] = {
        ...current,
        ...incoming,
        // Keep the old verification time unless the catalog entry itself moved.
        verifiedAt: unchanged ? current.verifiedAt : incoming.verifiedAt,
        name: current.name || incoming.name,
        icon: current.icon || incoming.icon,
        iconUrl: current.type === "weapon" ? incoming.iconUrl : current.iconUrl || incoming.iconUrl,
        localIcon: current.localIcon || incoming.localIcon,
        assetPath: current.assetPath || incoming.assetPath,
        assetSource: current.type === "weapon" ? incoming.assetSource : current.assetSource || incoming.assetSource,
        imageSource: current.imageSource || incoming.imageSource,
        aliases: [...new Set([...(current.aliases ?? []), ...(incoming.aliases ?? [])].map(String))],
      };
    } else {
      catalogChanged = true;
      items[String(incoming.id)] = incoming;
    }
  }

  const incomingTimesetHash = metadata.timesetHash ?? computeTimesetHash(metadata.timesets);
  const scopedExistingTimesets = (existing?.timesets ?? []).filter((timeset) =>
    metadata.servers.includes(timeset.server),
  );
  const timesetChanged = incomingTimesetHash !== computeTimesetHash(scopedExistingTimesets);
  const scopedExistingSignals = Object.fromEntries(
    Object.entries(existing?.updateSignals ?? {}).filter(([server]) => metadata.servers.includes(server)),
  );
  const signalsChanged = !sameJson(metadata.updateSignals, scopedExistingSignals);
  const hasSubstantiveChange = catalogChanged || timesetChanged || signalsChanged;

  return {
    index: {
      format: "gf2-resource-index",
      version: Math.max(existing?.version ?? 1, 1),
      source: "exilium-events-and-mcc-wiki",
      generatedAt: hasSubstantiveChange || !existing?.generatedAt ? metadata.generatedAt : existing.generatedAt,
      servers: metadata.servers,
      updateSignals: metadata.updateSignals,
      timesets: metadata.timesets,
      timesetHash: metadata.timesetHash,
      items,
      pools: existing?.pools,
    },
    catalogChanged,
    timesetChanged,
    signalsChanged,
    hasSubstantiveChange,
  };
}

// Decide whether the freshly combined multi-server index differs from the
// previous one, for the purpose of refreshing the top-level generatedAt.
export function combinedIndexChanged(existing, combined, servers) {
  if (!existing) return true;
  const priorItems = existing.items ?? {};
  const catalogChanged = Object.values(combined.items ?? {}).some(
    (item) => catalogSignature(priorItems[String(item.id)]) !== catalogSignature(item),
  );
  const priorTimesets = (existing.timesets ?? []).filter((timeset) => servers.includes(timeset.server));
  const timesetChanged = combined.timesetHash !== computeTimesetHash(priorTimesets);
  const priorSignals = Object.fromEntries(
    Object.entries(existing.updateSignals ?? {}).filter(([server]) => servers.includes(server)),
  );
  const signalsChanged = !sameJson(combined.updateSignals, priorSignals);
  return catalogChanged || timesetChanged || signalsChanged;
}
