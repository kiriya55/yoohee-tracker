const FIELDS = ["cn", "en", "jp"];

const NORMAL_SOURCES = {
  cn: new Set(["mcc-wiki"]),
  en: new Set(["gfl2.help", "gfl2.help-banners", "gfl2.help-weapons"]),
  jp: new Set(["wikiru", "wikiru-detail"]),
};

const BOOTSTRAP_SOURCES = new Set([
  "exilium-bbs-bootstrap",
  "wikiru-recovery",
]);

function cleanName(value) {
  if (typeof value !== "string") return undefined;
  const name = value.replace(/\s+/g, " ").trim();
  if (!name || /^\d+$/.test(name)) return undefined;
  return name;
}

function isAllowedSource(field, source, mode) {
  if (NORMAL_SOURCES[field]?.has(source)) return true;
  return mode === "bootstrap" && BOOTSTRAP_SOURCES.has(source);
}

function addAlias(aliases, id, value) {
  const clean = cleanName(value);
  if (!clean) return;
  const list = aliases[id] ?? [];
  if (!list.includes(clean)) list.push(clean);
  aliases[id] = list;
}

function looksMojibake(value) {
  return typeof value === "string" && (value.includes("\uFFFD") || /(?:Ã.|Â.)/.test(value));
}

export function mergeAuthoritativeNames(entries, candidates, options = {}) {
  const mode = options.mode === "bootstrap" ? "bootstrap" : "normal";
  const names = structuredClone(entries);
  const sources = {};
  const aliases = {};
  const changes = { added: 0, overwritten: 0, ignored: 0 };
  const missing = [];
  const failures = Array.isArray(options.failures) ? [...options.failures] : [];

  for (const [id, entry] of Object.entries(names)) {
    for (const field of FIELDS) {
      const candidate = candidates?.[field]?.get(id);
      if (!candidate || !isAllowedSource(field, candidate.source, mode)) {
        missing.push({ id, field });
        if (candidate) changes.ignored += 1;
        continue;
      }

      const value = cleanName(candidate.value);
      if (!value) {
        missing.push({ id, field });
        continue;
      }

      const previous = cleanName(entry[field]);
      if (previous && previous !== value) {
        addAlias(aliases, id, previous);
        changes.overwritten += 1;
      } else if (!previous) {
        changes.added += 1;
      }
      entry[field] = value;
      sources[id] = sources[id] ?? {};
      sources[id][field] = {
        value,
        source: candidate.source,
        url: candidate.url,
      };
    }
  }

  return { names, sources, aliases, changes, missing, failures };
}

export function validateAuthoritativeNames(index, sources, options = {}) {
  const requiredFields = options.requiredFields ?? ["cn"];
  const missing = [];
  const conflicts = [];
  const invalidEncoding = [];

  for (const [id, item] of Object.entries(index ?? {})) {
    for (const field of requiredFields) {
      const value = cleanName(item?.[field]);
      if (!value || looksMojibake(item?.[field])) missing.push(id + "." + field);
      if (looksMojibake(item?.[field])) invalidEncoding.push(id + "." + field);
    }
    for (const [field, source] of Object.entries(sources?.[id] ?? {})) {
      if (source?.value !== item?.[field]) conflicts.push(id + "." + field);
    }
  }

  return {
    ok: missing.length === 0 && conflicts.length === 0 && invalidEncoding.length === 0,
    missing,
    conflicts,
    invalidEncoding,
  };
}
