// Keep diagnostic announcements out of publish decisions, without discarding
// unrecognized schedules (which may be new kinds of real gacha banners).
export function relevantTimesets(timesets) {
  return (timesets ?? []).filter((entry) => {
    if (Number(entry.poolType) > 0 || entry.upItemIds?.length) return true;
    return !/illustration contest|outfit|odd one out/i.test(entry.name ?? "");
  });
}

export function relevantSignals(signals) {
  return Object.fromEntries(Object.entries(signals ?? {}).map(([server, signal]) => [
    server,
    Object.fromEntries(Object.entries(signal ?? {}).filter(([key]) => key !== "sourceNoticeIds")),
  ]));
}

function withoutTimestamps(value) {
  if (Array.isArray(value)) return value.map(withoutTimestamps);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => key !== "verifiedAt" && key !== "generatedAt")
      .map((key) => [key, withoutTimestamps(value[key])]));
  }
  return value;
}

export function comparableResourceIndex(index) {
  const { timesetHash, ...content } = index;
  return withoutTimestamps({
    ...content,
    updateSignals: relevantSignals(index.updateSignals),
    timesets: relevantTimesets(index.timesets).slice().sort((a, b) => String(a.key).localeCompare(String(b.key))),
  });
}

export function preserveResourceTimestamps(previous, candidate) {
  for (const [id, item] of Object.entries(candidate.items ?? {})) {
    const prior = previous.items?.[id];
    if (prior && JSON.stringify(withoutTimestamps(prior)) === JSON.stringify(withoutTimestamps(item))) {
      if (prior.verifiedAt === undefined) delete item.verifiedAt;
      else item.verifiedAt = prior.verifiedAt;
    }
  }
  if (JSON.stringify(comparableResourceIndex(previous)) === JSON.stringify(comparableResourceIndex(candidate))) {
    if (previous.generatedAt === undefined) delete candidate.generatedAt;
    else candidate.generatedAt = previous.generatedAt;
  }
  return candidate;
}
