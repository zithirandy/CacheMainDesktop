---
target: CacheMainDesktop webapp UI (layout.twig)
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:F:\\原E盘\\CacheMainDesktop\\webapp\\templates\\layout.twig"
target_fingerprint: "sha256:49ecfa94172754ee104df4aaaa3bf787354629518891303adfc4ed9e83203146"
target_path: "F:\\原E盘\\CacheMainDesktop\\webapp\\templates\\layout.twig"
timestamp: 2026-09-30T09-47-54Z
slug: webapp-templates-layout-twig
---
# CacheMainDesktop 界面结构分析报告（impeccable critique）

Method: dual-agent (A: critique-a · B: critique-b) — 2026-09-30，目标 webapp/templates/layout.twig（应用外壳）。
证据：6 张 1280×840 真实数据截图（docs/shots/）+ 源码 + 检测器 CLI/浏览器注入（CSP 严格，bypassCSP 后采集）。

## Design Health Score: 22/40（Acceptable）
1 系统状态可见性 3 | 2 匹配真实世界 1 | 3 用户控制 2 | 4 一致性 2 | 5 错误预防 2 | 6 识别而非回忆 3 | 7 灵活效率 2 | 8 美学极简 3 | 9 错误恢复 2 | 10 帮助文档 2
认知负荷 8 项：3 失败（分块>4、视觉层级、最少选择），根因集中在顶部导航区超载。

## Design Specificity：半定制
"phpCacheAdmin 穿了一件 ARDM 外套"。定制层是壳（三栏骨架/品牌/暗色），ARDM 灵魂（点 key 即见值的检视闭环）未移植——右栏给了静态统计而非 key 详情；Server 面板是上游自托管残留。检测器：CLI templates 0 findings；浏览器亮色 11/暗色 10（对比度、cyan 图标、嵌套卡、cramped-padding、width 过渡）；两份证据在"操作按钮系统"上互相印证。

## 优先问题
- [P1] 数据以合法值形态撒谎：epoch 0→"57 years ago"、负 TTL 无标记、SIZE "0,00B"、客户端/服务器版本混装。Fix: Never/EXPIRED 徽标/n-a/分标版本 → harden
- [P1] keys_list 工具栏/表头/批量操作无 sticky（Tab 栏已修，列表未修）：滚动后 Delete selected 不可达。Fix: 套 analysis.twig 的 sticky 模式，批量栏有选中时浮现 → polish
- [P1] Tab 行 1280 下截断（最后一项被吃掉）+ 11 项超载（认知负荷失败根因）。Fix: 数据浏览/诊断/工具三组 + More 菜单 → distill
- [P2] 操作按钮系统：亮色对比度 1.9–3.8:1（检测器实测）；红色语义三重过载；Delete all 与常规操作同排。Fix: 危险红专属+移位+确认，搜索中性化，提对比 → colorize+harden
- [P2] 连接窗与主窗两套 token、主题不同步（prefers-color-scheme vs 主窗 localStorage）、outline:none 焦点不可见。Fix: 公共 token + Electron 注入主题 + 焦点环 → colorize

## Personas 红旗
Alex: 无快捷键/144 页无跳页/滚动丢批量操作/Server 面板价值为零。Sam: outline:none/icon-only 无标签/禁用态全页最低对比/LIST 与 ZSET 同色。Riley: epoch 0 静默错/负 TTL 与统计矛盾/三种数字格式两套单位/双窗主题打架。

## 做得好的
Database 选择器自带计数；右栏 KV 速览扫描列；主题系统零 FOUC；连接窗空状态+渐进披露+行内校验。

## 次要观察
排序三角隐形；关键信息用最弱灰；Server 空卡残行；0.78% 进度条不可见；右栏 Stats 永远切底；两个上下文切换器分居两角；双品牌并存；user-select:none 拦复制；嵌套卡片×3；transition:width；暗色 Memcached 图标 cyan。

## 启发性问题
1. 右栏为何不放 key 详情而放 30s 才变的统计？选中即预览值，240px 价值翻倍？
2. 7197 键 144 页——浏览工具还是检索工具？搜索框为何不常驻第一控件？
3. 中文运维 + 欧式逗号小数 + 全英文界面，语言体系为谁服务？
