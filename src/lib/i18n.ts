export type Locale = "zh" | "en" | "jp";

export type MessageKey =
  | "unknownImportFormat" | "resourceIndexNotRecordData" | "elmoEmpty" | "sqliteUnknownSchema" | "sqliteMissingColumns"
  | "sqliteEmpty" | "sqliteReadFailed" | "remoteMissingUid" | "remoteMissingUrl"
  | "remoteMissingAuthorization" | "remoteInvalidJson" | "remoteApiError"
  | "remoteNetworkFailed" | "remoteFetchFailed" | "remoteEmpty";

export type LocalizedMessage = {
  key: MessageKey;
  values?: Record<string, string | number>;
  detail?: string;
};

const messages: Record<Locale, Record<MessageKey, string>> = {
  zh: {
    unknownImportFormat: "无法识别文件格式。文件导入支持本工具导出的 JSON、ElmoBeacon 数据库 .db、gf2gacha 数据库 .db。",
    resourceIndexNotRecordData: "这是资源索引 JSON，不是抽卡记录。请直接选择它作为资源索引，或改选抽卡记录导出文件。",
    elmoEmpty: "ElmoBeacon.db 中没有 record 记录。", sqliteUnknownSchema: "这不是可识别的 SQLite 数据库：缺少受支持的记录表。",
    sqliteMissingColumns: "表 {table} 缺少关键列，需要包含 pool_type、pool_id、item_id、timestamp。", sqliteEmpty: "SQLite 表 {table} 中没有记录。",
    sqliteReadFailed: "读取 SQLite 数据库失败：", remoteMissingUid: "请填写 UID。", remoteMissingUrl: "请填写抽卡记录 URL，或粘贴完整 Fiddler 请求。",
    remoteMissingAuthorization: "Headers 中缺少 Authorization。", remoteInvalidJson: "接口返回值不是 JSON 对象。", remoteApiError: "接口返回错误：",
    remoteNetworkFailed: "远程抓取失败：浏览器可能拦截了跨域请求，或 Headers/URL 已失效。", remoteFetchFailed: "远程抓取失败：", remoteEmpty: "远程接口返回为空。",
  },
  en: {
    unknownImportFormat: "Unrecognized file format. Import supports tracker JSON exports, ElmoBeacon .db, and gf2gacha .db files.",
    resourceIndexNotRecordData: "This is a resource index JSON, not gacha records. Load it as a resource index or choose a record export instead.",
    elmoEmpty: "ElmoBeacon.db contains no record entries.", sqliteUnknownSchema: "Unrecognized SQLite database: no supported record table was found.",
    sqliteMissingColumns: "Table {table} is missing required columns: pool_type, pool_id, item_id, and timestamp.", sqliteEmpty: "SQLite table {table} contains no records.",
    sqliteReadFailed: "Failed to read SQLite database: ", remoteMissingUid: "Enter a UID.", remoteMissingUrl: "Enter the gacha history URL or paste a complete Fiddler request.",
    remoteMissingAuthorization: "Authorization is missing from Headers.", remoteInvalidJson: "The API response is not a JSON object.", remoteApiError: "The API returned an error: ",
    remoteNetworkFailed: "Remote fetch failed. The browser may have blocked the cross-origin request, or the Headers/URL may have expired.", remoteFetchFailed: "Remote fetch failed: ", remoteEmpty: "The remote API returned no records.",
  },
  jp: {
    unknownImportFormat: "認識できないファイル形式です。Tracker の JSON、ElmoBeacon .db、gf2gacha .db を読み込めます。",
    resourceIndexNotRecordData: "これはガチャ履歴ではなくリソースインデックス JSON です。リソースインデックスとして読み込むか、履歴のエクスポートを選択してください。",
    elmoEmpty: "ElmoBeacon.db に record レコードがありません。", sqliteUnknownSchema: "認識できない SQLite データベースです。対応するレコードテーブルがありません。",
    sqliteMissingColumns: "テーブル {table} に必須列 pool_type、pool_id、item_id、timestamp がありません。", sqliteEmpty: "SQLite テーブル {table} にレコードがありません。",
    sqliteReadFailed: "SQLite データベースの読み込みに失敗しました：", remoteMissingUid: "UIDを入力してください。", remoteMissingUrl: "ガチャ履歴 URL を入力するか、Fiddler リクエスト全体を貼り付けてください。",
    remoteMissingAuthorization: "Headers に Authorization がありません。", remoteInvalidJson: "API の応答が JSON オブジェクトではありません。", remoteApiError: "API エラー：",
    remoteNetworkFailed: "リモート取得に失敗しました。ブラウザの CORS 制限、または Headers/URL の期限切れの可能性があります。", remoteFetchFailed: "リモート取得に失敗しました：", remoteEmpty: "リモート API からレコードが返されませんでした。",
  },
};

export function localizeMessage(locale: Locale, message: LocalizedMessage | string): string {
  if (typeof message === "string") return message;
  let text = messages[locale][message.key] ?? messages.zh[message.key];
  for (const [key, value] of Object.entries(message.values ?? {})) text = text.split(`{${key}}`).join(String(value));
  return `${text}${message.detail ?? ""}`;
}
