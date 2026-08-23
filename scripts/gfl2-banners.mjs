import { fetchWithRetry } from "./fetch-with-retry.mjs";

const GFL2_HELP_ORIGIN = "https://gfl2.help";

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function stripTags(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]*>/g, " "));
}

function cleanText(value) {
  return stripTags(value).replace(/\s+/g, " ").trim();
}

function dateToIso(value) {
  const date = new Date(value + " UTC");
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function parseDateRange(value) {
  const normalized = cleanText(value).replace(/[–—]/g, "-");
  const match = normalized.match(/^([A-Za-z]+ \d{1,2}, \d{4})\s*-\s*([A-Za-z]+ \d{1,2}, \d{4})$/);
  if (!match) return undefined;
  const startDate = dateToIso(match[1]);
  const endDate = dateToIso(match[2]);
  if (!startDate || !endDate) return undefined;
  return { startDate, endDate };
}

function unique(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

export function parseGfl2BannersHtml(html, sourceUrl) {
  const text = String(html ?? "");
  const starts = [...text.matchAll(/<div\s+class="banner-(current|past)\s+character-banner-card\b[^>]*>/gi)];
  const cards = [];

  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index].index;
    const end = starts[index + 1]?.index ?? text.length;
    const card = text.slice(start, end);
    const dateRange = card.match(/<div\s+class="date-range"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
    const dates = parseDateRange(dateRange);
    if (!dates) continue;
    const characterNames = unique(
      [...card.matchAll(/<div\s+class="banner-character-name"[^>]*>[\s\S]*?<b[^>]*>([\s\S]*?)<\/b>/gi)]
        .map((match) => match[1]),
    );
    if (!characterNames.length) continue;
    cards.push({
      sourceUrl,
      status: starts[index][1].toLowerCase(),
      ...dates,
      characterNames,
    });
  }

  return cards;
}

export function parseGfl2WeaponNames(html, sourceUrl) {
  const names = [];
  for (const match of String(html ?? "").matchAll(/<h6[^>]*>([\s\S]*?)<\/h6>/gi)) {
    const name = cleanText(match[1]);
    if (name && !names.some((candidate) => candidate.name === name)) {
      names.push({ name, sourceUrl });
    }
  }
  return names;
}

async function main() {
  const argv = process.argv.slice(2);
  const proxyIndex = argv.indexOf("--proxy-url");
  const proxyUrl = proxyIndex >= 0 ? argv[proxyIndex + 1] : undefined;
  const checkOnly = argv.includes("--check");
  if (!checkOnly) {
    console.log("Use --check to fetch and print gfl2.help parser counts.");
    return;
  }

  const bannersUrl = GFL2_HELP_ORIGIN + "/en/banners";
  const weaponsUrl = GFL2_HELP_ORIGIN + "/en/weapons";
  const [bannersResponse, weaponsResponse] = await Promise.all([
    fetchWithRetry(bannersUrl, { proxyUrl, headers: { "user-agent": "yoohee-tracker-resource-updater/1.0" } }),
    fetchWithRetry(weaponsUrl, { proxyUrl, headers: { "user-agent": "yoohee-tracker-resource-updater/1.0" } }),
  ]);
  if (!bannersResponse.ok || !weaponsResponse.ok) {
    throw new Error("gfl2.help returned " + bannersResponse.status + "/" + weaponsResponse.status);
  }
  const banners = parseGfl2BannersHtml(await bannersResponse.text(), bannersUrl);
  const weapons = parseGfl2WeaponNames(await weaponsResponse.text(), weaponsUrl);
  console.log("gfl2.help banners: " + banners.length + " cards");
  console.log("gfl2.help weapons: " + weapons.length + " names");
}

if (process.argv[1]?.endsWith("gfl2-banners.mjs")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
