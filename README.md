<p align="center">
<img src="https://github.com/kiriya55/yoohee-tracker/blob/main/examples/icon.jpg" alt="Yoohee-tracker Icon" width="128">
  <h1 align="center">幼熙助手（Yoohee Tracker）</h1>
  <p align="center">
    一个本地优先的《少女前线 2：追放》抽卡记录分析器！
    <br />
  </p>
</p>

本地优先的《少女前线 2：追放》抽卡记录分析器（GF2 Local Gacha Tracker）。

本项目旨在让指挥官既能迁移、合并、备份其他工具导出的抽卡记录，又能通过传统方法拉取服务器数据与当前工具进行合并。

数据默认保存在浏览器 IndexedDB 中；导入文件、解密后的 exilium.xyz 网站备份和服务器同步结果都会先进入预览，确认后才写入本地数据库。

微信小程序支持导入该工具导出的备份json文件，同时可在手机端显示与类似小程序相似的抽卡结果。

## 功能特性

- 本地优先：记录保存在浏览器本地，无需注册账号或部署后端。
- 多来源导入：支持本工具导出的 JSON、exilium.xyz 网站解密备份、gfl2.help 导出 JSON、ElmoBeacon / gf2gacha SQLite 数据库。
- 网页端 exilium.xyz 网站备份解密：可直接选择 exilium.xyz 网站加密备份 JSON，网页端调用该网站解密接口后进入导入预览，也可下载解密后的 JSON。
- 服务器记录同步：支持粘贴 Fiddler 请求或手动填写 URL / Headers，拉取游戏服务器抽卡记录。
- 合并去重：按时间、同秒顺序、卡池和物品信息合并多批次记录。
- 抽卡统计：提供卡池统计、当前保底、高稀有记录、UP / 歪卡分析等视图。
- 资源索引：支持本地化人形与武器图标资源，适合离线部署或静态站点托管。
- 多服务器支持：人形、武器名称从多渠道获取，并以官方中文名为兜底，图片资源以国服最新版为标准进行同步，并有Github actions可同时实现R2图片与本地化图片拉取。

## 快速开始

```powershell
npm install
npm run dev
```

启动后打开 [http://localhost:5173/](http://localhost:5173/)。

生产构建：

```powershell
npm run build
npm run preview
```

构建产物会输出到 `dist/`，可部署到 GitHub Pages、Cloudflare Pages 或其他静态托管服务。

## 数据迁移

### 从 <https://exilium.xyz> 网站加密备份迁移

在网页左侧“导入预览”区域点击“解密 exilium.xyz 网站备份”，选择从 exilium.xyz 网站导出的加密 JSON。解密成功后会自动进入导入预览；你可以选择写入本地数据库，也可以下载 `*-decrypted.json` 留作备份。

如果你仍想使用命令行，也可以运行：

```powershell
node scripts/decrypt-exilium-backup.mjs .\你的加密备份.json .\exilium-decrypted.json
```

随后在网页端通过“文件导入”选择 `exilium-decrypted.json`。

### 导入来自 gfl2.help / ElmoBeacon / gf2gacha 的数据

点击“文件导入”，选择 gfl2.help 导出的 `gfl2help-pull-history-*.json`、或 ElmoBeacon 的 `ElmoBeacon.db` 文件、或 `gf2gacha` 的 `database.db` 文件，或其他兼容的 `.db` / `.sqlite` 文件。工具会解析文件并进入同一套导入预览流程。

### 从游戏服务器记录接口同步

点击顶部“服务器拉取”，按页面中的 Fiddler 指引复制游戏客户端的抽卡记录请求。同步结果同样会先进入预览，不会直接覆盖本地记录。

## 资源与图片同步

更新资源索引：

```powershell
npm run resources:update -- --servers dw-cn,haoplay --out-dir examples
```

下载图片到本地：

```powershell
node scripts/download-images.mjs --index public/images/resource-index.json --out-dir public/images
```

校验资源索引中的图片链接：

```powershell
npm run resources:check-images -- examples/gf2-resource-index.haoplay.json --concurrency 24 --timeout-ms 15000
```

### 自动更新

仓库包含 `Update Resource Images` GitHub Action：

- 手动触发：在 GitHub Actions 页面运行 workflow，可传入 `servers`，默认 `dw-cn,haoplay`。
- 定时触发：每天 UTC 11:00 运行一次。
- 定时任务会同步 Exilium BBS/MCC 的完整人形与武器目录、Dandegate 缺失头像、权威名称和卡池起止时间；不依赖当前卡池是否变化。
- 手动触发或缺少现有索引文件时会强制更新。

触发更新后会同步维护：

- `examples/gf2-resource-index.<server>.json`
- `public/images/**`
- `public/images/resource-index.json`
- `src/i18n-names.json`
- `src/i18n-name-sources.json`
- `src/i18n.json` 中的 `names`

i18n 名称按语言使用单一日常权威来源：中文为 MCC Wiki，日文为 wikiru 详情页，英文优先使用 gfl2.help banners，历史缺失时才使用同站 characters/weapons 补漏。资源目录使用 BBS handbook 的 ID 与 MCC Wiki 的 code/中文名进行全量对齐；Exilium BBS 不再只是 bootstrap 来源，而是完整目录来源。

名称抓取、图片查漏补缺和合并步骤在每次定时或手动 Action 中运行，不依赖卡池变化。

人形头像默认转换为 128×128 PNG。

### 小程序图片自动更新

小程序图片为托管在R2存储桶的图片和文件索引，Action 成功生成索引后会将 `public/images/resource-index.json` 作为 `miniprogram-resource-index` artifact 保存，并在 `sync_r2` 开启时同步新的图片和索引到R2存储桶。

启用 R2 上传需要在仓库 Settings → Secrets and variables → Actions 中配置：

- `R2_ACCOUNT_ID`
- `R2_BUCKET_NAME`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_PUBLIC_BASE_URL`

`R2_PUBLIC_BASE_URL` should be the public R2 custom domain or public bucket base, for example
`https://assets.yoohee.chukogals.top`. The uploader also accepts the full
`.../miniprogram-resource-index.json` URL and normalizes it. The post-upload check
uses cache-busting and retries transient 403/404/5xx responses.

定时 Action 默认启用 R2；手动触发时可将 `sync_r2` 设为 `false` 仅生成 GitHub 资源和 artifact。

本地也可以手动运行：

```powershell
npm run i18n:fetch-names -- --index public/images/resource-index.json --existing-i18n src/i18n.json --out src/i18n-names.json
npm run i18n:merge-names -- --index public/images/resource-index.json --names src/i18n-names.json --sources src/i18n-name-sources.json --out public/images/resource-index.json --app-i18n src/i18n.json
```

## 开发

```powershell
npm test
npm run build
```

主要目录：

- `src/App.tsx`：主界面与导入流程。
- `src/lib/importers.ts`：文件导入格式识别与归一化。
- `src/lib/exiliumDecrypt.ts`：exilium.xyz 网站加密备份解密流程。
- `src/lib/remoteImport.ts`：游戏服务器记录同步。
- `scripts/`：资源更新、图片下载、备份解密等维护脚本。
- `public/`：静态资源、PWA manifest、sql.js wasm。

## 微信小程序

微信小程序已正式上线，欢迎体验，需要通过R2同步游戏资料的朋友请联系b站“雾雾的百宝箱”私信获得同步密码。

<p align="center">
<img src="https://github.com/kiriya55/yoohee-tracker/blob/main/examples/wechat-microprogram.jpg" alt="Yoohee-tracker WX Micro-program Icon" width="128">
  <h1 align="center">幼熙助手微信小程序</h1>
</p>

## 欢迎贡献

欢迎提交 Issue、Pull Request 或补充资料。比较适合贡献的方向包括：

- 新服务器或新数据源的导入适配。
- 人形、武器、卡池名称与 i18n 翻译修正。
- 资源索引、图片链接、离线资源包维护。
- 抽卡规则、UP / 歪卡判断、统计口径校正。
- 移动端界面、可访问性、PWA 离线体验改进。
- 小程序使用体验改进。
- 测试用例、示例数据、迁移教程和文档改进。

提交代码前建议先运行 `npm test` 和 `npm run build`。

## 致谢

- 感谢 exilium.xyz 网站提供的抽卡记录与备份能力，gfl2.help 提供的抓包、记录同步参考与轻量导出格式。
- 感谢 [ElmoBeacon](https://github.com/MatchaCabin/ElmoBeacon)、[gf2gacha](https://github.com/MatchaCabin/gf2gacha) 等项目对数据抓取相关的贡献。
- 感谢 https://dandegate.net/ 的图像数据，https://gf2.mcc.wiki/ 提供的中文名称；http://gfl2.help/ 提供的英文名称；https://dollsfrontline2.wikiru.jp/ 提供的日文名称
- 感谢所有提交资源、翻译、测试反馈和问题报告的玩家。

## 免责声明

本项目为玩家社区工具，与《少女前线 2：追放》官方及相关权利方无关联。游戏名称、角色、武器、图像与数据版权归其各自权利方所有。本工具仅用于个人数据备份、迁移和统计分析，请自行确认使用方式符合所在地区与游戏服务条款。
