const MCC_ORIGIN = "https://gf2.mcc.wiki";

const MCC_IMAGE_OVERRIDES = new Map([
  ["doll:LindSSR", `${MCC_ORIGIN}/image/doll/Avatar_Bust_LindSSR.png`],
]);

export function buildMccImageUrl(type, code) {
  const override = MCC_IMAGE_OVERRIDES.get(`${type}:${code}`);
  if (override) return override;
  if (type === "doll") return `${MCC_ORIGIN}/image/doll/Avatar_Head_${encodeURIComponent(code)}.png`;
  if (type === "weapon") return `${MCC_ORIGIN}/image/weapon/${encodeURIComponent(code)}_1024.png`;
  return undefined;
}

export function resourceIdentity(item) {
  return JSON.stringify([
    Number(item?.id),
    String(item?.type ?? ""),
    String(item?.code ?? ""),
    String(item?.iconUrl ?? ""),
  ]);
}

export function findResourceCatalogChanges(existingItems = {}, incomingItems = []) {
  const added = [];
  const changed = [];

  for (const item of incomingItems) {
    const id = String(item.id);
    const current = existingItems[id];
    if (!current) added.push(id);
    else if (resourceIdentity(current) !== resourceIdentity(item)) changed.push(id);
  }

  return {
    added,
    changed,
    hasChanges: added.length > 0 || changed.length > 0,
  };
}

export function selectResourceCatalogUpdates(existingItems = {}, incomingItems = []) {
  return incomingItems.filter((item) => {
    const current = existingItems[String(item.id)];
    return !current || resourceIdentity(current) !== resourceIdentity(item);
  });
}
