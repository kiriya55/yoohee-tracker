import initSqlJs from "sql.js";
import type { GachaRecordDraft, ImportResult } from "../types";

type DbValue = string | number | Uint8Array | null;
type DbRow = Record<string, DbValue>;

function rowsFromResult(columns: string[], values: DbValue[][]): DbRow[] {
  return values.map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index] ?? null])));
}

function numberValue(value: DbValue | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function stringValue(value: DbValue | undefined, fallback = "unknown"): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function normalizeServer(server: string): string {
  return server === "tw" ? "haoplay" : server;
}

export async function parseElmoBeaconDb(buffer: ArrayBuffer, fileName?: string): Promise<ImportResult> {
  const SQL = await initSqlJs({
    locateFile: (file) =>
      typeof window === "undefined" ? `node_modules/sql.js/dist/${file}` : `/${file}`,
  });
  const db = new SQL.Database(new Uint8Array(buffer));

  try {
    const schema = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = new Set(
      schema.flatMap((result) => result.values.map((row) => String(row[0]))),
    );

    // 1. Check if it's an ElmoBeacon.db database
    if (tableNames.has("record") && tableNames.has("user")) {
      const userResult = db.exec("SELECT id, uid, game_server FROM user");
      const users = new Map<number, { uid: string; server: string }>();
      for (const result of userResult) {
        for (const row of rowsFromResult(result.columns, result.values)) {
          users.set(numberValue(row.id), {
            uid: stringValue(row.uid),
            server: normalizeServer(stringValue(row.game_server, "unknown")),
          });
        }
      }

      const recordResult = db.exec(
        "SELECT id, user_id, pool_type, pool_id, item_id, timestamp FROM record ORDER BY id ASC",
      );
      const records: GachaRecordDraft[] = [];
      for (const result of recordResult) {
        for (const row of rowsFromResult(result.columns, result.values)) {
          const user = users.get(numberValue(row.user_id));
          records.push({
            uid: user?.uid,
            server: user?.server,
            poolType: numberValue(row.pool_type),
            poolId: numberValue(row.pool_id),
            itemId: numberValue(row.item_id),
            timestamp: numberValue(row.timestamp),
            source: "elmobeacon-db",
            sourceOrder: records.length,
          });
        }
      }

      return {
        ok: true,
        fileName,
        format: "elmobeacon-db",
        records,
        errors: records.length ? [] : ["ElmoBeacon.db 中没有 record 记录。"],
      };
    }

    // 2. Otherwise, check for generic gacha databases (like gf2gacha.db)
    const candidates = ["gacha_record", "gacha_records", "record", "records", "gachas", "gacha_log", "gacha_logs"];
    const recordTable = candidates.find((t) => tableNames.has(t));

    if (!recordTable) {
      return {
        ok: false,
        fileName,
        format: "sqlite-db",
        records: [],
        errors: ["这不是可识别的 SQLite 数据库：缺少 user/record 表（ElmoBeacon）或 gacha_record/records 表（gf2gacha）。"],
      };
    }

    // Query column info of the recordTable
    const tableInfo = db.exec(`PRAGMA table_info(${recordTable})`);
    const columns = tableInfo.flatMap((result) => result.values.map((row) => String(row[1])));

    // Dynamically map column names (case-insensitive)
    const colPoolType = columns.find((c) => /^(pool_?type|gacha_?type|type_?id)$/i.test(c));
    const colPoolId = columns.find((c) => /^(pool_?id|gacha_?id)$/i.test(c));
    const colItemId = columns.find((c) => /^(item_?id|goods_?id|item)$/i.test(c));
    const colTimestamp = columns.find((c) => /^(timestamp|time|gacha_?time|created_?at)$/i.test(c));
    const colUid = columns.find((c) => /^(uid|user_?id)$/i.test(c));
    const colItemName = columns.find((c) => /^(item_?name|goods_?name|name)$/i.test(c));
    const colRarity = columns.find((c) => /^(rarity|rank_?type|rank)$/i.test(c));
    const colServer = columns.find((c) => /^(server|game_?server|channel)$/i.test(c));

    if (!colPoolType || !colPoolId || !colItemId || !colTimestamp) {
      return {
        ok: false,
        fileName,
        format: "sqlite-db",
        records: [],
        errors: [`在 ${recordTable} 表中缺少关键列，需要包含 pool_type、pool_id、item_id、timestamp。`],
      };
    }

    // Select matched columns
    const selectCols = [colPoolType, colPoolId, colItemId, colTimestamp];
    if (colUid) selectCols.push(colUid);
    if (colItemName) selectCols.push(colItemName);
    if (colRarity) selectCols.push(colRarity);
    if (colServer) selectCols.push(colServer);

    const recordResult = db.exec(`SELECT ${selectCols.join(", ")} FROM ${recordTable}`);
    const records: GachaRecordDraft[] = [];

    for (const result of recordResult) {
      for (const row of rowsFromResult(result.columns, result.values)) {
        const rawTime = row[colTimestamp];
        let timestamp = 0;
        if (typeof rawTime === "string") {
          // Format could be "2024-01-01 12:00:00" or similar
          const parsedTime = Date.parse(rawTime.replace(/-/g, "/"));
          timestamp = Number.isFinite(parsedTime) ? Math.floor(parsedTime / 1000) : 0;
        } else {
          timestamp = numberValue(rawTime);
        }

        records.push({
          uid: colUid ? stringValue(row[colUid], "") || undefined : undefined,
          server: colServer ? normalizeServer(stringValue(row[colServer], "")) || undefined : undefined,
          poolType: numberValue(row[colPoolType]),
          poolId: numberValue(row[colPoolId]),
          itemId: numberValue(row[colItemId]),
          timestamp,
          itemName: colItemName ? stringValue(row[colItemName], "") || undefined : undefined,
          rarity: colRarity ? numberValue(row[colRarity]) || undefined : undefined,
          source: "gf2gacha-db",
          sourceOrder: records.length,
        });
      }
    }

    return {
      ok: true,
      fileName,
      format: "gf2gacha-db",
      records,
      errors: records.length ? [] : [`SQLite 表 ${recordTable} 中没有记录。`],
    };
  } catch (error) {
    return {
      ok: false,
      fileName,
      format: "sqlite-db",
      records: [],
      errors: [`读取 SQLite 数据库失败：${error instanceof Error ? error.message : String(error)}`],
    };
  } finally {
    db.close();
  }
}
