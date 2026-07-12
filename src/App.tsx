import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Columns3,
  CloudDownload,
  ClipboardList,
  Database,
  Download,
  Eraser,
  Filter,
  FilePlus2,
  LockKeyhole,
  Plus,
  Save,
  Search,
  Upload,
  X,
} from "lucide-react";
import type { GachaRecord, GachaRecordDraft, ImportResult, RecordFilters } from "./types";
import { clearRecords, loadRecords, replaceRecords } from "./lib/db";
import { parseElmoBeaconDb } from "./lib/elmobeaconDb";
import { decryptExiliumBackupText } from "./lib/exiliumDecrypt";
import { parseImportText } from "./lib/importers";
import { exportPortable, mergeRecords } from "./lib/normalize";
import { describeOffRate, isOffRatePermanent } from "./lib/poolRules";
import { filterHighRarityEntries, paginate } from "./lib/presentation";
import { defaultEndpointForServer, fetchRemoteGachaRecords, parseFiddlerRequest, REMOTE_POOL_TYPES, REMOTE_SERVERS, serverOptionForId } from "./lib/remoteImport";
import { enrichRecords, getResourceImageUrl, getDisplayName, loadDefaultResourceIndex, loadResourceIndex, parseResourceIndexText, saveResourceIndex } from "./lib/resources";
import { computeGachaStats, formatDate, mergePoolsByType, pityColor, poolTypeLabel, computeCommanderProfile } from "./lib/stats";
import type { ResourceIndex } from "./types";
import type { RemoteServerId } from "./lib/remoteImport";
import { localizeMessage } from "./lib/i18n";

import i18nData from "./i18n.json";
const TRANSLATIONS = i18nData.ui;

function getPoolTypeKey(poolType: number): keyof typeof TRANSLATIONS.zh {
  if (poolType === 1) return "poolType1";
  if (poolType === 3) return "poolType3";
  if (poolType === 4) return "poolType4";
  if (poolType === 6) return "poolType6";
  if (poolType === 7) return "poolType7";
  if (poolType === 8 || poolType === 9) return "poolType8";
  return "poolTypeUnknown";
}

function translateCommanderTitle(title: string, locale: "zh" | "en" | "jp"): string {
  if (locale === "zh") return title;
  const map: Record<string, { en: string; jp: string }> = {
    "终极无敌至尊欧皇": { en: "Ultimate Sovereign Gacha God", jp: "至高天の豪運大統帥" },
    "万里挑一至尊欧皇": { en: "One-in-a-Million Gacha Legend", jp: "万世一系の豪運覇者" },
    "千里挑一尊贵欧皇": { en: "One-in-a-Thousand Gacha Elite", jp: "千里眼の強運指揮官" },
    "欧气满满大欧皇": { en: "Blessed Gacha Champion", jp: "幸運極まる指揮官" },
    "欧气附体小欧皇": { en: "Lucky Commander", jp: "幸運の指揮官" },
    "欧非守恒": { en: "Balanced Commander", jp: "平穏なる指揮官 (運勢平均)" },
    "欧气不足小非酋": { en: "Unlucky Commander", jp: "不運の指揮官" },
    "千里挑一大非酋": { en: "One-in-a-Thousand Pity Collector", jp: "千里一遇の薄幸指揮官" },
    "万里挑一大非酋": { en: "One-in-a-Million Pity Legend", jp: "万死一生の薄幸指揮官" },
    "超级至尊非酋": { en: "Ultimate Pity Sovereign", jp: "大爆死の深淵王" },
    "终极无敌至尊非酋": { en: "Ultimate Sovereign Pity God", jp: "極限終焉の大非酋" },
    "筹备中指挥官": { en: "Commander in Training", jp: "見習い指揮官" },
    "初露锋芒指挥官": { en: "Rising Commander", jp: "頭角を現す指揮官" }
  };
  return map[title]?.[locale] ?? title;
}

function translatePoolTitle(title: string, locale: "zh" | "en" | "jp"): string {
  if (locale === "zh") return title;
  const map: Record<string, { en: string; jp: string }> = {
    "至尊欧皇": { en: "Sovereign Lucky", jp: "至高の強運" },
    "尊贵欧皇": { en: "Elite Lucky", jp: "素晴らしい強運" },
    "大欧皇": { en: "Super Lucky", jp: "大いなる幸運" },
    "小欧皇": { en: "Lucky", jp: "幸運" },
    "欧非守恒": { en: "Balanced", jp: "運勢平均" },
    "小非酋": { en: "Unlucky", jp: "薄幸" },
    "大非酋": { en: "Very Unlucky", jp: "大いなる薄幸" },
    "超级非酋": { en: "Extremely Unlucky", jp: "極めて薄幸" },
    "至尊非酋": { en: "Sovereign Unlucky", jp: "最悪の不運" }
  };
  return map[title]?.[locale] ?? title;
}

function translateTag(tag: string, locale: "zh" | "en" | "jp"): string {
  if (locale === "zh") return tag;
  
  if (tag.includes("连不歪")) {
    const num = tag.match(/\d+/)?.[0] ?? "";
    if (tag.includes("人形")) {
      return locale === "en" ? `${num} Doll 50/50 Wins` : `限定人形${num}連すり抜けなし`;
    } else {
      return locale === "en" ? `${num} Weapon 50/50 Wins` : `限定軍備${num}連すり抜けなし`;
    }
  }
  if (tag.includes("连歪")) {
    const num = tag.match(/\d+/)?.[0] ?? "";
    if (tag.includes("人形")) {
      return locale === "en" ? `Lost 50/50 on Dolls ${num} times` : `限定人形${num}連すり抜け`;
    } else {
      return locale === "en" ? `Lost 50/50 on Weapons ${num} times` : `限定軍備${num}連すり抜け`;
    }
  }
  if (tag.includes("十连") && tag.includes("金")) {
    const num = tag.match(/\d+/)?.[0] ?? "";
    return locale === "en" ? `${num} SSRs in a 10-pull` : `10連${num}金`;
  }
  if (tag === "人形100%不歪") return locale === "en" ? "100% Doll 50/50 Win Rate" : "人形すり抜けなし (100%)";
  if (tag === "人形池极少歪") return locale === "en" ? "High Doll 50/50 Win Rate" : "人形ガチャすり抜け極少";
  if (tag === "军备100%不歪") return locale === "en" ? "100% Weapon 50/50 Win Rate" : "軍備すり抜けなし (100%)";
  if (tag === "军备池极少歪") return locale === "en" ? "High Weapon 50/50 Win Rate" : "軍備ガチャすり抜け極少";
  if (tag === "天选之子") return locale === "en" ? "The Chosen One" : "選ばれし者";
  if (tag === "运势爆表") return locale === "en" ? "Celestial Luck" : "天祐神助";
  if (tag === "欧皇附体") return locale === "en" ? "Aura of Luck" : "幸運のオーラ";
  if (tag === "非酋附体") return locale === "en" ? "Curse of Pity" : "不運の呪い";
  if (tag === "常吃保底") return locale === "en" ? "Pity Collector" : "天井の常連";
  if (tag === "运势不佳") return locale === "en" ? "Fading Luck" : "運勢低迷";
  if (tag === "新晋指挥官") return locale === "en" ? "Rookie Commander" : "新米指揮官";
  if (tag === "资深指挥官") return locale === "en" ? "Veteran Commander" : "ベテラン指揮官";
  
  return tag;
}

function getOffRateLabel(label: string | undefined, locale: "zh" | "en" | "jp"): string | undefined {
  if (!label) return undefined;
  if (locale === "en") return "Lose";
  if (locale === "jp") return "すり";
  return "歪";
}

const emptyFilters: RecordFilters = {
  poolType: "",
  rarity: "",
  source: "",
  query: "",
};

const cardPageSize = 40;
const tablePageSizeOptions = [10, 20, 50];
const manualPoolTypes = [1, 3, 4, 5, 6, 7];

type TableColumnKey = "global" | "item" | "rarity" | "pity" | "time" | "pool" | "source";
type TableColumns = Record<TableColumnKey, boolean>;

const defaultTableColumns: TableColumns = {
  global: true,
  item: true,
  rarity: true,
  pity: true,
  time: true,
  pool: false,
  source: false,
};

function rarityClass(rarity?: number): string {
  if ((rarity ?? 0) >= 5) return "rarity-5";
  if ((rarity ?? 0) >= 4) return "rarity-4";
  if ((rarity ?? 0) >= 3) return "rarity-3";
  return "rarity-low";
}

function rarityDotClass(rarity?: number): string {
  const r = rarity ?? 0;
  if (r >= 5) return "rarity-dot rarity-dot-5";
  if (r >= 4) return "rarity-dot rarity-dot-4";
  if (r >= 3) return "rarity-dot rarity-dot-3";
  if (r >= 2) return "rarity-dot rarity-dot-2";
  return "";
}

type RecentRecord = GachaRecord & { pity: number };

function annotatePity(records: GachaRecord[]): RecentRecord[] {
  let pity = 0;
  return [...records]
    .sort((a, b) => a.timestamp - b.timestamp || a.orderInSecond - b.orderInSecond)
    .map((record) => {
      pity = (record.rarity ?? 0) >= 5 ? 1 : pity + 1;
      return { ...record, pity };
    })
    .sort((a, b) => b.timestamp - a.timestamp || b.orderInSecond - a.orderInSecond);
}

function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function PaginationControls({
  page,
  pageCount,
  start,
  end,
  total,
  onPageChange,
  t,
}: {
  page: number;
  pageCount: number;
  start: number;
  end: number;
  total: number;
  onPageChange: (page: number) => void;
  t: (key: any) => string;
}) {
  return (
    <div className="pagination-bar">
      <span>
        {total ? `${start}-${end} / ${total}` : "0 / 0"}
      </span>
      <div className="pagination-buttons">
        <button type="button" title={t("firstPage")} onClick={() => onPageChange(1)} disabled={page <= 1}>
          <ChevronsLeft size={15} />
        </button>
        <button type="button" title={t("prevPage")} onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          <ChevronLeft size={15} />
        </button>
        <button type="button" title={t("nextPage")} onClick={() => onPageChange(page + 1)} disabled={page >= pageCount}>
          <ChevronRight size={15} />
        </button>
        <button type="button" title={t("lastPage")} onClick={() => onPageChange(pageCount)} disabled={page >= pageCount}>
          <ChevronsRight size={15} />
        </button>
      </div>
    </div>
  );
}

function ManualForm({ onAdd, t }: { onAdd: (record: GachaRecordDraft) => void; t: (key: any) => string }) {
  const [form, setForm] = useState({
    uid: "",
    server: "haoplay",
    poolType: "3",
    poolId: "",
    itemId: "",
    timestamp: Math.floor(Date.now() / 1000).toString(),
    itemName: "",
  });

  function update(name: string, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    onAdd({
      uid: form.uid,
      server: form.server,
      poolType: Number(form.poolType),
      poolId: Number(form.poolId),
      itemId: Number(form.itemId),
      timestamp: Number(form.timestamp),
      rarity: 5,
      itemName: form.itemName || undefined,
      source: "manual",
    });
  }

  return (
    <form className="manual-grid" onSubmit={submit}>
      <div className="manual-tabs wide">
        {manualPoolTypes.map((poolType) => (
          <button
            key={poolType}
            type="button"
            className={form.poolType === String(poolType) ? "active" : ""}
            onClick={() => update("poolType", String(poolType))}
          >
            {t(getPoolTypeKey(poolType))}
          </button>
        ))}
      </div>
      <label>
        {t("uidLabel")}
        <input value={form.uid} onChange={(event) => update("uid", event.target.value)} />
      </label>
      <label>
        {t("serverLabel")}
        <input value={form.server} onChange={(event) => update("server", event.target.value)} />
      </label>
      <label>
        {t("poolIdLabel")}
        <input required inputMode="numeric" value={form.poolId} onChange={(event) => update("poolId", event.target.value)} />
      </label>
      <label>
        {t("itemIdLabel")}
        <input required inputMode="numeric" value={form.itemId} onChange={(event) => update("itemId", event.target.value)} />
      </label>
      <label>
        {t("timestampLabel")}
        <input required inputMode="numeric" value={form.timestamp} onChange={(event) => update("timestamp", event.target.value)} />
      </label>
      <label>
        {t("nameLabel")}
        <input value={form.itemName} onChange={(event) => update("itemName", event.target.value)} />
      </label>
      <p className="manual-note wide">{t("manualNote")}</p>
      <button className="primary wide" type="submit">
        <Plus size={16} />
        {t("addRecord")}
      </button>
    </form>
  );
}

function RemoteImportForm({ onResult, t }: { onResult: (result: ImportResult) => void; t: (key: any) => string }) {
  const [uid, setUid] = useState("");
  const [serverId, setServerId] = useState<RemoteServerId>("haoplay-asia");
  const [endpoint, setEndpoint] = useState(defaultEndpointForServer("haoplay-asia"));
  const [requestText, setRequestText] = useState("");
  const [loading, setLoading] = useState(false);

  function selectServer(nextServerId: RemoteServerId) {
    setServerId(nextServerId);
    setEndpoint(defaultEndpointForServer(nextServerId));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    const parsed = parseFiddlerRequest(requestText);
    const activeServer = serverOptionForId(parsed.serverId ?? serverId);
    const result = await fetchRemoteGachaRecords({
      uid,
      server: activeServer.server,
      endpoint,
      headersText: requestText,
      poolTypes: REMOTE_POOL_TYPES,
    });
    onResult({ ...result, fileName: `${activeServer.label} ${t("serverPullFileNameSuffix")}` });
    if (parsed.serverId && parsed.serverId !== serverId) selectServer(parsed.serverId);
    setLoading(false);
  }

  return (
    <form className="remote-import-form" onSubmit={submit}>
      <div className="server-tabs">
        {REMOTE_SERVERS.map((server) => (
          <button
            key={server.id}
            type="button"
            className={serverId === server.id ? "active" : ""}
            onClick={() => selectServer(server.id)}
          >
            {server.label}
          </button>
        ))}
      </div>
      <div className="remote-grid">
        <label>
          {t("uidLabel")}
          <input required value={uid} onChange={(event) => setUid(event.target.value)} />
        </label>
        <label>
          {t("remoteUrlLabel")}
          <input required value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
        </label>
      </div>
      <label>
        {t("fiddlerRequestPlaceholder")}
        <textarea
          required
          rows={9}
          value={requestText}
          onChange={(event) => {
            const text = event.target.value;
            setRequestText(text);
            const parsed = parseFiddlerRequest(text);
            if (parsed.endpoint) setEndpoint(parsed.endpoint);
            if (parsed.serverId) setServerId(parsed.serverId);
          }}
        />
      </label>
      <p className="remote-note">
        {t("pullExplainText")}
      </p>
      <button className="primary wide" type="submit" disabled={loading}>
        <CloudDownload size={16} />
        {loading ? t("fetching") : t("fetchAndPreview")}
      </button>
    </form>
  );
}

function ManualEntryModal({ open, onClose, onAdd, t }: { open: boolean; onClose: () => void; onAdd: (record: GachaRecordDraft) => void; t: (key: any) => string }) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="manual-entry-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Manual</p>
            <h2 id="manual-entry-title">{t("manualModalTitle")}</h2>
          </div>
          <button type="button" className="icon-button" title={t("close")} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <ManualForm
          onAdd={(record) => {
            onAdd(record);
            onClose();
          }}
          t={t}
        />
      </div>
    </div>
  );
}

export default function App() {
  const [records, setRecords] = useState<GachaRecord[]>([]);
  const [filters, setFilters] = useState<RecordFilters>(emptyFilters);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [resourceIndex, setResourceIndex] = useState<ResourceIndex | undefined>(() => loadResourceIndex());
  const [preview, setPreview] = useState<{ added: number; duplicates: number } | null>(null);
  const [status, setStatus] = useState(TRANSLATIONS.zh.initialReadingStatus);
  const [cardPage, setCardPage] = useState(1);
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(10);
  const [tableFilter, setTableFilter] = useState<{ rarity: "" | "4" | "5"; query: string }>({ rarity: "", query: "" });
  const [visibleColumns, setVisibleColumns] = useState<TableColumns>(defaultTableColumns);
  const [activeView, setActiveView] = useState<"tracker" | "remote-import">("tracker");
  const [manualOpen, setManualOpen] = useState(false);
  const [locale, setLocale] = useState<"zh" | "en" | "jp">("zh");
  const [decryptingBackup, setDecryptingBackup] = useState(false);
  const [decryptedBackup, setDecryptedBackup] = useState<{ fileName: string; value: unknown } | null>(null);

  const t = useCallback((key: keyof typeof TRANSLATIONS.zh) => {
    return TRANSLATIONS[locale][key] ?? TRANSLATIONS.zh[key];
  }, [locale]);
  const tf = useCallback((key: keyof typeof TRANSLATIONS.zh, values: Record<string, string | number>) => {
    return t(key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ""));
  }, [t]);

  const getItemName = useCallback((itemId: number, defaultName?: string) => {
    const translated = getDisplayName(resourceIndex, itemId, locale === "zh" ? "cn" : locale);
    if (translated) return translated;
    return defaultName ?? String(itemId);
  }, [resourceIndex, locale]);

  const getLocalizedPoolLabel = useCallback((pool: any) => {
    const typeLabel = t(getPoolTypeKey(pool.poolType));
    const upNames = pool.fiveStarRecords
      .filter((r: any) => !isOffRatePermanent(r))
      .map((r: any) => getItemName(r.itemId, r.itemName));
    const uniqueUpNames = [...new Set(upNames)].slice(0, 3);
    const upLabel = uniqueUpNames.length ? uniqueUpNames.join(" / ") : `#${pool.poolId}`;
    return `${typeLabel} · ${upLabel}`;
  }, [getItemName, locale, t]);

  useEffect(() => {
    if (!resourceIndex) {
      loadDefaultResourceIndex().then((defaults) => {
        if (defaults) {
          saveResourceIndex(defaults);
          setResourceIndex(defaults);
        }
      });
    }
    loadRecords()
      .then((stored) => {
        setRecords(stored);
        setStatus(stored.length ? tf("localLoadedStatus", { count: stored.length }) : t("localEmptyStatus"));
      })
      .catch((error) => setStatus(tf("indexedDbLoadFailedStatus", { message: String(error) })));
  }, []);

  const enrichedRecords = useMemo(() => enrichRecords(records, resourceIndex), [records, resourceIndex]);
  const latestFiveStarDoll = useMemo(() => {
    const dolls = enrichedRecords.filter(r => (r.rarity ?? 0) >= 5 && r.itemId >= 1000 && r.itemId < 10000);
    if (dolls.length === 0) return null;
    const sorted = [...dolls].sort((a, b) => b.timestamp - a.timestamp || b.orderInSecond - a.orderInSecond);
    return sorted[0];
  }, [enrichedRecords]);
  const stats = useMemo(() => computeGachaStats(enrichedRecords), [enrichedRecords]);
  const commanderProfile = useMemo(() => computeCommanderProfile(enrichedRecords), [enrichedRecords]);
  const mergedPoolTypes = useMemo(() => mergePoolsByType(enrichedRecords), [enrichedRecords]);
  const [selectedPoolType, setSelectedPoolType] = useState<number>(-1);
  const selectedMerged = useMemo(
    () => mergedPoolTypes.find((m) => m.poolType === selectedPoolType) ?? mergedPoolTypes[0],
    [mergedPoolTypes, selectedPoolType],
  );
  const poolDetailLabels = useMemo(() => {
    if (!selectedMerged) return { eyebrow: "", title: "" };
    const poolType = selectedMerged.poolType;
    const label = t(getPoolTypeKey(poolType));

    if (poolType === 3 || poolType === 6) {
      return {
        eyebrow: "PICK UP · Doll",
        title: label,
      };
    }
    if (poolType === 4 || poolType === 7) {
      return {
        eyebrow: "PICK UP · Weapon",
        title: label,
      };
    }

    return {
      eyebrow: label,
      title: label,
    };
  }, [selectedMerged, t]);
  const sourceOptions = stats.sources.map((entry) => entry.source);
  const fiveStarPage = useMemo(
    () => paginate([...(selectedMerged?.fiveStarEntries ?? [])].sort((a, b) => b.globalIndex - a.globalIndex), cardPage, cardPageSize),
    [selectedMerged, cardPage],
  );
  const highRarityEntries = useMemo(
    () => filterHighRarityEntries((selectedMerged?.fiveStarEntries ?? []).concat(selectedMerged?.fourStarEntries ?? []), tableFilter),
    [selectedMerged, tableFilter],
  );
  const highRarityPage = useMemo(
    () => paginate(highRarityEntries, tablePage, tablePageSize),
    [highRarityEntries, tablePage, tablePageSize],
  );

  useEffect(() => {
    setCardPage(1);
    setTablePage(1);
  }, [selectedMerged?.poolType]);

  useEffect(() => {
    setTablePage(1);
  }, [tableFilter, tablePageSize]);

  async function readFile(file: File) {
    setDecryptedBackup(null);
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".db") && !lowerName.endsWith(".sqlite") && !lowerName.endsWith(".sqlite3")) {
      const text = await file.text();
      const resource = parseResourceIndexText(text);
      if (resource) {
        saveResourceIndex(resource);
        setResourceIndex(resource);
        setImportResult(null);
        setPreview(null);
        setStatus(tf("resourceIndexLoadedStatus", { count: Object.keys(resource.items).length }));
        return;
      }
      const result = parseImportText(text, file.name);
      setImportResult(result);
      if (result.ok) {
        const merged = mergeRecords(records, result.records);
        setPreview({ added: merged.added, duplicates: merged.duplicates });
        setStatus(tf("fileParsedStatus", { file: file.name, count: result.records.length, added: merged.added }));
      } else {
        setPreview(null);
        setStatus(result.errors[0] ? localizeMessage(locale, result.errors[0]) : t("importFailedStatus"));
      }
      return;
    }

    const result =
      await parseElmoBeaconDb(await file.arrayBuffer(), file.name);
    setImportResult(result);
    if (result.ok) {
      const merged = mergeRecords(records, result.records);
      setPreview({ added: merged.added, duplicates: merged.duplicates });
      setStatus(tf("fileParsedStatus", { file: file.name, count: result.records.length, added: merged.added }));
    } else {
      setPreview(null);
      setStatus(result.errors[0] ? localizeMessage(locale, result.errors[0]) : t("importFailedStatus"));
    }
  }

  async function decryptBackupFile(file: File) {
    setDecryptingBackup(true);
    setDecryptedBackup(null);
    setStatus(tf("decryptingStatus", { file: file.name }));
    try {
      const decrypted = await decryptExiliumBackupText(await file.text());
      const outputName = file.name.replace(/\.[^.]+$/, "") || "exilium";
      const decryptedFileName = `${outputName}-decrypted.json`;
      const result = parseImportText(JSON.stringify(decrypted), decryptedFileName);
      setImportResult(result);
      if (result.ok) {
        const merged = mergeRecords(records, result.records);
        setPreview({ added: merged.added, duplicates: merged.duplicates });
        setDecryptedBackup({ fileName: decryptedFileName, value: decrypted });
        setStatus(tf("decryptCompleteStatus", { count: result.records.length, added: merged.added }));
      } else {
        setPreview(null);
        setStatus(result.errors[0] ? localizeMessage(locale, result.errors[0]) : t("decryptNoRecordsStatus"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setImportResult({
        ok: false,
        fileName: file.name,
        format: "exilium-encrypted",
        records: [],
        errors: [{ key: "remoteFetchFailed", detail: message }],
      });
      setPreview(null);
      setStatus(tf("decryptFailedStatus", { message }));
    } finally {
      setDecryptingBackup(false);
    }
  }

  async function commitImport() {
    if (!importResult?.ok) return;
    const merged = mergeRecords(records, importResult.records);
    await replaceRecords(merged.records);
    setRecords(merged.records);
    setPreview(null);
    setStatus(tf("importCompleteStatus", { added: merged.added, duplicates: merged.duplicates }));
  }

  async function addManual(record: GachaRecordDraft) {
    const merged = mergeRecords(records, [record]);
    await replaceRecords(merged.records);
    setRecords(merged.records);
    setStatus(merged.added ? t("manualAddedStatus") : t("manualDuplicateStatus"));
  }

  function handleRemoteResult(result: ImportResult) {
    setDecryptedBackup(null);
    setImportResult(result);
    if (result.ok) {
      const merged = mergeRecords(records, result.records);
      setPreview({ added: merged.added, duplicates: merged.duplicates });
      setStatus(tf("remoteFetchCompleteStatus", { count: result.records.length, added: merged.added }));
    } else {
      setPreview(null);
      setStatus(result.errors[0] ? localizeMessage(locale, result.errors[0]) : t("remoteFetchFailedStatus"));
    }
  }

  async function clearAll() {
    if (!window.confirm(t("confirmClear"))) return;
    await clearRecords();
    setRecords([]);
    setImportResult(null);
    setPreview(null);
    setStatus(t("localCleared"));
  }

  function exportRecords() {
    downloadJson(`gf2-local-tracker-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, exportPortable(records));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{t("subtitle")}</p>
          <h1>{t("title")}</h1>
        </div>
        <div className="toolbar">
          <button
            className={activeView === "remote-import" ? "active-nav-button" : ""}
            onClick={() => setActiveView(activeView === "remote-import" ? "tracker" : "remote-import")}
            title={t("serverImport")}
          >
            <CloudDownload size={16} />
            {t("serverImport")}
          </button>
          <label className="file-button" title={t("fileImport")}>
            <Upload size={16} />
            {t("fileImport")}
            <input
              type="file"
              accept=".db,.sqlite,.sqlite3,.json,.txt,application/json,text/plain"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void readFile(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button onClick={exportRecords} disabled={!records.length} title={t("export")}>
            <Download size={16} />
            {t("export")}
          </button>
          <button onClick={clearAll} disabled={!records.length} title={t("clear")}>
            <Eraser size={16} />
            {t("clear")}
          </button>
          <select
            className="locale-select"
            value={locale}
            onChange={(e) => setLocale(e.target.value as "zh" | "en" | "jp")}
            title={t("languageSwitchTitle")}
            style={{ width: "100px", minHeight: "36px", cursor: "pointer", border: "1px solid var(--border-bright)", borderRadius: "var(--radius-sm)", background: "var(--bg-elevated)", padding: "0 10px" }}
          >
            <option value="zh">{t("localeZh")}</option>
            <option value="en">English</option>
            <option value="jp">{t("localeJp")}</option>
          </select>
        </div>
      </header>

      <section className="status-line" aria-live="polite">
        <Database size={14} />
        {t("statusLine")}{status}
      </section>

      <section className="stat-strip">
        <div>
          <span>{t("totalRecords")}</span>
          <strong>{stats.total.toLocaleString()}</strong>
        </div>
        <div>
          <span>{t("highRarity")}</span>
          <strong>{stats.highRarity.toLocaleString()}</strong>
        </div>
        <div>
          <span>{t("currentPity")}</span>
          <strong>{stats.currentPity ?? "-"}</strong>
        </div>
        <div>
          <span>{t("uniquePools")}</span>
          <strong>{stats.uniquePools.toLocaleString()}</strong>
        </div>
        <div>
          <span>{t("latestPull")}</span>
          <strong>{formatDate(stats.latestTimestamp)}</strong>
        </div>
      </section>

      <div className="workspace">
        <aside className="side-rail">
          <section className="panel import-panel">
            <div className="section-title">
              <FilePlus2 size={18} />
              <h2>{t("importPreview")}</h2>
            </div>
            <p className="resource-note">
              {t("resourceIndexLabel")}：{resourceIndex ? `${Object.keys(resourceIndex.items).length}${t("itemsCountSuffix")}` : t("notLoaded")}
            </p>
            {importResult ? (
              <div className="preview-box">
                <p>
                  <b>{importResult.fileName}</b>
                </p>
                <dl>
                  <div>
                    <dt>{t("formatLabel")}</dt>
                    <dd>{importResult.format ?? t("unknown")}</dd>
                  </div>
                  <div>
                    <dt>{t("validRecordsLabel")}</dt>
                    <dd>{importResult.records.length.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>{t("expectedAdded")}</dt>
                    <dd>{preview?.added ?? 0}</dd>
                  </div>
                  <div>
                    <dt>{t("expectedDuplicates")}</dt>
                    <dd>{preview?.duplicates ?? 0}</dd>
                  </div>
                </dl>
                {importResult.errors.map((error, index) => (
                  <p className="error" key={`${error.key}-${index}`}>
                    {localizeMessage(locale, error)}
                  </p>
                ))}
                <button className="primary wide" onClick={commitImport} disabled={!importResult.ok || !preview?.added}>
                  <Save size={16} />
                  {t("writeToLocalDb")}
                </button>
                {decryptedBackup && (
                  <button className="wide" type="button" onClick={() => downloadJson(decryptedBackup.fileName, decryptedBackup.value)}>
                    <Download size={16} />
                    {t("downloadDecryptedJson")}
                  </button>
                )}
              </div>
            ) : (
              <div className="import-help">
                <p className="muted">
                  {t("importInstructions")}
                </p>
                <p className="muted">
                  {t("serverPullHelp")}
                </p>
                <div className="import-divider" />
                <label className="file-button wide encrypted-backup-button" title={t("encryptedBackupTitle")}>
                  <LockKeyhole size={16} />
                  {decryptingBackup ? t("decryptingBackup") : t("decryptExiliumBackup")}
                  <input
                    type="file"
                    accept=".json,application/json"
                    disabled={decryptingBackup}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void decryptBackupFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <p className="muted decrypt-note">
                  {t("decryptBackupNote")}
                </p>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="section-title">
              <Plus size={18} />
              <h2>{t("manualEntry")}</h2>
            </div>
            <p className="muted">{t("manualEntryHelp")}</p>
            <button className="wide manual-open-button" type="button" onClick={() => setManualOpen(true)}>
              <ClipboardList size={16} />
              {t("openManualModal")}
            </button>
          </section>
        </aside>

        <section className="main-stage">
          {activeView === "remote-import" ? (
            <section className="remote-page-section">
              <div className="section-title">
                <CloudDownload size={18} />
                <div>
                  <p className="eyebrow">Import</p>
                  <h2>{t("serverImportTitle")}</h2>
                </div>
              </div>
              <div className="remote-page-layout">
                <div className="remote-page-copy">
                  <h3>{t("syncFromOfficialApi")}</h3>
                  <p>
                    {t("fiddlerTip")}
                  </p>
                  <div className="migration-guide">
                    <h4>{t("officialGuideTitle")}</h4>
                    <ol>
                      <li>
                        <>{t("fiddlerDownloadBeforeName")}<strong>Fiddler Classic</strong>{t("fiddlerDownloadBeforeLink")}<a href="https://downloads.getfiddler.com/fiddler-classic/FiddlerSetup.5.0.20253.3311-latest.exe" target="_blank" rel="noreferrer">{t("fiddlerOfficialDirectLink")}</a>{t("fiddlerDownloadAfterLink")}</>
                      </li>
                      <li>
                        {t("fiddlerConfigure")}
                        <ul>
                          <li>{t("fiddlerStepDecrypt")}</li>
                          <li>{t("fiddlerStepCert")}</li>
                          <li>{t("fiddlerStepTraffic")}</li>
                          <li>{t("fiddlerStepRestart")}</li>
                        </ul>
                      </li>
                      <li>
                        {t("fiddlerStartGame")}
                      </li>
                      <li>
                        {t("fiddlerRecruitStep")}
                      </li>
                      <li>
                        {t("fiddlerSessionStep")}
                      </li>
                      <li>
                        {t("fiddlerCopyStep")}
                      </li>
                      <li>
                        {t("fiddlerPasteStep")}
                      </li>
                    </ol>
                  </div>
                </div>
                <RemoteImportForm onResult={handleRemoteResult} t={t} />
              </div>
            </section>
          ) : (
            <>
          {records.length > 0 && (
            <section className="commander-profile-section">
              <div className={`commander-profile-card luck-level-${commanderProfile.luckIndex}`}>
                <div className="profile-header">
                  <div className="avatar-container">
                    <div className="avatar-placeholder">
                      {latestFiveStarDoll ? (
                        <img className="latest-ssr-avatar" src={getResourceImageUrl(resourceIndex, latestFiveStarDoll.itemId)} alt={latestFiveStarDoll.itemName} />
                      ) : (
                        <div className="glowing-orb" />
                      )}
                    </div>
                    {latestFiveStarDoll && <span className="avatar-label">{t("latestSSR")}</span>}
                  </div>
                  <div className="profile-titles">
                    <p className="eyebrow">COMMANDER PROFILE</p>
                    <div className="title-row">
                      <h3 className="profile-title-name">{translateCommanderTitle(commanderProfile.title, locale)}</h3>
                      <span className="luck-index-score">{t("luckIndexLabel")}: {Math.floor((10 - commanderProfile.luckIndex) * 10)}</span>
                    </div>
                    <div className="profile-tags">
                      {commanderProfile.tags.map((tag) => (
                        <span key={tag} className="tag-pill">
                          {translateTag(tag, locale)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="profile-details-grid">
                  <div className="detail-item">
                    <span className="detail-label">{t("totalPullsLabel")}</span>
                    <strong className="detail-value">{commanderProfile.totalPulls}</strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t("fiveStarCountLabel")}</span>
                    <strong className="detail-value text-rarity-5">{commanderProfile.fiveStarCount}</strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t("overallAvgLabel")}</span>
                    <strong className="detail-value">{commanderProfile.overallAvg}{t("avgPullsSuffix")}</strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t("winRateLabel")}</span>
                    <strong className="detail-value text-accent">{commanderProfile.overallWinRate}%</strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t("dollUpAvgLabel")}</span>
                    <strong className="detail-value">
                      {commanderProfile.dollUpAvg !== undefined ? `${commanderProfile.dollUpAvg}${t("pullsSuffix")}` : "-"}
                    </strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t("weaponUpAvgLabel")}</span>
                    <strong className="detail-value">
                      {commanderProfile.weaponUpAvg !== undefined ? `${commanderProfile.weaponUpAvg}${t("pullsSuffix")}` : "-"}
                    </strong>
                  </div>
                </div>

                <div className="pool-ouhuang-stats">
                  <div className="pool-ouhuang-box">
                    <h4>{t("poolType3")}</h4>
                    <div className="pool-ouhuang-rows">
                      <div>
                        <span>{t("pullsCount")}:</span>
                        <span>{commanderProfile.dollStats.pulls}{t("pullsSuffix")}</span>
                      </div>
                      <div>
                        <span>{t("fiveStarOut")}:</span>
                        <span>{commanderProfile.dollStats.fiveStars}</span>
                      </div>
                      <div>
                        <span>{t("winRateTitle")}:</span>
                        <span className="text-accent">{commanderProfile.dollStats.winRate}%</span>
                      </div>
                      <div>
                        <span>{t("avgPullsTitle")}:</span>
                        <span>{commanderProfile.dollStats.fiveStars > 0 ? `${commanderProfile.dollStats.avgPulls}${t("pullsSuffix")}` : "-"}</span>
                      </div>
                      <div>
                        <span>{t("ratingLabel")}</span>
                        <span className="text-bold">{commanderProfile.dollStats.fiveStars > 0 ? translatePoolTitle(commanderProfile.dollStats.title, locale) : t("noData")}</span>
                      </div>
                    </div>
                  </div>

                  <div className="pool-ouhuang-box">
                    <h4>{t("poolType4")}</h4>
                    <div className="pool-ouhuang-rows">
                      <div>
                        <span>{t("pullsCount")}:</span>
                        <span>{commanderProfile.weaponStats.pulls}{t("pullsSuffix")}</span>
                      </div>
                      <div>
                        <span>{t("fiveStarOut")}:</span>
                        <span>{commanderProfile.weaponStats.fiveStars}</span>
                      </div>
                      <div>
                        <span>{t("winRateTitle")}:</span>
                        <span className="text-accent">{commanderProfile.weaponStats.winRate}%</span>
                      </div>
                      <div>
                        <span>{t("avgPullsTitle")}:</span>
                        <span>{commanderProfile.weaponStats.fiveStars > 0 ? `${commanderProfile.weaponStats.avgPulls}${t("pullsSuffix")}` : "-"}</span>
                      </div>
                      <div>
                        <span>{t("ratingLabel")}</span>
                        <span className="text-bold">{commanderProfile.weaponStats.fiveStars > 0 ? translatePoolTitle(commanderProfile.weaponStats.title, locale) : t("noData")}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className="pool-tabs-section">
            <div className="section-title">
              <p className="eyebrow">Pools</p>
              <h2>{t("poolsHeader")}</h2>
            </div>
            {mergedPoolTypes.length ? (
              <div className="pool-type-tabs">
                {mergedPoolTypes.map((m) => {
                  const active = selectedMerged?.poolType === m.poolType;
                  return (
                    <button
                      key={m.poolType}
                      className={`pool-type-tab ${active ? "active" : ""}`}
                      onClick={() => setSelectedPoolType(m.poolType)}
                    >
                      <span className="pool-type-tab-label">{t(getPoolTypeKey(m.poolType))}</span>
                      <span className="pool-type-tab-count">{m.count}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">{t("noData")}</div>
            )}
          </section>

          {selectedMerged && (
            <section className="pool-detail-section">
              <div className="pool-detail-header">
                <div className="pool-detail-title">
                  <p className="eyebrow">{poolDetailLabels.eyebrow}</p>
                  <h2>{poolDetailLabels.title} · {selectedMerged.count}{t("pullsCountSuffix")}</h2>
                </div>
                <div className="pool-stats-strip">
                  <div>
                    <span>{t("totalRecords")}</span>
                    <strong>{selectedMerged.count}</strong>
                  </div>
                  <div>
                    <span>{t("fiveStarOut")}</span>
                    <strong>{selectedMerged.fiveStarEntries.length}</strong>
                  </div>
                  <div>
                    <span>{t("fourStarsCount")}</span>
                    <strong>{selectedMerged.fourStarEntries.length}</strong>
                  </div>
                </div>
              </div>

              {selectedMerged.fiveStarEntries.length > 0 && (
                <div className="five-star-showcase">
                  <div className="records-toolbar">
                    <p className="showcase-heading">{t("fiveStarRecordsTab")}</p>
                    <PaginationControls
                      page={fiveStarPage.page}
                      pageCount={fiveStarPage.pageCount}
                      start={fiveStarPage.start}
                      end={fiveStarPage.end}
                      total={fiveStarPage.total}
                      onPageChange={setCardPage}
                      t={t}
                    />
                  </div>
                  <div className="five-star-grid">
                    {fiveStarPage.items.map((entry) => {
                      const imgUrl = getResourceImageUrl(resourceIndex, entry.record.itemId);
                      const color = pityColor(entry.pity, 5);
                      const offRateLabel = describeOffRate(entry.record);
                      const localizedOffRate = getOffRateLabel(offRateLabel, locale);
                      return (
                        <div className={`five-star-card pity-${color}`} key={entry.record.id}>
                          <span className="card-pity-badge">{entry.pity}</span>
                          <span className="card-global-badge">#{entry.globalIndex}</span>
                          {localizedOffRate && <span className="off-rate-badge">{localizedOffRate}</span>}
                          <div className="five-star-image-wrap">
                            {imgUrl ? (
                              <img className="five-star-image" src={imgUrl} alt="" loading="lazy" />
                            ) : (
                              <span className="five-star-mark">{entry.record.itemName?.slice(0, 2) ?? String(entry.record.itemId).slice(-2)}</span>
                            )}
                          </div>
                          <div className="five-star-info">
                            <span className="five-star-name">{getItemName(entry.record.itemId, entry.record.itemName)}</span>
                            <span className="five-star-date">{formatDate(entry.record.timestamp)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="recent-pulls">
                <div className="records-toolbar">
                  <p className="showcase-heading">{t("fourStarOrAbovePulls")}</p>
                  <div className="table-tools">
                    <div className="search-box compact">
                      <Search size={14} />
                      <input
                        value={tableFilter.query}
                        placeholder={t("searchItemPlaceholder")}
                        onChange={(event) => setTableFilter((current) => ({ ...current, query: event.target.value }))}
                      />
                    </div>
                    <label className="tool-select">
                      <Filter size={14} />
                      <select
                        value={tableFilter.rarity}
                        onChange={(event) => setTableFilter((current) => ({ ...current, rarity: event.target.value as "" | "4" | "5" }))}
                        aria-label={t("filterByRarity")}
                      >
                        <option value="">{t("allPills")}</option>
                        <option value="5">5{t("starSuffix")}</option>
                        <option value="4">4{t("starSuffix")}</option>
                      </select>
                    </label>
                    <details className="column-menu">
                      <summary>
                        <Columns3 size={14} />
                        {t("columnsLabel")}
                      </summary>
                      <div className="column-popover">
                        {([
                          ["global", t("globalHeader")],
                          ["item", t("itemHeader")],
                          ["rarity", t("rarityHeader")],
                          ["pity", t("pityHeader")],
                          ["time", t("pullTimeHeader")],
                          ["pool", t("poolIdHeader")],
                          ["source", t("sourceHeader")],
                        ] as Array<[TableColumnKey, string]>).map(([key, label]) => (
                          <label key={key}>
                            <input
                              type="checkbox"
                              checked={visibleColumns[key]}
                              onChange={(event) => setVisibleColumns((current) => ({ ...current, [key]: event.target.checked }))}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </details>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="high-rarity-table">
                    <thead>
                      <tr>
                        {visibleColumns.global && <th>{t("globalHeader")}</th>}
                        {visibleColumns.item && <th>{t("itemHeader")}</th>}
                        {visibleColumns.rarity && <th>{t("rarityHeader")}</th>}
                        {visibleColumns.pity && <th>{t("pityHeader")}</th>}
                        {visibleColumns.time && <th>{t("pullTimeHeader")}</th>}
                        {visibleColumns.pool && <th>{t("poolIdHeader")}</th>}
                        {visibleColumns.source && <th>{t("sourceHeader")}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {highRarityPage.items
                        .map((entry) => {
                          const imgUrl = getResourceImageUrl(resourceIndex, entry.record.itemId);
                          const rarity = entry.record.rarity ?? 0;
                          const color = pityColor(entry.pity, rarity);
                          const offRateLabel = describeOffRate(entry.record);
                          const localizedOffRate = getOffRateLabel(offRateLabel, locale);
                          return (
                            <tr key={entry.record.id}>
                              {visibleColumns.global && <td className="col-global">#{entry.globalIndex}</td>}
                              {visibleColumns.item && (
                                <td className="col-item">
                                  {imgUrl && <img className="row-avatar" src={imgUrl} alt="" loading="lazy" />}
                                  <span>{getItemName(entry.record.itemId, entry.record.itemName)}</span>
                                  {localizedOffRate && <span className="row-off-rate-badge">{localizedOffRate}</span>}
                                </td>
                              )}
                              {visibleColumns.rarity && <td>{rarity ? `${rarity}${t("starSuffix")}` : "-"}</td>}
                              {visibleColumns.pity && (
                                <td>
                                  <span className={`pity-tag pity-${color}`}>{entry.pity}</span>
                                </td>
                              )}
                              {visibleColumns.time && <td className="col-time">{formatDate(entry.record.timestamp)}</td>}
                              {visibleColumns.pool && <td>{entry.record.poolId}</td>}
                              {visibleColumns.source && <td>{entry.record.source}</td>}
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  {highRarityEntries.length === 0 && (
                    <div className="empty-state">{t("noFourStarOrAboveRecords")}</div>
                  )}
                </div>
                <div className="table-footer">
                  <label className="rows-select">
                    {t("pageLabel")}
                    <select value={tablePageSize} onChange={(event) => setTablePageSize(Number(event.target.value))}>
                      {tablePageSizeOptions.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                  <PaginationControls
                    page={highRarityPage.page}
                    pageCount={highRarityPage.pageCount}
                    start={highRarityPage.start}
                    end={highRarityPage.end}
                    total={highRarityPage.total}
                    onPageChange={setTablePage}
                    t={t}
                  />
                </div>
              </div>
            </section>
          )}
            </>
          )}
        </section>
      </div>
      <ManualEntryModal open={manualOpen} onClose={() => setManualOpen(false)} onAdd={addManual} t={t} />
    </main>
  );
}
