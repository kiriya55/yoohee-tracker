function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function clean(value) {
  const text = decodeHtml(value).replace(/\s+/g, " ").trim();
  if (!text || /^\d+$/.test(text)) return undefined;
  return text;
}

export function parseMccNameFromHtml(html, type) {
  const title = clean(String(html ?? "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  if (!title) return undefined;
  const withoutSite = title
    .replace(/\s+(?:少前2Wiki|MccWiki)(?:\s+.*)?$/i, "")
    .split("|")[0]
    .trim();
  const prefixes = type === "doll" ? ["人形:", "Doll:"] : type === "weapon" ? ["武器:", "Weapon:"] : [];
  for (const prefix of prefixes) {
    if (withoutSite.startsWith(prefix)) return clean(withoutSite.slice(prefix.length));
  }
  return clean(withoutSite);
}
