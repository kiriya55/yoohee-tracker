import { createHash } from "node:crypto";

function isoTime(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 100000000000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function sortedNumbers(values) {
  return [...new Set((values ?? []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
}

function bannerTimeset(server, banner) {
  const poolId = Number(banner.pool_id ?? banner.poolId ?? banner.id);
  const poolType = Number(banner.pool_type ?? banner.poolType ?? 0);
  if (!Number.isFinite(poolId) || !Number.isFinite(poolType)) return undefined;
  return {
    key: String(server) + ":" + String(poolId),
    server: String(server),
    poolId,
    poolType: poolType || undefined,
    name: String(banner.name ?? "").trim() || undefined,
    startTime: isoTime(banner.start_time ?? banner.startTime),
    endTime: isoTime(banner.end_time ?? banner.endTime),
    upItemIds: sortedNumbers(banner.up_item_ids ?? banner.upItemIds ?? banner.upItems),
    source: "exilium",
  };
}

export function normalizeTimesets(server, payload) {
  return (payload?.banner ?? [])
    .map((banner) => bannerTimeset(server, banner))
    .filter(Boolean)
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function computeTimesetHash(timesets) {
  const stable = [...(timesets ?? [])]
    .map((timeset) => ({
      key: timeset.key,
      server: timeset.server,
      poolId: timeset.poolId,
      poolType: timeset.poolType,
      name: timeset.name,
      startTime: timeset.startTime,
      endTime: timeset.endTime,
      upItemIds: sortedNumbers(timeset.upItemIds),
      source: timeset.source,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function mergeServerResourceIndexes(indexes) {
  const items = {};
  const servers = new Set();
  const updateSignals = {};
  const timesets = [];

  for (const index of indexes ?? []) {
    for (const server of index.servers ?? []) servers.add(String(server));
    Object.assign(updateSignals, index.updateSignals ?? {});
    timesets.push(...(index.timesets ?? []));
    for (const [id, incoming] of Object.entries(index.items ?? {})) {
      const current = items[id];
      if (!current) {
        items[id] = {
          ...incoming,
          servers: [...new Set(incoming.servers ?? (incoming.server ? [incoming.server] : []))].sort(),
        };
        continue;
      }
      items[id] = {
        ...current,
        ...incoming,
        servers: [...new Set([
          ...(current.servers ?? []),
          ...(current.server ? [current.server] : []),
          ...(incoming.servers ?? []),
          ...(incoming.server ? [incoming.server] : []),
        ])].sort(),
      };
    }
  }

  return {
    format: "gf2-resource-index",
    version: Math.max(...(indexes ?? []).map((index) => Number(index.version) || 1), 1),
    source: "exilium-events-and-mcc-wiki",
    servers: [...servers].sort(),
    updateSignals,
    items,
    timesets: timesets.sort((a, b) => String(a.key).localeCompare(String(b.key))),
  };
}

export function findUniqueTimeset(timesets, poolType, records) {
  const itemIds = new Set((records ?? []).map((record) => Number(record.itemId)).filter(Number.isFinite));
  const matches = (timesets ?? []).filter((timeset) => {
    if (Number(timeset.poolType) !== Number(poolType)) return false;
    const upIds = new Set(timeset.upItemIds ?? []);
    return upIds.size === 0 || [...itemIds].some((id) => upIds.has(id));
  });
  return matches.length === 1 ? matches[0] : undefined;
}
