# CacheMainDesktop 验收测试更正报告（对《computer-use 验收测试报告》的修订）

- 更正轮日期：2026-10-06 11:00 – 11:20
- 性质：基于更正方（验收发起人）提供的灌数证据与复测原文，对同日早间
  `docs/computer-use-test-report.md` 中**两条错误结论**作出更正，并用真实可用的
  windows-mcp 重做了能力验证与界面状态核验。原报告其余内容未被推翻。
- 新增证据：`docs/computer-use-evidence/` 下 `mcp-verify.txt`、
  `mcp-snapshot-cachemaindesktop.txt`、`mcp-snapshot-ui.txt`，
  及 `scripts/` 下本轮脚本（`ui-dump.mjs`、`shot-content.mjs`、`restart-app-a11y.ps1`）。
- 本轮截图 `server-dashboard-a11y-restart.png` 已按仓库政策移出仓库 →
  `F:\原E盘\CacheMainDesktop-历史\调试记录\shots\computer-use`

---

## 一、更正声明（两条错误结论）

### 更正 1：windows-mcp 在环境里是可用的——「未配置」是会话可见性问题

- **原报告错误表述**（见原报告第二节及五节表格）：
  「`mcp__windows-mcp__*` 全系工具在本会话不可用」被表述为环境事实
  （`Unknown (no MCP server with this name is configured): windows-mcp`）。
- **正确结论**：windows-mcp 以 **Local scope** 配置在项目
  `F:\原E盘\CacheMainDesktop`（`~/.claude.json` 项目条目，`Command: uvx`、
  `Args: windows-mcp serve`）。原报告会话与更正轮主会话都是从**父目录
  `F:\原E盘`** 启动的，Local scope 按启动目录解析，故服务器整个未加载——
  「工具不可用」只是那两次会话站错了目录，不是环境未配置。
- **本轮证据（原文，均第一手）**：
  - 项目根执行 `claude mcp get windows-mcp` → `Scope: Local config (private to
    you in this project)`、`Status: ✔ Connected`；
  - 父目录执行同一命令 → `No MCP server named "windows-mcp"`；
  - 本轮从项目根以嵌套 `claude -p --allowedTools 'mcp__windows-mcp__*'` 实际
    调用了 DisplayInventory / Snapshot / Screenshot / App 四个工具，
    `WaitForMcpServers` 原文 `ready: true ... Connected: windows-mcp`，
    各工具返回原文见 `mcp-verify.txt`。
- **对原报告的连带影响**：第二节「前置事实」、第五节限制表第一行、第七节
  「未验证」清单中关于 windows-mcp 的表述作废，以本报告第二节矩阵为准；
  上轮的降级方案（PowerShell + CDP）本身仍真实有效，但其动机表述
  （「服务器未配置」）不再成立——真实动机是会话目录错误导致的工具缺席。

### 更正 2：缺失的 key 是 TTL 到期，不是被主动删除

- **原报告错误推断**（第三节 7b、第四节 3、第七节推断段）：
  「`session:abc`……判断是被主动删除而非过期」「key 被删除/过期（无 TTL 记录
  可查）」，倾向性地写成了主动删除。
- **正确结论**：灌数脚本写入时就带了短 TTL——`session:tmp`（EX 600）、
  `cache:page:home`（EX 3600）、Memcached `session:abc`（TTL 600）；容器
  `Restarts=0` 且已连续运行 18.7 小时，短 TTL key 必然早已自然过期。
  （本条证据来源：更正方提供的灌数时刻记录与容器状态；本轮未独立复现
  过期过程——过期事实无法事后从 Redis/Memcached 复盘，属引用更正方证据。）
- **对原报告的连带影响**：仅成因表述更正；**「Redis 7 个 key、Memcached
  4 个 key 是正确且预期的结果」「面板与库真值完全一致」这两个核心结论不变，
  且经过 TCP 直连独立验证，依然成立。**

## 二、windows-mcp 真实能力矩阵（本轮逐工具实测）

| 工具 | 状态 | 证据（原文节选，全文见 mcp-verify.txt） |
|---|---|---|
| DisplayInventory | **可用** | `{"result":[{"index":0,"device":"\\\\.\\DISPLAY65","primary":true,...2880x1800...,"scale":2}]}`（与更正方留档一致；上轮 probe-env 读到的 1440x900 为逻辑分辨率，单位不同不矛盾） |
| Snapshot | **可用（窗口级）／元素级对本应用不可见** | 两次成功返回（27,943 / 28,295 字符）：光标、虚拟桌面、约 40 个窗口表、UI 树；本应用两个窗口以命名叶子出现，**子树为空**；加 `--force-renderer-accessibility` 硬重启后复测仍为空（阴性）。同树中原生窗口「连锁售票管理系统」可下钻到按钮级 → 空子树是 Electron/UIA 暴露问题，非遍历器不下钻 |
| Screenshot | **不可用** | `Error capturing screenshot: screen grab failed. Please try again.`（本轮第一手复现，与更正方留档逐字一致；与上轮 GDI `CopyFromScreen`「句柄无效」互为印证） |
| App | **可调用；无列窗模式；RDP 下切换前台超时** | 工具仅有 launch/launch_executable/resize/switch 四模式；`{"mode":"switch","name":"CacheMainDesktop"}` 被接受并定位到应用，报 `Failed to bring CacheMainDesktop to the foreground within 1 second.`（环境性：RDP 会话后台进程抢前台受限；控制台会话未复测） |
| Click / Type 等其余 | **本轮未测试** | 无新增证据；上轮已全部走 CDP 等价路径 |

方法学说明：更正轮主会话工具清单里确实没有 windows-mcp 函数（WaitForMcpServers
原文 `Unknown (no MCP server with this name is configured)`，根因同更正 1），
故 4 项探测以「项目根目录 + 嵌套 `claude -p` + stream-json 落盘 tool_result」
执行——与更正方的验证方法一致，且 stream-json 里的 tool_result 是未经模型
转写的原文。**操作注意**：嵌套 `-p` 会话首跑时 windows-mcp 处于 pending
（uvx 冷启动），必须先 `WaitForMcpServers` 阻塞等待再调用工具，否则会复现
「工具不在列表」的假阴性。

## 三、本轮新增的 Snapshot 界面验证结果（任务 C）

从无障碍树**读到的**：主窗口与 Connections 编辑窗两个命名窗口节点。
**没读到的**：侧边栏三个导航项、Connections 按钮、服务器下拉框——UIA 子树
为空（含 a11y 旗标重启后复测）。详见 `mcp-snapshot-ui.txt`。

界面事实改经 CDP（任务书指定路径）补齐，均第一手：
- 导航 **Server / Redis / Memcached** 三个 `<a>` 可交互元素存在；
- 左下 **Connections** 按钮存在：`#pca-open-connections`，矩形 (16,683,216,38)，
  位于 `.pca-sidebar` 容器（上轮工具文档里的 `[data-pca-connections]` 选择器
  已过时，实际无该属性）；
- **下拉框选中值**：`#server_select` selectedIndex=2 →「本地 Redis -
  127.0.0.1:6379」；`#db_select` 显示 Database 0 (7 keys)，与库真值一致；
  Connections 编辑窗按钮 New/Cancel/Apply/Save & Apply、类型选中 Memcached。

附带核验：a11y 硬重启流程（清 `ELECTRON_RUN_AS_NODE` +
`--remote-debugging-port=19233 --force-renderer-accessibility`，等 18 秒）成功，
新实例 pid 66684 / 标题 Server - CacheMainDesktop / Responding=True；
connections.json 5 条完好；php 后端第 4 次变迁 pid 57104 端口 58397
（56215→52133→57391→58397）。补充截图 1 张：`server-dashboard-a11y-restart.png`
（内容区裁剪，侧边栏裁除）。

## 四、原报告经复核仍然成立的结论

1. **核心验收链路通过**：界面添加两条连接（含中文）→ 两步保存 →
   connections.json 落盘 → PHP 后端按设计重启 → 面板真实读出本地 Redis
   （7 key）/ 本地 Memcached（4 key）数据；中文正常、无报错、无乱码、
   无连接被拒。（本轮重启后 5 条连接完好、第 4 次后端重启正常，再添佐证。）
2. **面板与库真值完全一致**：Redis 7 key、Memcached 4 key 为正确且预期的
   结果（成因表述按本报告更正 1 修正为 TTL 过期）。
3. **两个代码级缺陷发现**：保存成功后状态栏文案为空（`??` 与真值判断语义
   不一致，`main.mjs` 返回 `warning:''` + `ui/connections.js:222`）；URL
   `server` 参数 0 基索引越界静默回落（`RedisDashboard.php:57`）。
4. **默认选中风险**（新增连接后面板默认选第一台同类型服务器，验收演示
   需用下拉框确认对象）与 **PowerShell 5.1 JSON 计数坑**。
5. 6 张既有截图与全部上轮证据有效保留。

## 五、仍存的限制

| 限制 | 状态与原因 |
|---|---|
| 屏幕级截图不可用 | `mcp__windows-mcp__Screenshot` → `screen grab failed`（本轮第一手复现）；GDI 等价探测 `CopyFromScreen`「句柄无效」。根因层面与桌面会话/截屏句柄有关，本轮未深究；出图仍走 CDP |
| windows-mcp 元素级对本应用不可见 | UIA 树止步于窗口标题；`--force-renderer-accessibility` 实测无效（阴性，两次）。若未来要做 OS 级 computer-use 驱动本应用，需在 Electron 侧显式开启可访问性暴露（如 `app.accessibilitySupportEnabled`）后复测，或继续以 CDP 为界面操作通道 |
| 会话目录敏感性 | windows-mcp 是 Local scope：只有从 `F:\原E盘\CacheMainDesktop` 启动的会话能加载。后续验收请在项目根目录启动 claude |
| CDP 截图固有差异 | 无鼠标指针、坐标为视口 CSS 像素（原报告已述，继续有效） |

## 六、「实际观察到」与「推断」的区分

**实际观察到（本轮第一手）**：第二节矩阵四工具的全部原文；第三节全部界面
事实（CDP）；a11y 重启流程结果、进程/端口/连接数复核；更正 1 的三条配置层
证据；截图 1 张。

**引用更正方证据（未独立复现）**：更正 2 的灌数短 TTL 与容器 Restarts=0 /
18.7 小时——过期过程无法事后复盘，按证据采信。

**推断（有证据链但未穷尽对照）**：App 前台失败归因于 RDP 环境（依据：错误
文本为前台激活超时 + 本会话确在 RDP 内；未在控制台会话对照）；UIA 空子树
归因于 Electron 可访问性暴露（依据：同树原生窗口可下钻 + a11y 旗标无效的
阴性对照；未读 Electron 源码定位开关）。观察到 Snapshot 枚举表含已销毁窗口
的过期句柄（1772672），提示可能存在僵尸条目，未深究。

## 七、保密声明

既有 LAN 连接的 IP 与密码未出现在本报告及任何新增证据文件/截图中；涉及处
一律以「既有连接（host 已脱敏）」表述，截图按惯例裁除侧边栏。
