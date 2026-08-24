import { buildAssetDescriptor } from "./asset-mapping.mjs";

export function buildMccImageUrl(type, code) {
  return buildAssetDescriptor(type, code)?.sourceUrl;
}

export function resourceIdentity(item) {
  return JSON.stringify([
    Number(item?.id),
    String(item?.type ?? ""),
    String(item?.code ?? ""),
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
