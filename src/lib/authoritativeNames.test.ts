import { describe, expect, it } from "vitest";
// @ts-expect-error The merge policy is shared by the Node CLI.
import { mergeAuthoritativeNames, validateAuthoritativeNames } from "../../scripts/authoritative-names.mjs";

function baseEntries() {
  return {
    "1059": {
      id: "1059",
      code: "LindSSR",
      type: "doll",
      cn: "旧中文",
      en: "Lind",
      jp: "リンド",
    },
    "1060": {
      id: "1060",
      code: "PhaetusaSSR",
      type: "doll",
      cn: "帕埃图萨",
      en: "Phaetusa",
      jp: "パエトゥーサ",
    },
  };
}

describe("authoritative name merge", () => {
  it("lets the authoritative candidate replace an old value and records the alias", () => {
    const result = mergeAuthoritativeNames(baseEntries(), {
      cn: new Map([["1059", { value: "琳德", source: "mcc-wiki", url: "mcc://LindSSR" }]]),
      en: new Map([["1059", { value: "Lind", source: "gfl2.help", url: "gfl2://Lind" }]]),
      jp: new Map([["1059", { value: "リンド", source: "wikiru-detail", url: "wikiru://Lind" }]]),
    }, { mode: "normal" });

    expect(result.names["1059"].cn).toBe("琳德");
    expect(result.aliases["1059"]).toContain("旧中文");
    expect(result.sources["1059"].cn).toEqual({
      value: "琳德",
      source: "mcc-wiki",
      url: "mcc://LindSSR",
    });
    expect(result.changes.overwritten).toBe(1);
  });

  it("preserves a missing field but reports it instead of silently using another source", () => {
    const result = mergeAuthoritativeNames(baseEntries(), {
      cn: new Map(),
      en: new Map(),
      jp: new Map(),
    }, { mode: "normal" });

    expect(result.names["1059"].cn).toBe("旧中文");
    expect(result.missing).toContainEqual({ id: "1059", field: "cn" });
    expect(result.failures).toEqual([]);
  });

  it("accepts bootstrap recovery only in bootstrap mode", () => {
    const candidate = { value: "琳德", source: "exilium-bbs-bootstrap", url: "bbs://LindSSR" };
    const normal = mergeAuthoritativeNames(baseEntries(), {
      cn: new Map([["1059", candidate]]),
      en: new Map(),
      jp: new Map(),
    }, { mode: "normal" });
    const bootstrap = mergeAuthoritativeNames(baseEntries(), {
      cn: new Map([["1059", candidate]]),
      en: new Map(),
      jp: new Map(),
    }, { mode: "bootstrap" });

    expect(normal.names["1059"].cn).toBe("旧中文");
    expect(bootstrap.names["1059"].cn).toBe("琳德");
    expect(bootstrap.sources["1059"].cn.source).toBe("exilium-bbs-bootstrap");
  });

  it("ignores Dandegate candidates", () => {
    const result = mergeAuthoritativeNames(baseEntries(), {
      cn: new Map(),
      en: new Map([["1059", { value: "Lind from Dandegate", source: "dandegate", url: "dande://Lind" }]]),
      jp: new Map(),
    }, { mode: "normal" });

    expect(result.names["1059"].en).toBe("Lind");
    expect(result.missing).toContainEqual({ id: "1059", field: "en" });
  });

  it("rejects missing Chinese values, mojibake and mismatched source records", () => {
    const result = validateAuthoritativeNames({
      "1059": { id: "1059", cn: "琳德", en: "Lind", jp: "リンド" },
      "1060": { id: "1060", cn: "�", en: "Phaetusa", jp: "パエトゥーサ" },
    }, {
      "1059": { cn: { value: "旧中文", source: "mcc-wiki", url: "mcc://LindSSR" } },
    }, {
      requiredFields: ["cn"],
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("1060.cn");
    expect(result.invalidEncoding).toContain("1060.cn");
    expect(result.conflicts).toContain("1059.cn");
  });
});
