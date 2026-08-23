import type { ResourceIndex, ResourceItem } from "../types";
import { buildAssetDescriptor } from "./assetMapping";

export type ExiliumEventPayload = {
  notice?: Array<{
    id?: number;
    name?: string;
    start_time?: number;
    end_time?: number;
    content?: string;
  }>;
  banner?: Array<{
    id?: number;
    name?: string;
    start_time?: number;
    end_time?: number;
  }>;
};

export type ServerUpdateSignals = {
  server: string;
  newDolls: string[];
  newWeapons: string[];
  rateUpNames: string[];
  sourceNoticeIds: number[];
};

type ResourceBuildOptions = {
  server?: string;
  verifiedAt?: string;
};

type ImageBuildInput = {
  type?: string;
  code?: string;
};

function codeToName(code: string): string {
  return code.replace(/S{1,2}R$/i, "").replace(/_5$|_4$|_3$|_2$/, "");
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractBracketNames(section: string): string[] {
  return unique([...section.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]));
}

function extractSection(text: string, startLabel: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes(startLabel));
  if (start < 0) return "";

  const section: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (/^-\s+[^-\n]+-\s*$/.test(line)) break;
    if (/^(Rate Up Event|Limited-Time Rate Up Event)\b/i.test(line)) break;
    section.push(line);
  }
  return section.join("\n");
}

export function extractServerUpdateSignals(server: string, payload: ExiliumEventPayload): ServerUpdateSignals {
  const newDolls: string[] = [];
  const newWeapons: string[] = [];
  const rateUpNames: string[] = [];
  const sourceNoticeIds: number[] = [];

  for (const notice of payload.notice ?? []) {
    if (typeof notice.id === "number") sourceNoticeIds.push(notice.id);
    const content = stripHtml(notice.content ?? "");
    newDolls.push(...extractBracketNames(extractSection(content, "- New Doll -")));
    newWeapons.push(...extractBracketNames(extractSection(content, "- New Weapons -")));
  }

  for (const banner of payload.banner ?? []) {
    if (typeof banner.id === "number") sourceNoticeIds.push(banner.id);
    const name = banner.name ?? "";
    const rateUp = name.match(/^(.+?)\s+Is\s+Rate\s+Up!?$/i);
    if (rateUp?.[1]) rateUpNames.push(rateUp[1].replace(/^\[|\]$/g, ""));
  }

  return {
    server,
    newDolls: unique(newDolls),
    newWeapons: unique(newWeapons),
    rateUpNames: unique(rateUpNames),
    sourceNoticeIds: [...new Set(sourceNoticeIds)],
  };
}

export function buildMccImageUrl(item: ImageBuildInput): string | undefined {
  if (!item.code) return undefined;
  return buildAssetDescriptor({
    id: 0,
    type: item.type,
    code: item.code,
  })?.sourceUrl;
}

function objectBodies(text: string): string[] {
  const bodies: string[] = [];
  const objectPattern = /(?:let|const|var)\s+[A-Za-z_$][\w$]*\s*=\s*\{\}\s*;([\s\S]*?)(?=(?:let|const|var)\s+[A-Za-z_$][\w$]*\s*=\s*\{\}\s*;|$)/g;
  for (const match of text.matchAll(objectPattern)) {
    bodies.push(match[1]);
  }
  return bodies;
}

function stringValue(body: string, key: string): string | undefined {
  const dot = new RegExp(`\\.${key}\\s*=\\s*"([^"]+)"`).exec(body);
  if (dot?.[1]) return dot[1];
  const bracket = new RegExp(`\\["${key}"\\]\\s*=\\s*"([^"]+)"`).exec(body);
  return bracket?.[1];
}

function numberValue(body: string, key: string): number | undefined {
  const dot = new RegExp(`\\.${key}\\s*=\\s*(\\d+)`).exec(body);
  const bracket = new RegExp(`\\["${key}"\\]\\s*=\\s*(\\d+)`).exec(body);
  const value = Number(dot?.[1] ?? bracket?.[1]);
  return Number.isFinite(value) ? value : undefined;
}

export function extractExiliumChunkResources(text: string, options: ResourceBuildOptions = {}): ResourceItem[] {
  const items: ResourceItem[] = [];

  for (const body of objectBodies(text)) {
    const id = numberValue(body, "id");
    const rarity = numberValue(body, "rarity");
    const name = stringValue(body, "name");
    const dollCode = stringValue(body, "avatar");
    const weaponCode = stringValue(body, "imageCode");
    const code = dollCode ?? weaponCode;
    const type = dollCode ? "doll" : weaponCode ? "weapon" : undefined;
    if (!id || !code || !type) continue;

    const iconUrl = buildMccImageUrl({ type, code });
    const item: ResourceItem = {
      id,
      name: name && !/^\d+$/.test(name) ? name : codeToName(code),
      type,
      rarity,
      code,
      server: options.server,
      iconUrl,
      imageSource: iconUrl ? "mcc-wiki" : undefined,
    };
    if (options.verifiedAt) item.verifiedAt = options.verifiedAt;
    items.push(item);
  }

  return items;
}

function keepExistingString(existing?: string, incoming?: string): string | undefined {
  return existing || incoming;
}

export function mergeResourceIndexItems(existing: ResourceIndex | undefined, incomingItems: ResourceItem[]): ResourceIndex {
  const items: Record<string, ResourceItem> = { ...(existing?.items ?? {}) };
  for (const incoming of incomingItems) {
    const key = String(incoming.id);
    const current = items[key];
    items[key] = current
      ? {
          ...current,
          ...incoming,
          name: keepExistingString(current.name, incoming.name),
          icon: keepExistingString(current.icon, incoming.icon),
          iconUrl: keepExistingString(current.iconUrl, incoming.iconUrl),
          aliases: unique([...(current.aliases ?? []), ...(incoming.aliases ?? [])]),
        }
      : incoming;
  }

  return {
    format: "gf2-resource-index",
    version: Math.max(existing?.version ?? 1, 1),
    source: existing?.source ?? "exilium-events-and-mcc-wiki",
    generatedAt: new Date().toISOString(),
    items,
    pools: existing?.pools,
  };
}
