# GFL2 Local Capture Agent

这是 Yoohee Tracker 的 Windows 配套助手。它只负责临时捕获 GFL2 抽卡记录请求中的授权信息，并通过一次性 localhost 接口交给 Tracker；抽卡记录的请求、分页、解析、合并和预览仍由 Tracker 完成。

## Requirements

- Windows 10/11
- Node.js 20 or newer
- GFL2 客户端
- 如果本地网络需要代理，可使用 HTTP 上游代理，如 `http://127.0.0.1:7890`

## Build and start

推荐直接双击仓库根目录的 `start-gfl2-capture-agent.cmd`。它会自动安装依赖、构建并启动本工具。

在本目录执行：

```powershell
npm install
npm run build
npm start -- --upstream http://127.0.0.1:7890
```

如果不需要上游代理，可以省略 `--upstream`。助手本身默认使用动态空闲端口；`7890` 永远只作为上游代理，不会被助手占用。默认控制 API 地址是 `http://127.0.0.1:17890`。自动授权默认只接受 `https://yoohee-tracker.kiriya55.cn`、`http://localhost:5173` 和 `http://127.0.0.1:5173`。

第一次运行时，助手会请求在当前 Windows 用户的受信任根证书存储中安装临时证书。确认后它会保存当前 WinINET 代理设置、启用本地代理，并显示一次性配对码。

## Use with Tracker

1. 保持助手运行，不要关闭终端窗口。
2. 启动 GFL2，打开“招募 → 访问详情 → 访问记录”，等待记录表出现。
3. 在 Tracker 的“服务器拉取”页面点击“允许本地助手连接”。
4. 在弹出的本机授权页确认网站域名，点击“允许本次连接”。
5. Tracker 会自动等待请求、读取 UID 和凭据；确认预览结果后再写入本地数据库。

### Automatic local approval

自动方式使用一次性的本地授权握手：Tracker 先向 `127.0.0.1:17890` 请求一个短期配对请求，助手返回只在本机可打开的确认页。确认页会明确显示请求连接的网页来源；用户允许后，助手签发绑定该来源的短期 grant token。Tracker 通过 `postMessage` 收到 token，再用它领取一次性临时凭据。

浏览器的本地网络权限只负责允许网页访问 localhost，不能代替助手授权。grant token 只保存在当前页面内存中，绑定网页来源、限时有效、成功领取后立即失效。助手停止时会清除所有待处理请求和 grant。

如果浏览器不支持本地网络访问、阻止弹窗，或正式页面来源不在白名单中，可以展开 Tracker 中的备用方式，手动输入终端显示的一次性配对码。自行部署 Tracker 时必须显式加入来源：

```powershell
npm start -- --allow-origin https://your-tracker.example
```

不要把 `--allow-origin` 指向不受信任的网页来源。

助手只接受六个官方 GFL2 抽卡域名的 HTTPS `POST /list` 请求。未匹配的流量会继续转发，但不会进入凭据状态。

## Credential file fallback

如果部署的 Tracker 页面无法访问 localhost API，可以使用显式文件导出模式：

```powershell
node .\dist\src\cli.js --upstream http://127.0.0.1:7890 --export .\capture.gfl2cred.json
```

捕获到合法请求后，助手会写入一个 `.gfl2cred.json` 文件。回到 Tracker，选择“读取凭据文件”，然后抓取并预览。该文件包含临时 Authorization，使用后必须立即删除，不要上传、提交 Git 或发送给他人。

## Cleanup and recovery

正常退出（Ctrl+C）或从 Tracker 请求停止时，助手会清除内存凭据、删除临时证书、停止代理并恢复原来的 WinINET 设置。启动时如果发现上一次进程留下的恢复状态，会先尝试恢复代理和证书，再开始新会话。

如果进程在系统强制终止后无法自动恢复，请不要继续启动游戏；重新运行助手会再次尝试恢复。仍失败时，在“Internet 选项 → 连接 → 局域网设置”中确认代理是否回到原状态，并删除当前用户证书存储中名称为 `GFL2 Capture Agent CA` 的证书。

## Security notes

- Authorization 只在助手内存和 Tracker 当前同步过程内存中存在。
- `/v1/status`、错误信息和终端输出不会包含 Authorization。
- localhost claim 需要一次性配对码，成功后凭据立即从助手内存删除。
- 助手不读取 `Player.log`，也不保存抽卡响应、UID 或其他游戏数据。
- 代理证书只安装到当前 Windows 用户，停止后会删除。
