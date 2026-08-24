import fs from "node:fs";
import { fileURLToPath } from "node:url";

const MCC_ORIGIN = "https://gf2.mcc.wiki";
const mapping = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../src/asset-mapping.json", import.meta.url)), "utf8"));

function overrideFor(type, code) {
  return mapping.overrides?.[type + ":" + code];
}

export function buildAssetDescriptor(type, code) {
  if (!type || !code) return undefined;
  const override = overrideFor(type, code);
  const folder = type === "doll" ? "doll" : type === "weapon" ? "weapon" : undefined;
  if (!folder) return undefined;
  const targetFile = override?.targetFile ?? (type === "doll" ? "Avatar_Head_" + code + ".png" : code + "_1024.png");
  const targetPath = folder + "/" + targetFile;
  const defaultSourceUrl = type === "weapon"
    ? MCC_ORIGIN + "/static/image/weapon/" + encodeURIComponent(override?.sourceFile ?? targetFile)
    : MCC_ORIGIN + "/image/" + folder + "/" + encodeURIComponent(override?.sourceFile ?? targetFile);
  return {
    sourceUrl: override?.sourceUrl ?? defaultSourceUrl,
    targetPath,
    localIcon: "/images/" + targetPath,
    source: override?.source ?? "mcc-wiki",
    ...(override?.frozen ? { frozen: true } : {}),
  };
}
