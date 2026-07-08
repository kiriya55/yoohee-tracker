import type { GachaRecord } from "../types";

const DB_NAME = "gf2-local-tracker";
const DB_VERSION = 1;
const STORE = "records";

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadRecords(): Promise<GachaRecord[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const records = await requestToPromise<GachaRecord[]>(tx.objectStore(STORE).getAll());
  db.close();
  return records.sort((a, b) => b.timestamp - a.timestamp || b.orderInSecond - a.orderInSecond);
}

export async function replaceRecords(records: GachaRecord[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  store.clear();
  for (const record of records) store.put(record);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function clearRecords(): Promise<void> {
  await replaceRecords([]);
}
