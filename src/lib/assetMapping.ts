import mapping from "../asset-mapping.json";
import type { ResourceItem } from "../types";

const MCC_ORIGIN = "https://gf2.mcc.wiki";

export type AssetDescriptor = {
  sourceUrl: string;
  targetPath: string;
  localIcon: string;
  source: string;
  frozen?: boolean;
};

type AssetOverride = {
  sourceFile?: string;
  sourceUrl?: string;
  targetFile: string;
  source?: string;
  frozen?: boolean;
};

function overrideFor(item: ResourceItem): AssetOverride | undefined {
  if (!item.type || !item.code) return undefined;
  return (mapping.overrides as Record<string, AssetOverride>)[item.type + ":" + item.code];
}

export function assetPathFor(item: ResourceItem): string | undefined {
  if (!item.type || !item.code) return undefined;
  const override = overrideFor(item);
  if (item.type === "doll") {
    return "doll/" + (override?.targetFile ?? "Avatar_Head_" + item.code + ".png");
  }
  if (item.type === "weapon") {
    return "weapon/" + (override?.targetFile ?? item.code + "_1024.png");
  }
  return undefined;
}

export function buildAssetDescriptor(item: ResourceItem): AssetDescriptor | undefined {
  if (!item.type || !item.code) return undefined;
  const targetPath = assetPathFor(item);
  if (!targetPath) return undefined;
  const override = overrideFor(item);
  const sourceFile = override?.sourceFile ?? targetPath.split("/").pop();
  const folder = item.type === "doll" ? "doll" : "weapon";
  const sourceUrl = override?.sourceUrl
    ?? (sourceFile ? MCC_ORIGIN + "/image/" + folder + "/" + encodeURIComponent(sourceFile) : undefined);
  if (!sourceUrl) return undefined;
  return {
    sourceUrl,
    targetPath,
    localIcon: "/images/" + targetPath,
    source: override?.source ?? "mcc-wiki",
    ...(override?.frozen ? { frozen: true } : {}),
  };
}
