import { describe, expect, it } from "vitest";
import data from "../i18n.json";
import { localizeMessage } from "./i18n";

describe("i18n catalog", () => {
  it("keeps identical, non-empty UI keys for every locale", () => {
    const baseline = Object.keys(data.ui.zh).sort();
    for (const locale of ["en", "jp"] as const) {
      expect(Object.keys(data.ui[locale]).sort()).toEqual(baseline);
      expect(Object.values(data.ui[locale]).every((value) => value.trim().length > 0)).toBe(true);
    }
  });

  it("localizes structured errors and parameters", () => {
    expect(localizeMessage("en", { key: "sqliteMissingColumns", values: { table: "records" } })).toContain("records");
    expect(localizeMessage("jp", { key: "remoteMissingUid" })).toBe("UIDを入力してください。");
  });
});
