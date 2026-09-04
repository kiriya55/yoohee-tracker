function isHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isAvatarPendingMarker(item) {
  return Boolean(
    item
    && item.type === "doll"
    && item.code
    && item.avatarPending === true,
  );
}

export function hasSafeRemoteAvatarFallback(item) {
  return Boolean(item && isHttpUrl(item.iconUrl));
}

export function canMarkAvatarPending(item) {
  return Boolean(
    item
    && item.type === "doll"
    && item.code
    && hasSafeRemoteAvatarFallback(item),
  );
}

export function isAvatarPendingItem(item) {
  return isAvatarPendingMarker(item) && hasSafeRemoteAvatarFallback(item);
}

export function markAvatarPending(item, failure, markedAt) {
  if (!canMarkAvatarPending(item)) {
    throw new Error(`Doll ${item?.id ?? "unknown"} has no safe remote avatar fallback`);
  }
  item.avatarPending = true;
  item.avatarPendingReason = String(failure?.reason ?? "avatar_missing");
  if (failure?.pageUrl) item.avatarPendingPageUrl = failure.pageUrl;
  else delete item.avatarPendingPageUrl;
  item.avatarPendingSince = item.avatarPendingSince ?? markedAt;
  delete item.localIcon;
  return item;
}

export function clearAvatarPendingMarker(item) {
  delete item.avatarPending;
  delete item.avatarPendingReason;
  delete item.avatarPendingPageUrl;
  delete item.avatarPendingSince;
  return item;
}
