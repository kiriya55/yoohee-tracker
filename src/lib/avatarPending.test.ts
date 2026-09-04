// @ts-nocheck Node-only unit test; the application tsconfig intentionally excludes Node types.
import { describe, expect, it } from "vitest";
import {
  canMarkAvatarPending,
  clearAvatarPendingMarker,
  isAvatarPendingItem,
  markAvatarPending,
} from "../../scripts/avatar-pending.mjs";
import { isAvatarPending } from "../../scripts/sync-miniprogram-resources.mjs";

function pendingDoll() {
  return {
    id: 1082,
    type: "doll",
    code: "CeciliaSSR",
    iconUrl: "https://gf2.mcc.wiki/static/thumbnail/doll/Avatar_Half_CeciliaSSR.png",
    localIcon: "/images/doll/Avatar_Head_CeciliaSSR.png",
  };
}

describe("avatarPending marker", () => {
  it("requires a coded doll with a safe remote thumbnail fallback", () => {
    expect(canMarkAvatarPending(pendingDoll())).toBe(true);
    expect(canMarkAvatarPending({ ...pendingDoll(), type: "weapon" })).toBe(false);
    expect(canMarkAvatarPending({ ...pendingDoll(), iconUrl: undefined })).toBe(false);
    expect(canMarkAvatarPending({ ...pendingDoll(), iconUrl: "javascript:alert(1)" })).toBe(false);
  });

  it("marks a pending doll while preserving its fallback and first-seen time", () => {
    const item = pendingDoll();
    const failure = {
      id: 1082,
      code: "CeciliaSSR",
      reason: "avatar_missing",
      pageUrl: "https://dandegate.net/dolls/Cecilia",
    };

    markAvatarPending(item, failure, "2026-09-03T11:20:00.000Z");

    expect(item).toMatchObject({
      avatarPending: true,
      avatarPendingReason: "avatar_missing",
      avatarPendingPageUrl: "https://dandegate.net/dolls/Cecilia",
      avatarPendingSince: "2026-09-03T11:20:00.000Z",
      iconUrl: "https://gf2.mcc.wiki/static/thumbnail/doll/Avatar_Half_CeciliaSSR.png",
    });
    expect(item.localIcon).toBeUndefined();
    expect(isAvatarPendingItem(item)).toBe(true);
    expect(isAvatarPending(item)).toBe(true);

    markAvatarPending(item, failure, "2026-09-04T11:20:00.000Z");
    expect(item.avatarPendingSince).toBe("2026-09-03T11:20:00.000Z");
  });

  it("refuses to mark a doll when no safe fallback can be published", () => {
    expect(() => markAvatarPending(
      { id: 1082, type: "doll", code: "CeciliaSSR" },
      { reason: "avatar_missing" },
      "2026-09-03T11:20:00.000Z",
    )).toThrow(/no safe remote avatar fallback/i);
  });

  it("clears every marker field after the head avatar is published", () => {
    const item = {
      ...pendingDoll(),
      avatarPending: true,
      avatarPendingReason: "avatar_missing",
      avatarPendingPageUrl: "https://dandegate.net/dolls/Cecilia",
      avatarPendingSince: "2026-09-03T11:20:00.000Z",
    };

    clearAvatarPendingMarker(item);

    expect(item).not.toHaveProperty("avatarPending");
    expect(item).not.toHaveProperty("avatarPendingReason");
    expect(item).not.toHaveProperty("avatarPendingPageUrl");
    expect(item).not.toHaveProperty("avatarPendingSince");
  });

  it("never lets a weapon bypass R2 validation as avatar-pending", () => {
    expect(isAvatarPending({ id: 1, type: "weapon", code: "Weapon_X_5", avatarPending: true })).toBe(false);
    expect(isAvatarPending({ id: 1, type: "doll", code: "X" })).toBe(false);
    expect(isAvatarPending(null)).toBe(false);
  });
});
