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
  it("uses the Dandegate Lind source and the canonical Head target", () => {
    expect(buildMccImageUrl("doll", "LindSSR")).toBe(
      "https://cdn.dandegate.net/dolls/lind/249a546c1bc34c6e201a3fb17c6b06fac85329929019d67fd8e3ef44c2c871b0.webp",
    );
  });

  it("uses only image identity fields", () => {
    expect(resourceIdentity({ ...doll, name: "changed", server: "darkwinter" })).toBe(resourceIdentity(doll));
  });

  it("detects additions and changed stable identities", () => {
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

  it("ignores image source changes in stable identity checks", () => {
    expect(resourceIdentity({ ...doll, iconUrl: "https://example.test/Basti-v2.png" })).toBe(resourceIdentity(doll));
  });

  it("selects only added and changed catalog items", () => {
    const changed = { ...doll, code: "BastiV2SSR" };
    const added = { id: 1072, type: "doll", code: "NewSSR", iconUrl: "https://example.test/New.png" };

    expect(selectResourceCatalogUpdates({ "1071": doll }, [changed, added])).toEqual([changed, added]);
    expect(selectResourceCatalogUpdates({ "1071": doll }, [doll])).toEqual([]);
  });
});
