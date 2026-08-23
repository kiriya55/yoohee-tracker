import { fetchWithRetry } from "./fetch-with-retry.mjs";

const BBS_API_ORIGIN = "https://gf2-bbs-api.exiliumgf.com";

function validResponse(payload) {
  return payload && Number(payload.Code) === 0 && payload.data && typeof payload.data === "object";
}

export function parseBbsCategoryResponse(payload) {
  if (!validResponse(payload)) return undefined;
  const category = payload.data.information?.find((entry) => Number(entry.type) === 3);
  const titles = Array.isArray(category?.title) ? category.title : [];
  const doll = titles.find((entry) => Number(entry.id) === 1 || String(entry.name).includes("人形"));
  const weapon = titles.find((entry) => Number(entry.id) === 2 || String(entry.name).includes("武器"));
  if (!doll || !weapon) return undefined;
  return {
    dollCategoryId: Number(doll.id),
    weaponCategoryId: Number(weapon.id),
  };
}

export function parseBbsHandbookResponse(payload, type, sourceUrl) {
  if (!validResponse(payload) || !["doll", "weapon"].includes(type)) return [];
  const rows = Array.isArray(payload.data.list) ? payload.data.list : [];
  return rows.flatMap((row) => {
    const id = Number(type === "doll" ? row.hero_id : row.weapon_id);
    const cn = String(type === "doll" ? row.hero_name : row.weapon_name ?? "").trim();
    if (!Number.isFinite(id) || id <= 0 || !cn) return [];
    return [{ id, cn, type, sourceUrl }];
  });
}

async function postJson(path, body, proxyUrl) {
  const response = await fetchWithRetry(BBS_API_ORIGIN + path, {
    proxyUrl,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "yoohee-tracker-resource-updater/1.0",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("BBS " + path + " failed: HTTP " + response.status);
  return response.json();
}

async function main() {
  const argv = process.argv.slice(2);
  const proxyIndex = argv.indexOf("--proxy-url");
  const proxyUrl = proxyIndex >= 0 ? argv[proxyIndex + 1] : undefined;
  if (!argv.includes("--check")) {
    console.log("Use --check to fetch and print Exilium BBS parser counts.");
    return;
  }

  const categoryUrl = BBS_API_ORIGIN + "/wiki/category";
  const category = parseBbsCategoryResponse(await postJson("/wiki/category", {}, proxyUrl));
  if (!category) throw new Error("BBS category response did not expose doll and weapon handbook IDs");
  const [dolls, weapons] = await Promise.all([
    postJson("/wiki/handbook", { type: category.dollCategoryId, limit: 1000 }, proxyUrl),
    postJson("/wiki/handbook", { type: category.weaponCategoryId, limit: 1000 }, proxyUrl),
  ]);
  console.log("Exilium BBS categories: doll=" + category.dollCategoryId + ", weapon=" + category.weaponCategoryId);
  console.log("Exilium BBS dolls: " + parseBbsHandbookResponse(dolls, "doll", categoryUrl).length);
  console.log("Exilium BBS weapons: " + parseBbsHandbookResponse(weapons, "weapon", categoryUrl).length);
}

if (process.argv[1]?.endsWith("exilium-bbs.mjs")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
