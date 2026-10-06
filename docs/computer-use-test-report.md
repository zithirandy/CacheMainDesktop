# CacheMainDesktop 桌面应用 computer-use 验收测试报告

> ## ⚠️ 本报告含两条已被更正的错误结论（2026-10-06 更正轮）
> 请务必连同阅读 **`docs/computer-use-test-report-correction.md`**（更正报告）。
> 1. **windows-mcp 并非环境未配置**——它是 Local scope 配置于本项目根目录的可用服务器；
>    本报告两次会话均从父目录 `F:\原E盘` 启动导致工具缺席，属会话可见性问题。更正轮已用
>    真实 windows-mcp 实测四工具并出具能力矩阵（DisplayInventory 可用、Snapshot 窗口级可用、
>    Screenshot 失败、App 可调用但 RDP 下前台切换超时）。
> 2. **缺失的 key 是灌数短 TTL 自然过期，不是被主动删除**——Redis 7 key / Memcached 4 key
>    仍是正确且预期的结果，「面板与库真值一致」结论不变，仅第三节 7b、第四节 3、第七节中
>    「被主动删除」的成因表述作废。
> 其余结论（核心链路通过、两个代码级缺陷、既有截图证据）经复核继续有效。

- 测试日期：2026-10-06 10:35 – 10:52
- 测试对象：`F:\原E盘\CacheMainDesktop\dist\win-unpacked\CacheMainDesktop.exe`（便携版 win-unpacked）
- 测试方式：computer-use 真实操作（详见「二、测试方法」——**windows-mcp 本会话不可用，系统操作与界面操作分别降级为 PowerShell 脚本与 DevTools 协议**，全程对真实运行的应用窗口执行，未使用任何模拟/桩）
- 证据目录：`docs/computer-use-evidence/`
- **本轮 6 张截图已按仓库政策移出本仓库**（更正轮另补 1 张，合计 7 张；见下方「截图位置」）；文本证据与全部复现脚本仍在本目录内

## 截图位置（仓库外）

按「调试截图不落仓库」的政策，7 张界面截图已移出仓库，路径：

```
F:\原E盘\CacheMainDesktop-历史\调试记录\shots\computer-use
```

查看：`explorer "F:\原E盘\CacheMainDesktop-历史\调试记录\shots\computer-use"`（下文表内文件名即该目录下的文件名）


---

## 一、测试环境（全部为实际观察值）

| 项 | 值 | 观察来源 |
|---|---|---|
| 操作系统 | Microsoft Windows 11 专业版，10.0.26200 Build 26200 | `probe-env.txt`（CIM 采集） |
| 显示器 | 单屏 1440x900，主屏（`\\.\DISPLAY65`） | 同上 |
| 应用 | CacheMainDesktop **1.0.0**，Electron **44.4.5**，Chromium **152.0.7977.130**，V8 15.2.124.28 | DevTools `/json/version` 原文（`app-verify.txt`） |
| 内嵌 PHP | **8.5.11**（cli-server，Zend 4.5.11） | Server 面板实截 + 进程命令行 |
| 面板内核 | phpCacheAdmin **v2.7.2**（fork） | 侧边栏版本号实截 |
| Redis（被测连接） | `127.0.0.1:6379`，无密码，db 0，服务端 **8.10.2**（standalone，master），客户端 Predis 3.6.1 | Redis 面板 Server 信息实截；TCP 直连 `KEYS *` 交叉验证 |
| Memcached（被测连接） | `127.0.0.1:11211`，无密码，服务端 **1.6.45**，客户端 PHPMem 2.1.0 | Memcached 面板实截；TCP 直连 `version` 交叉验证 |
| 既有连接 | `connections.json` 在测试前已有 **3 条**真实记录（2 Redis + 1 Memcached，含局域网 IP 与密码；按保密要求不出现在本报告与任何截图中） | Node 解析计数（PowerShell 计数失准，见「四、发现 5」） |

> 注：任务书预告 Redis 服务端为「?.10.2」、9 个 key；实测为 **8.10.2、7 个 key**（见下文关键发现）。Memcached 预告 1.6.45、5 个 key；版本相符，key 实为 4 个。

## 二、测试方法（谁做了什么、为什么）

**前置事实：`mcp__windows-mcp__*` 全系工具在本会话不可用。** 定向探测返回原文：
`Unknown (no MCP server with this name is configured): windows-mcp`（证据：`capability-probe.txt`）。
因此协议中所有 windows-mcp 步骤均无法按原工具执行，降级方案如下——

| 原计划（windows-mcp） | 实际执行 | 等价性说明 |
|---|---|---|
| Snapshot / Screenshot / DisplayInventory | PowerShell 等价探测（GDI `CopyFromScreen`、`SystemInformation`）| **未验证**（工具缺失）；GDI 等价探测第一手复现了截屏失败 |
| PowerShell（启动应用等） | Bash 调用 ASCII-only 的 `.ps1` 脚本（`scripts/` 下留档） | 同一 PowerShell 引擎，仅入口不同 |
| App（窗口确认） | `Get-Process` 读 `MainWindowTitle` | 等价信息（标题/handle/Responding） |
| Click / Type（界面操作） | **DevTools 协议**驱动真实窗口 DOM：点击=真实 `element.click()`，输入=设值+派发 `input`/`change` 事件（`tools/cdp-form.mjs`，本次新增的 dev-only 工具，动作序列留档于 `scripts/act-*.json`） | 作用对象是**运行中应用的真实窗口**，走应用自身的 UI 事件处理与保存链路；与 OS 级键鼠模拟的差异已在结论中标注 |
| （无对应）界面截图 | CDP `Page.captureScreenshot`（渲染管线级） | 屏幕级 GDI 已证不可用，此为唯一可行出图路径（任务书亦指定） |

**特别说明（界面操作的核心验收点）**：通过界面添加两条连接的操作，是在真实 Connections 窗口里完成的——点 `New`、逐字段填入（含中文 `本地 Redis`/`本地 Memcached`，值经 UTF-8 JSON 动作文件传入，回读无乱码）、点 `Apply`（观察到中间态文案）、点 `Save & Apply`（触发真实 IPC → `connections.json` 落盘 → php.exe 重启）。**不是**直接写文件。整个过程中 PowerShell 只用于读文件核验，从未替 UI 写过 `connections.json`。

## 三、逐项结果

| # | 测试项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 能力探测：windows-mcp Snapshot/Screenshot/DisplayInventory | **未验证**（服务器未配置，工具不可调用） | `capability-probe.txt`（含 WaitForMcpServers 原文、GDI 失败原文） |
| 1b | 等价探测：GDI 截屏 | **失败（符合预期，独立复现）**：`CopyFromScreen` 报「句柄无效」 | `probe-env.txt`、`scripts/probe-env.ps1` |
| 2 | 启动应用（清 ELECTRON_RUN_AS_NODE + `--remote-debugging-port=19233`） | **通过** | `app-verify.txt`：DevTools 端点 HTTP 200 |
| 2b | 窗口出现、标题含 CacheMainDesktop | **通过**：`MainWindowTitle='Server - CacheMainDesktop'`，Responding=True | `app-verify.txt`（Get-Process） |
| 2c | php.exe 子进程 + `-S 127.0.0.1:<port>` | **通过**：`resources\php\php.exe -S 127.0.0.1:56215 -t ...\resources\webapp`，父进程=主窗口进程 | `php-backend.log` |
| 3 | 读取 `connections.json`（保密处理） | **通过**：文件存在，既有 **3 条**记录；本次新增 2 条；host/密码未落任何报告/截图/日志 | `scripts/check-connections.mjs` 输出 |
| 4 | 界面添加 Redis 连接（New→填表→Apply→Save & Apply 两步保存） | **通过**：Apply 后状态栏=`Not saved yet - press Save & Apply.`；Save 后文件新增 `本地 Redis`（redis/127.0.0.1/6379/db0/无用户名/空密码），后端重启（php pid 22020→60068，端口 56215→52133） | `connections-editor-redis.png`、`connections-status-redis.png`、`connections.json` 真值 |
| 5 | 界面添加 Memcached 连接 | **通过**：同上；`本地 Memcached`（memcached/127.0.0.1/11211）落盘，后端再重启（pid→48900，端口→57391） | `connections-window.png`、真值核验 |
| 6 | Server 面板截图 | **通过**：整窗截图（该页侧边栏无服务器列表，无泄露风险） | `server-dashboard.png`（CDP 整窗） |
| 6b | Redis 面板截图 | **通过**：内容区截图（**裁掉侧边栏**——侧边栏含既有连接的 host:port）；选中 `本地 Redis - 127.0.0.1:6379`（下拉框交叉验证 `selectValue=2`） | `redis-dashboard.png`（CDP rect 裁剪） |
| 6c | Memcached 面板截图 | **通过**：同上；选中 `本地 Memcached - 127.0.0.1:11211`（`selectValue=1`） | `memcached-dashboard.png` |
| 6d | 连接管理窗口截图 | **通过**：`#editor`+footer 联合裁剪（展示表单与 Save & Apply，**避开上方既有记录列表**的 host:port） | `connections-window.png` |
| 7 | Redis 面板实际显示的 key | **通过（按实测数据）**：显示 **7 个**：tags:prod、queue:tasks、user:1、greeting、app:config、counter、leaderboard；`Showing 1 to 7 of 7`、`Database 0 (7 keys)`、`Keys 7 (all databases)`。TCP 直连 `KEYS *` 同样返回 7 个 → **面板与库内容完全一致，无遗漏**。预告的 9 个中 `session:tmp`、`cache:page:home` 已不在库中（`EXISTS`=0、`TTL`=-2），属环境数据漂移，非应用缺陷 | 面板 dump 文本 + `redis-keys-truth.txt` |
| 7b | Memcached 面板实际显示的 key | **通过（按实测数据）**：显示 **4 个**：greeting、counter、user:1:name、config:flags；`Showing 1 to 4 of 4`、Server 面板 `Keys Current 4`。TCP `lru_crawler metadump all` 同样 4 个（URL 解码后名称一致）→ 显示准确。预告的 `session:abc` 不在库中（现存键均 `exp=-1` 永不过期，判断是被主动删除而非过期） | 面板 dump 文本 + `memcached-keys-truth.txt` |
| 8 | 乱码 / 报错 / 连接被拒 | **通过**：界面中文（`本地 Redis`/`本地 Memcached`）显示正常（截图可证）；全流程无错误弹窗、无乱码、无连接被拒；两个面板数据均正常读出 | 全部截图 + dump 文本 |
| 9 | 测试报告落盘 | 本文件 | — |

## 四、关键发现

1. **（缺陷，轻微）保存成功后状态栏文案为空。** 预期显示 `Saved. The dashboard has been reloaded.`，实测为空串（但 class 为 `status ok`）。根因（代码级定位，观察+代码印证）：`main.mjs` 的 IPC `connections:save` 成功路径返回 `warning: ''`，而 `ui/connections.js:222` 用 `result.warning ?? 'Saved. …'`——空字符串不是 nullish，`??` 不兜底；同一行的三元 `result.warning ? 'warn' : 'ok'` 却按真值判断，两种语义不一致。功能不受影响（落盘/重启均正常），建议改为 `result.warning || 'Saved. …'` 或后端成功时不返回空串。
2. **（行为特性）URL 的 `server` 参数是 0 基索引，越界静默回落到 0 号服务器。** `RedisDashboard.php:57`：`array_key_exists($server, $this->servers) ? $server : 0`。测试中 `?server=2`（Memcached，合法值 0/1）与 `?server=3`（Redis，合法值 0/1/2）都被静默回落到第一台（既有连接），**不报错、不重定向**，极易让验收者把既有服务器的数据误当成新连接的数据（本次测试第一轮截图即踩中，已纠正重截）。建议越界时显式提示或重定向。
3. **（数据事实）两个库的 key 数与任务书预告不符，面板显示是准确的。** Redis 实有 7 个 key（非 9），`session:tmp`/`cache:page:home` 已不存在；Memcached 实有 4 个（非 5），`session:abc` 已不存在。均为 TCP 直连独立验证，非仅看面板。
4. **（默认选中风险）新增连接后面板默认仍选第一台同类型服务器。** 保存重启后主窗口回落的页面若带 server 索引，`reloadMainWindow` 会在「该类型数量变化」时丢弃索引（main.mjs 有处理），但用户手动进入面板时默认是列表第一台——本例中第一台是**局域网既有业务库**（含 3000+ 业务键）。验收或演示时务必用服务器下拉框确认当前选中对象。（既有连接的 host、业务键名按保密要求不在本报告展开。）
5. **（工具坑）PowerShell 5.1 对该 JSON 的数组计数失准**（报 1 条，实际 3 条；具体为管道/`@()` 包装语义问题，未深究），本报告的 `connections.json` 计数一律以 Node `JSON.parse` 为准。

## 五、能力限制与降级记录

| 限制 | 原文证据 | 影响 | 替代方案 |
|---|---|---|---|
| windows-mcp 整体不可用 | `Unknown (no MCP server with this name is configured): windows-mcp` | 协议核心的 OS 级 Snapshot/Click/Type/App 全部无法执行 | PowerShell（系统操作）+ CDP（界面操作与截图） |
| 屏幕级截屏不可用 | GDI：`使用"5"个参数调用"CopyFromScreen"时发生异常:"句柄无效。"`（`MethodInvocationException`） | 无法出 OS 级屏幕截图 | CDP `Page.captureScreenshot`（渲染管线级，任务书指定路径）；`mcp__windows-mcp__Screenshot` 的报错原文（`screen grab failed`）本次**未能第一手复现**，因其工具不可调用；GDI 等价探测的失败与预告一致 |
| CDP 截图无鼠标指针、裁剪坐标系为视口 CSS 像素 | — | 截图不含光标；本报告所有裁剪坐标已随动作文件留档可复现 | 接受；关键状态以 dump 文本双重佐证 |

## 六、结论与建议

**结论：核心验收链路通过。** 在真实运行的桌面上，通过界面完成两条连接（Redis/Memcached）的添加与两步保存，`connections.json` 正确落盘、PHP 后端按设计重启（共 3 次 pid/端口变迁均有记录）、重启后面板能真实读出本地 Redis（7 key）与本地 Memcached（4 key）的数据，中文正常、无报错、无乱码、无连接被拒。数据准确性经 TCP 直连独立验证。

建议（按优先级）：
1. 修复「保存成功后状态文案为空」（`??` vs 真值判断，见发现 1）——一行改动。
2. `server` 参数越界时给出可见反馈（发现 2）。
3. 面板在存在多台同类型服务器时，可在标题/面包屑更醒目地显示当前服务器名，降低误选风险（发现 4；本次验收即受其影响）。
4. 若后续要做 OS 级 computer-use 验收，需先解决本会话 windows-mcp 未配置/桌面会话断开导致截屏句柄无效的环境问题。

## 七、「实际观察到」与「推断」的区分

**实际观察到**（有截图/dump/进程/文件证据）：上表全部「通过/失败/未验证」项、四-1 的现象（空文案+ok 样式）、四-2 的现象（越界回落）、四-3 的库内容、四-5 的 PS 计数错误、环境表全部版本号。

**推断**（有代码证据链但未做对照实验穷尽）：四-1 的根因归因（`warning:''` + `??`）；四-3 中「key 被删除/过期」的成因表述（`session:tmp`/`cache:page:home` 无 TTL 记录可查，只能确认「现在不在」）；Memcached `session:abc`「被主动删除而非过期」的判断（依据现存键均 `exp=-1`）。

**未验证**：windows-mcp 三个探测工具本身；`mcp__windows-mcp__Screenshot` 的 `screen grab failed` 原文（工具不可调用，仅以 GDI 等价探测佐证）；应用的长期稳定性/崩溃恢复（不在本次范围）。

## 八、证据清单

| 文件 | 内容 | 产生方式 |
|---|---|---|
| 截图（6 张，已移出仓库到上节路径） | 见下表 | CDP 渲染管线 |
| `server-dashboard.png` | Server 面板（整窗，含侧边栏；该页无 host） | CDP 整窗截图 |
| `redis-dashboard.png` | Redis 面板·本地 Redis·7 个 key（内容区，侧边栏已裁除） | CDP rect 裁剪（x=248.5 起） |
| `memcached-dashboard.png` | Memcached 面板·本地 Memcached·4 个 key（同上） | 同上 |
| `connections-window.png` | 连接管理窗口·本地 Memcached 表单（`#editor`+footer 联合裁剪，避开既有记录） | CDP 元素联合裁剪 |
| `connections-editor-redis.png` | 连接管理窗口·本地 Redis 表单（`#editor` 裁剪） | 同上 |
| `connections-status-redis.png` | Apply 后 footer：`Not saved yet - press Save & Apply.` | 同上 |
| `capability-probe.txt` | 能力探测原始结果 | 手工整理 + 工具原文 |
| `probe-env.txt` | OS/显示器/GDI 失败原文 | `probe-env.ps1` |
| `app-verify.txt` | 启动核验（窗口/php/runtime.json/DevTools 版本原文） | `verify-app.ps1` |
| `php-backend.log` | php.exe 三次进程状态（pid/端口变迁：56215→52133→57391） | `verify-app.ps1` + `update-php-log.ps1` |
| `redis-keys-truth.txt` / `memcached-keys-truth.txt` | TCP 直连键真值（RESP 原文 / metadump 原文） | `probe-cache-truth.ps1` |
| `scripts/*.ps1`、`scripts/*.json`、`scripts/check-connections.mjs` | 全部复现脚本与 CDP 动作序列 | — |

另：为本次测试新增 dev-only 工具 `tools/cdp-form.mjs`（与既有 `tools/cdp.mjs`、`tools/fill-connection.mjs` 同族的 DevTools 检查器，无凭据、不属应用代码），如不需要可删除。测试结束时应用与连接管理窗口保持运行（未关闭），可直接上手复核。
