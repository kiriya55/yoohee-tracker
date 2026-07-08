declare module "sql.js" {
  export type SqlJsStatic = {
    Database: new (data?: Uint8Array) => Database;
  };

  export type QueryResult = {
    columns: string[];
    values: Array<Array<string | number | Uint8Array | null>>;
  };

  export type Database = {
    exec(sql: string): QueryResult[];
    export(): Uint8Array;
    close(): void;
  };

  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}
