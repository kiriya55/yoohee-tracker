import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { parseElmoBeaconDb } from "./elmobeaconDb";

describe("parseElmoBeaconDb", () => {
  it("imports records from ElmoBeacon.db tables", async () => {
    const SQL = await initSqlJs({
      locateFile: (file) => `node_modules/sql.js/dist/${file}`,
    });
    const db = new SQL.Database();
    db.exec(`
      CREATE TABLE user (
        id INTEGER PRIMARY KEY,
        uid INTEGER,
        game_server TEXT,
        game_data_dir TEXT,
        last_bbs_token TEXT
      );
      CREATE TABLE record (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        pool_type INTEGER,
        pool_id INTEGER,
        item_id INTEGER,
        timestamp INTEGER
      );
      INSERT INTO user (id, uid, game_server, game_data_dir, last_bbs_token)
      VALUES (1, 123456, 'tw', '', '');
      INSERT INTO record (id, user_id, pool_type, pool_id, item_id, timestamp)
      VALUES
        (1782373017000, 1, 3, 118001, 11017, 1782373017),
        (1782373017001, 1, 3, 118001, 11017, 1782373017);
    `);

    const exported = db.export();
    const result = await parseElmoBeaconDb(exported.buffer as ArrayBuffer, "ElmoBeacon.db");
    db.close();

    expect(result.ok).toBe(true);
    expect(result.format).toBe("elmobeacon-db");
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      uid: "123456",
      server: "haoplay",
      poolType: 3,
      poolId: 118001,
      itemId: 11017,
      timestamp: 1782373017,
    });
  });
});
