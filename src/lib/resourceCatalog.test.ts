import { describe, expect, it } from "vitest";
// The production helper is an ESM JavaScript module used directly by Node scripts.
// @ts-expect-error TypeScript does not infer declarations for files outside the src project.
import { buildMccImageUrl, findResourceCatalogChanges, resourceIdentity, selectResourceCatalogUpdates } from "../../scripts/resource-catalog.mjs";

const doll = {
  id: 1071,
  type: "doll",
  code: "BastiSSR",
  iconUrl: "https://gf2.mcc.wiki/image/doll/Avatar_Head_BastiSSR.png",
};

describe("resource catalog", () => {
  it("uses the Wiki bust image for Lind because the generic head image is missing", () => {
    expect(buildMccImageUrl("doll", "LindSSR")).toBe(
      "https://gf2.mcc.wiki/image/doll/Avatar_Bust_LindSSR.png",
    );
  });

  it("uses only image identity fields", () => {
    expect(resourceIdentity({ ...doll, name: "changed", server: "darkwinter" })).toBe(resourceIdentity(doll));
  });

  it("detects additions and changed image identities", () => {
    const existing = { "1071": doll };

    expect(findResourceCatalogChanges(existing, [doll])).toEqual({ added: [], changed: [], hasChanges: false });
    expect(
      findResourceCatalogChanges(existing, [
        doll,
        { id: 1072, type: "doll", code: "NewSSR", iconUrl: "https://example.test/new.png" },
      ]).added,
    ).toEqual(["1072"]);
    expect(findResourceCatalogChanges(existing, [{ ...doll, code: "BastiV2SSR" }]).changed).toEqual(["1071"]);
  });

  it("retains upstream-missing historical items without triggering", () => {
    expect(findResourceCatalogChanges({ "1071": doll }, [])).toEqual({ added: [], changed: [], hasChanges: false });
  });

  it("selects only added and changed items for probing", () => {
    const changed = { ...doll, iconUrl: "https://example.test/Basti-v2.png" };
    const added = { id: 1072, type: "doll", code: "NewSSR", iconUrl: "https://example.test/New.png" };

    expect(selectResourceCatalogUpdates({ "1071": doll }, [changed, added])).toEqual([changed, added]);
    expect(selectResourceCatalogUpdates({ "1071": doll }, [doll])).toEqual([]);
  });
});
