#!/usr/bin/env node
import fs from "node:fs/promises";
import initSqlJs from "sql.js";

function normalizeServer(server) {
  return server === "tw" ? "haoplay" : server;
}

function readNumber(record, camelKey, snakeKey) {
  const value = record[camelKey] ?? record[snakeKey];
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function readString(record, camelKey, snakeKey, fallback = "unknown") {
  const value = record[camelKey] ?? record[snakeKey];
  return value == null ? fallback : String(value);
}

function canonicalRecord(record, sourceOrder) {
  return {
    uid: readString(record, "uid", "uid"),
    server: normalizeServer(readString(record, "server", "server")),
    poolType: readNumber(record, "poolType", "pool_type"),
    poolId: readNumber(record, "poolId", "pool_id"),
    itemId: readNumber(record, "itemId", "item_id"),
    timestamp: readNumber(record, "timestamp", "time"),
    rarity: record.rarity != null ? Number(record.rarity) : undefined,
    pullNumber: record.pullNumber != null || record.pull_number != null ? Number(record.pullNumber ?? record.pull_number) : undefined,
    source: record.source ?? "exilium",
    sourceOrder: record.sourceOrder ?? sourceOrder,
  };
}

function normalizeOccurrenceIndexes(records) {
  const sorted = records
    .filter((r) => Number.isFinite(r.timestamp) && Number.isFinite(r.itemId))
    .sort((a, b) =>
      a.timestamp - b.timestamp ||
      a.poolType - b.poolType ||
      a.poolId - b.poolId ||
      (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0) ||
      a.itemId - b.itemId,
    );
  const counters = new Map();
  return sorted.map((record) => {
    const key = `${record.uid}:${record.server}:${record.poolType}:${record.poolId}:${record.timestamp}:${record.itemId}`;
    const sameItemIndex = counters.get(key) ?? 0;
    counters.set(key, sameItemIndex + 1);
    return { ...record, sameItemIndex };
  });
}

async function main() {
  const merged = JSON.parse(await fs.readFile("merged-normalized-records.json", "utf8"));
  const existingRecords = normalizeOccurrenceIndexes(merged.records.map(canonicalRecord));

  const SQL = await initSqlJs({ locateFile: (f) => `node_modules/sql.js/dist/${f}` });
  const buf = await fs.readFile("ElmoBeacon.db");
  const db = new SQL.Database(new Uint8Array(buf));

  const userResult = db.exec("SELECT id, uid, game_server FROM user");
  const users = new Map();
  for (const result of userResult) {
    for (const row of result.values) {
      users.set(Number(row[0]), {
        uid: String(row[1]),
        server: normalizeServer(String(row[2])),
      });
    }
  }

  const recordResult = db.exec("SELECT user_id, pool_type, pool_id, item_id, timestamp FROM record ORDER BY id ASC");
  const elmoDrafts = [];
  for (const result of recordResult) {
    for (const row of result.values) {
      const user = users.get(Number(row[0]));
      elmoDrafts.push({
        uid: user?.uid,
        server: user?.server,
        poolType: Number(row[1]),
        poolId: Number(row[2]),
        itemId: Number(row[3]),
        timestamp: Number(row[4]),
        source: "elmobeacon-db",
        sourceOrder: elmoDrafts.length,
      });
    }
  }
  db.close();
  const elmoRecords = normalizeOccurrenceIndexes(elmoDrafts);

  console.log(`existing records: ${existingRecords.length}`);
  console.log(`elmo drafts: ${elmoRecords.length}`);

  const dedupeKey = (r) => `${r.uid}:${r.server}:${r.poolType}:${r.poolId}:${r.timestamp}:${r.itemId}:${r.sameItemIndex}`;
  const seen = new Map();
  for (const r of existingRecords) {
    const key = dedupeKey(r);
    seen.set(key, r);
  }

  let added = 0;
  let duplicates = 0;
  const allRecords = [...existingRecords];

  for (const draft of elmoRecords) {
    const key = dedupeKey(draft);
    const previous = seen.get(key);
    if (previous) {
      duplicates++;
      if (!previous.rarity && draft.rarity) previous.rarity = draft.rarity;
      if (!previous.pullNumber && draft.pullNumber) previous.pullNumber = draft.pullNumber;
    } else {
      added++;
      allRecords.push(draft);
      seen.set(key, draft);
    }
  }

  console.log(`added: ${added}, duplicates: ${duplicates}`);
  console.log(`total merged: ${allRecords.length}`);

  const output = {
    ...merged,
    total: allRecords.length,
    records: allRecords.sort((a, b) => a.timestamp - b.timestamp),
  };

  await fs.writeFile("merged-normalized-records.json", `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log("Wrote merged-normalized-records.json");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
