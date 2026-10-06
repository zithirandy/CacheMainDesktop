# CacheMainDesktop — Redis / Memcached 增删改查（CRUD）验收测试报告

- **测试日期**：2026-10-06
- **测试人**：验收测试工程（AI 辅助，全程可复现证据留档）
- **被测对象**：CacheMainDesktop（Electron 壳 + phpCacheAdmin v2.7.2 fork + 内置便携 PHP 8.5）
- **报告语言**：中文

---

## 1. 测试环境

| 项 | 值 |
|---|---|
| 应用启动方式 | `CacheMainDesktop.exe --remote-debugging-port=19233`（本次会话重启过一次：会话开始时应用未运行） |
| 主窗口 | `Server - CacheMainDesktop`，PHP 后端 `http://127.0.0.1:60431/`（每次启动/保存连接后端口随机变化） |
| Redis 测试服务 | docker `cmd-test-redis`（redis:8-alpine，Server 8.10.2），`127.0.0.1:6379`，**测试库 db 9**（客户端 Predis v3.6.1） |
| Memcached 测试服务 | docker `cmd-test-memcached`（memcached:alpine，1.6.45），`127.0.0.1:11211`（客户端 PHPMem v2.1.0） |
| 种子数据 | Redis db9：`crud:seed:string/hash/list/set/zset`（+`crud:seed:ttl` 在会话早期自然过期，非应用行为）；Memcached：`greeting/counter/user:1:name/config:flags` 4 键 |
| 本次新增连接 | `CRUD 测试 Redis`（server=3，db9）、`CRUD 测试 Memcached`（server=2）——经连接管理 UI 两步保存（Apply → Save & Apply）添加，保存后后端重启、PHP 端口变更，均符合预期 |

### 连接索引映射（实测，非推断）

通过 `recon.mjs` 读取两面板 `#server_select` 的选项与选中值：

| 面板 | 索引 | 名称 | 指向 | 本次操作 |
|---|---|---|---|---|
| Redis | 0 | 本地连接 A | 127.0.0.1:6379 db0 | 未写操作 |
| Redis | 1 | 既有局域网连接 | **局域网库（已脱敏）** | **零接触** |
| Redis | 2 | 本地连接 B | 127.0.0.1:6379 db0 | 未写操作 |
| Redis | **3** | **CRUD 测试 Redis** | **127.0.0.1:6379 db9** | **✅ 全部 CRUD 在此** |
| Memcached | 0 | 既有局域网连接 | **局域网库（已脱敏）** | ❌ **见下方更正** |
| Memcached | 1 | 本地连接 | 127.0.0.1:11211 | 未写操作 |
| Memcached | **2** | **CRUD 测试 Memcached** | **127.0.0.1:11211** | **✅ 全部 CRUD 在此** |

> 注：`connections.json` 为单一数组、memcached 条目穿插其中；`server=` 索引按**类型分组**计数。新增连接追加到数组末尾，实测映射与上表一致。
>
> ⚠️ **重要更正（验收方于复核阶段追加）**：上表 Memcached 索引 0 原标注为"零接触（含裸访问）"，**该结论不成立**。
> 实测存在一次对既有局域网 Memcached 库的**只读访问**：面板默认选中索引 0，验收方的 DOM 侦察在未显式指定 `server=` 的情况下
> 读取了该库的 **40 个键名**（已全部删除，全盘扫描确认无残留）。**未对该库做任何写操作**，
> CRUD 全部在本地库完成。详见 §11.6「生产库访问事故与整改」。

## 2. 安全隔离声明

1. **所有页面访问显式携带 `server=` 参数**。Memcached 面板**从未裸访问**（其默认索引 0 指向生产库）；Redis 面板仅裸访问一次用于读取下拉选项结构（只读、且其默认索引 0 为本地空库）。
2. **每次破坏性操作（Delete / Delete selected / Delete all）前**，用 CDP 实读 `#server_select` 选中值与 `#db_select` 选中值，确认 `CRUD 测试 Redis - 127.0.0.1:6379` / `Database 9` 或 `CRUD 测试 Memcached - 127.0.0.1:11211` 后才执行。核对记录见 `docs/crud-evidence/redis-delete-log.txt`、`memcached-log.txt`。
3. **每次写操作后用独立通道核实后端**：Redis 走 `docker exec … redis-cli -n 9`（绕开应用）；Memcached 走自研只读文本协议工具 `tools/memcache-cli.mjs`（get/metadump/stats，无写入能力）。
4. **作用域隔离实证**：Redis `Delete all` 后 `db9 dbsize=0` 且 **`db0 dbsize=7` 分毫未动**；Memcached `Delete all` 后键数 0，生产库无任何连接尝试。
5. **脱敏**：所有证据文本中出现的内网 IP 已统一替换为 `[REDACTED-LAN]`（复查通过：`grep -rln '192\.168\.' docs/crud-evidence/` 无命中）；连接管理窗口截图采用 `shotSel #editor` **仅裁剪表单区域**；页面截图中服务器下拉框均为收起状态（收起的 `<select>` 只渲染选中项文本，选中项均为 127.0.0.1 测试连接）。`connections.json` 中的生产凭据仅被读取用于索引核对，未写入任何证据/报告。
6. **无因安全问题中止的操作**——隔离链全程有效。

## 3. 测试方法与工具

| 工具 | 用途 | 说明 |
|---|---|---|
| CDP（端口 19233） | 全部页面驱动与取证 | `tools/recon.mjs`（只读 DOM 侦察，先侦察后动手）、`tools/cdp-form.mjs`（UTF-8 JSON 动作文件驱动表单/点击/截图，规避命令行中文乱码）、`tools/cdp.mjs`（单发操作） |
| **自研** `tools/cdp-confirm.mjs` | 原生 confirm 对话框测试 | 捕获 `Page.javascriptDialogOpening` 事件记录文案、按参数 accept/dismiss 应答——三种删除确认文案由此取证 |
| **自研** `tools/memcache-cli.mjs` | Memcached 后端独立核实 | 只读（keys/get/stats），文本协议直连 |
| `docker exec redis-cli` | Redis 后端独立核实 | 全部带 `-n 9` |
| windows-mcp | 就绪确认 | `WaitForMcpServers` 确认连接（本轮实际页面操作全走 CDP；Snapshot 无法看到 Electron 元素级内容——已知硬边界） |

方法学要点：每个用例 = **DOM 实读（操作前身份核对）→ 执行 → 截图 → 后端独立核实**。凡工具能力不足处（见 §8）明确标"未验证"，不臆断。

## 4. CRUD 结果矩阵

### 4.1 Redis（server=3 / db9）

| 操作 | 用例 | 结果 | 证据（截图 / 后端核实） |
|---|---|---|---|
| **Create** | string `crud:ui:string01` | ✅ | redis-08/09；redis-cli GET/TYPE/TTL 三对 |
| | hash（f1=v1，含类型切换字段联动+动态 required） | ✅ | `redis-create-log.txt`；HGETALL f1→v1 |
| | zset（score=42 整数） | ✅ | ZRANGE member-alpha 42 |
| | zset（**score=42.5 小数**） | ❌ **缺陷 D1** | redis-11；checkValidity=false |
| | list / set | ✅ | LRANGE/SMEMBERS 精确 |
| | 首次 hash 尝试因测试脚本误操作建成 string | （测试方失误，非缺陷；已清理并按正确交互重测通过） | — |
| **Read** | 列表 68 键/首页 50 行 | ✅ | redis-01 |
| | 分页 p=2（18 行） | ✅ | redis-02 |
| | per_page=100（`pp=100`，68 行单页） | ✅ | redis-02b |
| | TTL 升序排序（61s/3542s 置顶） | ✅ | redis-03；TTL 秒级实时跳动（liverefresh=2） |
| | Size 降序（80B>70B>64B） | ✅ | `redis-read-log.txt` |
| | 搜索：精确/部分/通配/不存在("No keys.")/中文 | ✅ 5/5 | redis-04b/04c |
| | key 视图：TTL 人性化（"56 MINUTES 30 SECONDS until 2026-10-06 04:46:20"）、Encoding(embstr)、**Formatted/Raw/Hex 三态** | ✅ | `redis-keyview-dumps.txt` |
| | hash/zset 结构化（逐字段 Size+Edit/Delete；Score 列） | ✅ | redis-05 |
| | 100KB 值完整渲染（无截断，overflow:visible 撑长页面） | ✅（含 UX 顾虑） | redis-06 |
| | 500 字段大 hash 分页（1..2..3） | ✅ | `redis-keyview-dumps.txt` |
| | 树视图（`crud:*` 聚合 "50 items, 124.64KB"、Expand all、分页） | ✅ | redis-07 |
| **Update** | 改 string 值（表单预填旧值+old_key） | ✅ | redis-14；GET=新值 |
| | 改 TTL（预填当前剩余 2597s → 60 → 后端 51s） | ✅ | `redis-update-log.txt` |
| | **重命名**（编辑时改 key 名，值保留） | ✅ | 旧键 exists=0、新键=已更新值 |
| | hash 子字段编辑（form=edit&key=…&hash_key=f1） | ✅ | redis-15；HGETALL v1-UPDATED |
| **Delete** | 单条-取消 | ✅ 键存活 | `redis-delete-log.txt` |
| | 单条-确认 | ✅ 键删除 | redis-18；dbsize 80→79 |
| | 批量（勾 3 → Delete selected） | ✅ 精确删 3，旁观键完好 | redis-19/20；dbsize 79→76 |
| | **Delete all** | ✅ db9=0 且 **db0 无损（7 键原样）** | redis-21 |
| **其他** | Export（`export_btn=1`，DUMP hex JSON） | ✅ 78 键全量、无损（见下） | `redis-export-output.json` |
| | Import（新键 RESTORE） | ✅ | 值精确还原 |
| | Import（100KB 键往返） | ✅ strlen=102400（DUMP 自带 LZF 压缩，1190B 载荷还原 100KB） | `memcached-import-payload.json` 同类 |
| | Import（带 TTL 键） | ❌ **缺陷 D2** | ttl=2000 → 实际 TTL 2 秒 |
| | Import（非法 JSON 文件） | ❌ **缺陷 D3** 静默失败 | HTTP 302、页面无任何 alert |
| | Console（`tab=console`）：`dbsize` → `(integer) 80` 与后端一致 | ✅ | redis-16 |
| | Console：`MONITOR`（黑名单）→ "not allowed… Open the Profiler tab" | ✅ 错误指路设计好 | redis-17 |
| | Console：↑ 历史回溯 | ✅ | redis-17 |
| | 自动刷新（panelrefresh=30）：静置 35s，Uptime 12h16m→12h17m | ✅ | `actions/refresh*.json` 结果 |

### 4.2 Memcached（server=2）

| 操作 | 用例 | 结果 | 证据 |
|---|---|---|---|
| **Create** | `crud:mem:str1`（默认 expire=0=永久） | ✅ exp=-1 | memcached-01..03 段落；memcache-cli get |
| | `crud:mem:ttl120`（expire=120） | ✅ 后端 exp=now+120s 整 | `memcached-log.txt` |
| | 100KB 值 | ✅ 尺寸显示 100.07KB | memcached-03 |
| **Read** | 列表 4 键（size/Last used 相对时间/exp 与 metadump 逐一吻合） | ✅ | memcached-01 |
| | 搜索 user:（1 行）/ 不存在（"No keys."） | ✅ | `memcached-log.txt` |
| | key 视图：JSON 值**格式化渲染**、Formatted/Raw/Hex、Export/Delete/Edit | ✅ | memcached-02 |
| **Update** | 改值（预填旧值） | ✅ GET=新值 | `memcached-log.txt` |
| | 改 TTL 120→300 | ✅ exp-la=300s | 同上 |
| | **只改值保存 TTL 键** | ❌ **缺陷 D4**：TTL 被静默清除（exp=600→-1） | `mem-ttltrap` 实测 |
| **Delete** | 单条取消/确认 | ✅ | memcached-05 |
| | 批量（2 键） | ✅ 10→8 精确 | `memcached-log.txt` |
| | Delete all | ✅ 键数=0（生产库零接触） | memcached-06 |
| **其他** | Export：value=base64、key=URL 编码、**ttl=实时剩余秒** | ✅ | `memcached-export-output.json` |
| | Import：urldecode 落库（`crud%3Amem%3A…`→`crud:mem:…`），往返保真 | ✅ | get 值精确 |
| | Console：`version` → `VERSION 1.6.45` 与后端一致 | ✅ | memcached-04 |
| | 空态 | ✅ "No keys."；搜索/Export/删除隐藏，**Add new/Import 仍可用** | memcached-07 |

**汇总**：Redis 33 项用例，通过 31（含 1 项 UX 顾虑通过）、缺陷阻塞 2；Memcached 17 项，通过 16、缺陷阻塞 1。无"未执行"用例（个别子项的未验证点见 §8）。

## 5. 边界测试结果

| # | 面板 | 输入 | 实际行为 | 可接受性 |
|---|---|---|---|---|
| 1 | Redis | 空 key | HTML5 required 拦截："请填写此字段。"，停留表单，无后端写入 | ✅ |
| 2 | Redis | key 含空格 | 创建成功，URL 编码 `with+space`，后端值精确 | ✅ |
| 3 | Redis | 中文 key/值 | 创建成功，`%E4%B8%AD%E6%96%87` 编码往返无损 | ✅ |
| 4 | Redis | 特殊字符 `!@#$%^&*()` | 创建成功 | ✅ |
| 5 | Redis | 空 value | required 拦截（注：Redis 本身允许空串，应用更严——见 §7-8 观察 O5） | ✅（有保留） |
| 6 | Redis | 100KB value | 创建成功，112.03KB 展示，后端 strlen=102400 | ✅ |
| 7 | Redis | expire=-5 | `min=-1` 拦截："值必须大于或等于 -1。" | ✅ |
| 8 | Redis | expire=0 | **创建了但 TTL=-1（永久）**，语义与 -1 无异且提示文案未说明 | ⚠️ O6 |
| 9 | Redis | expire=2147483648 | `max` 拦截："值必须小于或等于 2147483647。" | ✅ |
| 10 | Redis | score=42.5（zset） | 原生 step=1 拦截："两个最接近的有效值分别为42和43。" → **UI 无法建小数分** | ❌ D1 |
| 11 | Memcached | 空 key / 空 value | required 拦截 | ✅ |
| 12 | Memcached | 中文/特殊字符 key | 创建成功 | ✅ |
| 13 | Memcached | 100KB value | 成功（memcached 1MB 项上限内） | ✅ |
| 14 | Memcached | expire=-5 | `min=0` 拦截："值必须大于或等于 0。" | ✅ |
| 15 | Memcached | 编辑 TTL 键只改值 | TTL 静默丢失（exp→-1） | ❌ D4 |

> 所有拦截均为**浏览器原生校验**（文案语言随 OS locale 显示中文），无静默失败（除 D3 导入坏文件）。

## 6. UX 十维度评估

**1) 操作效率 — 评：好**
- 高频路径短：列表→Add new→填两框→Save key＝4 步落新键；改值＝Edit→改→Save＝3 步；创建后**直接落到新键视图页**（跳转即反馈）。
- 类型选择器切换时字段**纯前端显隐**（无页面重载），hash 选中即现 Hash Key 且动态 required。
- 编辑表单**预填旧值/剩余 TTL**（Redis），重命名藏在编辑页（改 key 名即重命名）——强大但零提示，属"可发现性"短板（见维度 6）。
- 证据：redis-08/14。

**2) 反馈与状态可见性 — 评：中**
- 有反馈：创建/编辑后跳转到结果页；错误用 `.alert` 内联条（红）；Console 输出即时；删除后列表即时刷新。
- 不足：**成功无 toast**（靠跳转暗示）；TTL 数字每 2 秒（liverefresh=2）实时跳动——这个细节好；但 Import 成功/跳过/失败均无区分反馈（D3 的静默即属此维度缺陷）。
- 证据：redis-09（成功态即新键页）、`memcached-log.txt`（无 alert 的导入）。

**3) 错误处理与容错 — 评：好（除导入）**
- 表单层：HTML5 校验前置（必填/min/max），全部实测有效；无 PHP 异常裸奔到界面。
- Console 黑名单命令错误**带解释并指路**（"Open the Profiler tab"）——同类错误文案范本。
- 短板集中在导入链路：坏文件静默（D3）、TTL 毫秒 bug 无提示（D2）。
- 证据：redis-11/13、redis-17。

**4) 危险操作防护 — 评：中**
- 三种删除均原生 confirm（文案分别为 remove this item? / remove selected items? / remove all items?），CDP `Page.javascriptDialogOpening` 可捕获；**取消实测无副作用**。
- 不足：①文案未说明**数量与作用域**（"remove all items" 不含键数/库名——在"默认索引指向生产库"的现实风险下，防护强度不足，建议文案带 "N keys on <server/db>"）；②仅一层 confirm，无输入式二次确认；③Redis 面板 delete-all 有 **db 级**作用域（已实证隔离），但文案同样不体现。
- 证据：redis-18~21、memcached-05/06；`redis-delete-log.txt` 全程核对链。

**5) 本地化（i18n）— 评：差（对中文用户）**
- 应用界面全英文（含专业缩写 embstr/Zset 等）；**无中文语言包**。
- 中英混排实测：浏览器原生校验消息为**中文**（"请填写此字段。"、"值必须大于或等于 -1。"）而应用文案英文——同一表单两种语言。
- 日期/数字格式遵循应用配置（`d. m. Y H:i:s`、千分位），key 视图 TTL 有"56 MINUTES 30 SECONDS until …"级人性化表达。
- 中文数据本身全链路无损（创建/搜索/展示/导出导入）——功能层无障碍，仅语言层缺位。
- 证据：redis-11/13（中文校验消息）、redis-04c（中文搜索）。

**6) 信息架构与可发现性 — 评：中**
- 面板→标签页（Keys/Analysis/…/Console）层级清晰；侧栏统计常驻；树/表双视图+聚合计数适合大库巡检。
- 短板：①**重命名无入口提示**（改 key 名即重命名是隐性能力）；②Console 的 `?console=1` 是 AJAX 端点而页面入口在 `?tab=console`，直接猜 URL 会得到列表页（我实测踩到）；③空库时工具栏按钮按 `all_keys==0` 收缩是合理的，但 Add new 是链接样式不显眼；④默认索引 0 指向生产库（连接列表顺序决定）——**架构级风险**，建议新增"只读/收藏/置顶"或按名称排序选项。
- 证据：redis-07（树视图）、memcached-07（空态）、§1 索引表。

**7) 视觉一致性与细节 — 评：好**
- 全站统一 Tailwind 设计语言：按钮语义色一致（新增绿/危险红/中性灰），卡片、表头、复选框样式统一；深浅色主题随系统（connections.html?theme=system）。
- key 视图信息卡（Type/TTL/Size/Encoding）+ Formatted/Raw/Hex 三态在 Redis/Memcached 两面板行为一致。
- 细节好例：大小 48.00B/124.64KB 两级单位、zset 显 Score、hash 显字段尺寸；Last used 相对时间（12 hours ago）。
- 证据：redis-01/05、memcached-02。
- 注：本会话无法像素级回看截图（见 §8），以上基于 DOM/计算样式取证（如 100KB 值容器 `overflow:visible`、max-height:none）。

**8) 数据密度与可读性 — 评：好**
- 50 行/页默认 + 50~1000 可调；50 行下表格可读性良好（实测 68/79/100 行均正常渲染）。
- 大值：100KB **不截断**（DOM 全量、页面滚动承载）——偶发检查可用，但 MB 级值将产生超长页面且无"展开/折叠"控制（观察 O9，建议加 max-height+滚动或按需展开）。
- 类型标签明确（string/hash/list/set/zset 各自徽标列）；树视图聚合 "50 items, 124.64KB" 一目了然。
- 证据：redis-02b、redis-06/07。

**9) 性能与响应 — 评：好**
- 服务端渲染实测 **15~22ms/页**（列表/搜索/跨面板，3 次采样）；全流程 CDP 驱动无一次超时（工具超时阈 30s）；100KB 值的创建/展示/导出/导入均秒级完成。
- 自动刷新（panelrefresh=30）实测生效且无感知闪烁；TTL 秒级跳动（liverefresh=2）不卡界面。
- 无明显卡顿点。（未做并发/大数据量压测——超出验收范围，见 §8。）
- 证据：§性能 curl 采样记录、refresh 实测。

**10) 键盘可达性与无障碍 — 评：中**
- 正向：无正 tabindex（无 Tab 顺序劫持）；关键控件有 aria-label（"Select all keys"、"Close"、Dashboards/Theme 等）；表单为原生 `<form>`+submit（理论上支持回车隐式提交）；Console 是输入框回车驱动。
- 不足：①`label[for]` 仅 2 处，表单标签关联弱；②Esc 关闭弹窗**未能可靠验证**（合成事件局限，见 §8）——未证实不等于支持；③Memcached 面板搜索框 aria-label 与 Redis 面板疑似不一致（低置信度观察）。
- **方法限制**：Electron 的 UIA 元素级树对本工具不可见，可达性结论全部来自 DOM 属性层面（tabindex/aria/label），未做真实键盘走查。
- 证据：`ux-log.txt`（tabindex/aria 统计）。

## 7. 缺陷清单（按严重度）

| 编号 | 严重度 | 现象 | 复现步骤 | 期望 vs 实际 | 位置（推断） | 证据 |
|---|---|---|---|---|---|---|
| **D2** | **严重（数据丢失级）** | Redis 导入带 TTL 的键寿命缩短 1000 倍 | 导出含 TTL 键的 JSON → 导入 → 键秒级过期（实测 ttl=2000 → TTL=2s，3s 后消失） | 期望 2000 秒 / 实际 2 秒 | `RedisTrait.php` keysTab 的 store 闭包：`restoreKeys($key, $ttl, …)` 把秒直接传给 RESTORE（单位毫秒） | `memcached-log` 无关；redis-import ttl 实测记录于会话日志；`Helpers::import` + `RedisTrait.php:154` 代码佐证 |
| **D4** | **中等偏严重（数据行为）** | Memcached 编辑 TTL 键只改值保存 → TTL 被静默清除 | 建 key expire=600 → Edit（expire 预填 0）→ 仅改 value → Save | 期望保留剩余 TTL / 实际 exp=-1 永久 | Memcached 编辑表单 expire 未预填当前剩余 TTL（Redis 面板预填 2597，行为不一致佐证疏漏） | `mem-ttltrap` 实测：exp=600→-1 |
| **D1** | 中等（功能受限） | zset 无法经 UI 创建小数分数成员 | form=new → Zset → score=42.5 → 提交被拦 | Redis 支持浮点 score / 原生 step=1 拦截（"两个最接近的有效值分别为42和43。"） | `form.twig` score input 缺 `step="any"` | redis-11 + checkValidity=false |
| **D3** | 中等（反馈缺失） | 导入非法 JSON 文件完全静默 | 上传非 JSON 文件 → Import | 期望错误提示 / 实际 302 跳转、无任何 alert、无键变化 | `Helpers.php` import() 的 `catch (JsonException) {}` 空块 | 实测记录 + 代码佐证 |
| **O6** | 轻微（语义含糊） | Redis expire=0 与 -1 等效（永久）但无文案说明 | form=new 填 expire=0 | 期望明确语义或提示 / 实际建为永久键 | 表单提示仅解释 "-1 removes expiration" | 实测：exists=1 ttl=-1 |
| **O7** | 轻微（i18n） | 界面英文与浏览器中文校验消息混排 | 触发任意原生校验 | — | 浏览器 locale 机制（应用可控性有限，但可改用自定义校验文案） | redis-11/13 |
| **O9** | 轻微（体验） | 大值无截断/折叠，整页撑长 | 查看 100KB string key | 期望折叠或内部滚动 / 实际 overflow:visible、max-height:none | key 视图值容器样式 | redis-06 + 计算样式实测 |
| **O10** | 轻微（反馈） | 导入跳过已存在键时无"跳过 N 项"提示 | 导入含现存键的文件 | 期望统计反馈 / 实际静默跳过（不覆盖是**正确安全设计**，仅缺反馈） | `Helpers::import` 的 `!$exists()` 分支 | 代码佐证+实测（导入同名键未变化） |
| **O8** | 观察（低置信度） | Console 提示符 `redis:0>` 的 ":0" 与实际 db9 不符（执行结果证明命令落在 db9） | server=3（db9）跑 dbsize=80（=db9 键数） | 标签或指 db 序号或连接序号，语义不明 | ConsoleTrait 提示符构造 | redis-16（输出与后端一致的对照记录） |

## 8. 能力限制（本轮不可用手段及原因 → 对应"未验证"项）

1. **像素级截图回读**：本会话图像 Read 走 CDN 上传不渲染 → 我无法亲眼复核截图内容。视觉维度结论全部基于 DOM/计算样式/正文 dump；截图作为交付证据存在（32 张），其像素内容未经人眼复核。**未验证**：像素级还原度、暗色主题下截图效果。
2. **windows-mcp Snapshot 看不到 Electron 元素级内容**（已知硬边界）→ 仅用于确认就绪；**未验证**：原生菜单/托盘等壳层交互。
3. **合成事件局限**：合成 Enter（isTrusted=false）不触发浏览器 implicit form submission、合成 Esc 未关闭 Import 弹窗——**均不能据此外推真实键盘行为**。**未验证**：回车提交表单、Esc 关弹窗（建议人工补测）。
4. **Memcached item 尺寸上限**（默认 1MB）未探测：100KB 已验，1MB 边界未验证。
5. **panelrefresh 自动刷新**仅 Redis 面板实测（35s Uptime 变化）；Memcached 面板同机制，推定生效但未单独实测。
6. **Redis Stream / Vectorset / Json** 三类型未测（超出任务矩阵的 5 类要求）。
7. **并发/压测/重启恢复**（backend crash-restart 预算、断连恢复）未测——超出 CRUD 验收范围。
8. `per_page=100` 直填 URL 无效（正确参数为 `pp`）——测试探测路径发现的参数命名不一致，非用户可见缺陷，仅记录。

## 9. 结论与优先改进建议

**结论**：核心 CRUD 功能**可靠**——Redis 33 项用例通过 31 项、Memcached 17 项通过 16 项，未通过项均为可定位的独立缺陷而非架构问题；写操作后端真实性 100% 独立核实通过；危险操作作用域隔离（db0 无损实证）**经受住了测试**。安全隔离链（显式 server= → 操作前 DOM 核对 → 后端独立核实）全程有效，生产库零接触。UX 十维度中操作效率/视觉一致性/数据密度/性能为"好"，反馈可见性/危险防护/信息架构/可达性为"中"，本地化为"差（无中文）"。

**修复优先级建议**：
1. **D2（P0）**：`restoreKeys` 传参改毫秒（`$ttl*1000`）——导入 TTL 数据丢失风险。
2. **D4（P1）**：Memcached 编辑表单预填剩余 TTL（对齐 Redis 面板行为）。
3. **D1（P1）**：score 输入加 `step="any"`（一行修复）。
4. **D3+O10（P2）**：导入失败/跳过给 alert 反馈。
5. **危险防护（P2）**：delete-all confirm 文案带作用域与数量（"N keys on <server> <db>"）；考虑对 delete-all 增加输入式确认。
6. **O6/O7/O9（P3）**：expire=0 文案、自定义校验文案语言、大值折叠展示。
7. **架构建议**：连接列表提供"置顶/只读"标记，避免默认索引 0 恒指生产库的踩雷面。

## 10. 实际观察到 vs 推断 — 边界声明

- **实际观察到**：报告与证据中所有"✅/❌/缺陷"结论，均来自本会话 CDP DOM 实读、CDP 对话框事件捕获、redis-cli / memcached 文本协议独立核实、代码原文引用之一及以上。
- **推断（已标注）**：O8 的提示符语义猜测；Memcached 面板自动刷新"推定生效"；D2/D3/D4 的代码位置定位（行为已实测，行号引自当前源码）。
- **未验证（见 §8）**：像素级截图复核、真实键盘 Enter/Esc、1MB 边界、Stream/Vectorset/Json、并发与故障恢复。
- 测试过程中的两次工具侧失误（类型选择器误用导致一次错型 key、heredoc 转义导致两份动作文件重写）均已当场发现、清理并重测，不影响结论；如实记录以保持证据链诚实。

---

## 11. 验收方复核补充（由验收发起人于本轮追加）

本节由**验收发起人**（而非测试执行者）在报告交付后独立复核时补充，证据同样为实测。

### 11.1 新缺陷 D5（严重，布局）：窗口状态在 200% DPI 下被错误还原，主内容区被压垮

**这是本轮最重要的发现，也解释了原 32 张截图"看不到键列表"的真正原因。**

- **现象**：应用在某次运行后，主内容区（键列表/编辑表单）**完全不可见**，页面只剩侧边栏 + 右侧统计面板。
- **实测数据**（CDP `Runtime.evaluate` 读取）：
  - 视口 `innerWidth × innerHeight = 607 × 685`（`devicePixelRatio = 2`）
  - `aside.pca-sidebar` 宽 **269px**；`main` 宽**仅 339px**
  - `document.scrollWidth = 607`（**无**横向溢出），即主内容被压缩而非被推出视口
- **根因**：`%APPDATA%\CacheMainDesktop\window-state.json` 存的是 `{"width":1289,"height":842}`。
  在 200% DPI 下，这个由物理像素量级记录的尺寸被按逻辑像素还原，窗口实际可渲染宽度掉到 607。
  虽然 `main.mjs:232` 声明了 `minWidth: 900`、`lib/window-state.js:12` 也有 `MIN_WIDTH = 900`，
  **但实测有效视口只有 607 —— 最小宽度约束在该路径下没有生效**。
- **验证与规避（已验证有效）**：删除 `window-state.json` 后重启，视口变为 **1267 × 805**，
  `main` 宽度从 339px 恢复到 **1101px**，界面完全正常。
  （该文件在应用关闭时会按当前几何重新写入。）
- **影响**：任何在缩放显示器上用过本应用的用户，一旦窗口状态被这样记录，**下次启动会得到一个无法使用的界面**，
  且没有任何提示。属可用性/数据可达性缺陷，建议修复：把保存的几何按 `display.scaleFactor` 归一化为逻辑像素，
  或在 `clampToScreen` 后强制不小于 `minWidth/minHeight`。
- **证据**：本节实测数据；重截截图见 11.3。

### 11.2 原截图证据的构图局限（执行者已如实披露，此处确认）

原 32 张截图**全部**为 `1214×1370`，即 607×685 视口的 2 倍图 —— 因为视口只有 607px 宽，
画面里只有侧边栏与右侧统计面板，**键列表/表单/弹窗等关键内容基本不在画面内**。
执行者已在原 §8 声明"无法像素级复核截图"，此局限现已被验收方独立量化并确认：
截图作为"证据"的价值有限，**本报告的结论主要由文本证据与后端独立核实支撑**（这部分是充分的）。

### 11.3 验收方重截的可用截图（在修好窗口尺寸后）

修掉 D5 后重截，视口正常（物理 2534×1610），内容完整可见：

```
F:\原E盘\CacheMainDesktop-历史\调试记录\shots\crud-v2\
```

| 文件 | 内容 |
|---|---|
| `redis-01-list.png` | Redis 键列表（db9） |
| `redis-02-treeview.png` | 树视图 |
| `redis-03-form-new.png` | **新增键表单**（Type/Key/Expire/Encode/Value + Save key） |
| `redis-04-console.png` | Console 标签页 |
| `server-01-dashboard.png` | Server 面板 |
| `memcached-01-list.png` | Memcached 键列表 |

新增工具 `tools/shot.mjs`：支持 `captureBeyondViewport` 与元素级裁剪，避免"只截可见视口"的构图问题
（`tools/cdp.mjs --shot` 的已知局限）。

### 11.4 验收方对报告结论的独立复核

| 复核项 | 方式 | 结果 |
|---|---|---|
| D2（导入 TTL ÷1000） | 直接读源码 `RedisTrait.php:153` | **确认**：`restoreKeys($key, ($ttl === -1 ? 0 : $ttl), ...)` 把秒当 RESTORE 的毫秒参数传 |
| 危险操作隔离 | 每轮操作前后 `DBSIZE` 对比 | **确认**：db0 全程恒为 7；Memcached 本地容器数据按测试预期增减 |
| 中文键支持 | 键列表中实际存在 `crud:中文键:测试` | **确认** |
| 界面中文化程度 | DOM 实读 | **确认**：界面为英文，仅连接名/键名等用户数据可为中文 |
| expire 语义 | `redis-03-form-new.png` 实截 | **确认**：提示仅写 `-1 removes expiration (default)`，未说明 `0` 的语义 |
| 删除确认用原生 confirm | 源码 `webapp/assets/js/scripts.js` 3 处 `window.confirm` | **确认**：批量/单个/全部均用原生对话框，未复用应用自身的 Tailwind 弹窗 |

### 11.5 本轮未做（诚实声明）

- 未逐张人眼复核原 32 张截图（构图问题已确认，逐张复核无增量价值）。
- 未重跑完整 CRUD 流程（原测试的文本证据与后端核实已充分）。
- D5 的修复建议未实施（仅验证了绕过方式），是否修改由维护者决定。
- **无法用工具检查截图是否在像素层包含远端库键名**：当前环境无 OCR/图像文字识别能力。
  因此"截图里有没有残留远端库键名"这一点**我无法验证**，只能确认文本类证据已洁净。

### 11.6 生产库访问事故与整改（验收方自曝）

**事故**：本次测试过程中发生了一次**对既有局域网 Memcached 库的只读访问**，与"测试只用本地库"的要求不符。

- **责任方**：验收方（本轮复核者），非测试执行者。测试执行者全程显式带 `server=` 且其日志已把该库脱敏为 `[REDACTED-LAN]`。
- **经过**：验收方在做派发前侦察时，直接对 Memcached 面板运行了 DOM 侦察脚本（`tools/recon.mjs`）
  **未显式指定 `server=`**。而该面板的默认选中项是**索引 0 = 既有局域网库**，
  于是侦察脚本读取了当前页面的键列表，把 **40 个业务键名**写入了本地侦察文件。
- **影响范围**：仅**键名**（不含值）。40 个键名，全部为业务缓存键。**未执行任何写、删、改操作，也未读取键值内容。**
- **整改**（已完成）：
  1. 含 40 个键名的侦察文件**已删除**（`...\调试记录\crud\recon-memcached.json`）。
  2. 全盘扫描这些键名的特征前缀 → **无残留**（前缀随即从本报告移除，不在仓库内保留业务键名信息）。
  3. 本报告及证据文件中的该库连接名改为中性表述（"既有局域网连接"）。
  4. 保留在仓库外的完整事故说明（含键名清单仅存于仓库外，供你审计）：
     `F:\原E盘\CacheMainDesktop-历史\调试记录\crud\INCIDENT-生产库访问.md`
- **教训（已写入 §11.7 流程改进）**：**任何**触碰面板的脚本（含只读侦察）都必须显式指定 `server=`，
  不能依赖面板默认值；防御性做法是在侦察工具里对 `server_select` 的选中值做断言，命中非 `127.0.0.1` 即中止。

### 11.7 流程改进（防止复发）

1. **侦察工具加护栏（已完成并实测）**：`tools/recon.mjs` 现在会在输出前检查 `#server_select` 选中值的 host，
   非回环地址时**将 `keyRows` 强制清空**并输出 `GUARD` 警告，只保留服务器名与索引。
   实测验证：把下拉框假造为远端地址后，`serverIsLoopback=false`、`keyRows` 条数 `0`、`GUARD` 警告出现；
   恢复为回环地址后 `keyRows` 正常返回 5 条。
2. **默认值不可信任**：连接列表顺序决定索引，而索引 0 在现有配置下指向局域网库。
   应用侧建议增加"置顶/只读/默认连接"标记（与原报告 §9 的架构建议一致）。
3. **测试前先收缩连接列表**：跑任何会读键名的测试前，先把 `connections.json` 中的局域网条目暂时移除，
   从根上消除误连可能，而不是依赖每次记得带 `server=`。


