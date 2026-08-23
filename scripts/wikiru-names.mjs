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
