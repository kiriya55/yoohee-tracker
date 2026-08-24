function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]+>/g, " "));
}

function cleanLine(value) {
  return stripTags(value).replace(/\s+/g, " ").trim();
}

function cleanJapaneseName(value) {
  return cleanLine(value).replace(/\s*[（(][^）)]*[）)]\s*$/u, "").trim();
}

export function parseWikiruCharacterDetailLinks(html, origin) {
  const links = [];
  const seen = new Set();
  const pattern = /<div\b[^>]*\bclass\s*=\s*(["'])[^"']*\bcharacter\b[^"']*\1[^>]*>[\s\S]*?<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\2/giu;
  for (const match of String(html ?? "").matchAll(pattern)) {
    const href = decodeHtml(match[3]);
    let parsed;
    try {
      parsed = new URL(href, origin);
    } catch {
      continue;
    }
    const rawPageName = parsed.search.startsWith("?") ? parsed.search.slice(1) : "";
    if (!rawPageName || rawPageName.includes("=") || rawPageName.startsWith("cmd")) continue;
    let pageName;
    try {
      pageName = decodeURIComponent(rawPageName.replace(/\+/g, " "));
    } catch {
      pageName = rawPageName;
    }
    if (!pageName || seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    links.push({ pageName, url: parsed.href });
  }
  return links;
}

export function isWikiruUnavailablePage(html) {
  const title = String(html ?? "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1] ?? "";
  return /runtime error|one moment, please|cf-chl-/iu.test(title + "\n" + String(html ?? "").slice(0, 2048));
}

export function extractWikiruNameRecord(html) {
  const row = String(html ?? "").match(
    /<th\b[^>]*>\s*名前\s*<\/th>\s*<td\b[^>]*>(?<value>[\s\S]*?)<\/td>/iu,
  );
  if (!row?.groups?.value) return undefined;

  const lines = row.groups.value
    .replace(/<br\b[^>]*>/giu, "\n")
    .split(/\r?\n/u)
    .map(cleanLine)
    .filter(Boolean);
  if (lines.length < 2) return undefined;

  const jp = cleanJapaneseName(lines[0]);
  const en = cleanLine(lines[1]);
  const cn = cleanLine(lines[2]);
  if (!jp || !en) return undefined;

  return {
    jp,
    en,
    ...(cn ? { cn } : {}),
  };
}
