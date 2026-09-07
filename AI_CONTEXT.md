# AI_CONTEXT.md

> 本文件是本项目所有 AI Coding Agent 共用的持久化项目上下文。
>
> This file is the shared persistent project context for all AI coding agents.
>
> 本文件只记录对未来 Agent 有长期价值的信息，保持简洁、准确，并始终反映项目当前的有效状态。


---

# 1. 项目概览 / Project Overview

## 项目用途 / Purpose

「到期那天 In Time」（原名「开封守护 OpenKeep」，已更名，见决策 #3）是一个**纯原生微信小程序**，用于记录家庭物品（冷藏、冷冻、药品、化妆品等）的开封日期与保质期，用**红（已过期）/ 黄（临期）/ 绿（安全）**三色状态看板实时提醒，并可将到期提醒写入手机系统日历。

核心定位：克制、温暖、轻奢的家庭健康记录工具。附带「历史上的今天」轻内容模块（本地数据）。

## 当前阶段 / Current Stage

开发后期 / 真机测试与修缺陷阶段。核心功能已全部完成并通过多轮安卓 / iOS 真机测试修复，用户正在自行真机验证。

## 技术栈 / Technology Stack

- 主要语言 / Primary language: JavaScript（ES6，无 TypeScript）
- 后端框架 / Backend framework: **无**（纯本地，禁用云开发与网络请求）
- 前端框架 / Frontend framework: 原生微信小程序（WXML / WXSS / JS / JSON，无 uni-app / Taro / Vue / React / 第三方 UI 库 / 图标库 / CDN）
- Runtime: 微信小程序基础库；最低兼容 2.15.0，开发工具当前使用 3.17.1
- 数据库 / Database: 无。仅 `wx.setStorage` 本地缓存 + 文件系统（照片持久化到 `USER_DATA_PATH`）
- 基础设施 / Infrastructure: 无。appid `wx391039438b36bcb8`（见 `project.config.json`）
- 其他重要技术 / Other important technologies:
  - 深浅色主题：单一事实来源 `settings.theme`（system/light/dark）→ `app.js resolveTheme()` → `globalData.effectiveTheme` → 一律经 `app.isDark()` 读取；`app.wxss` CSS 变量双套色板 + `theme.json` 只作 JS 生效前的首帧兜底（详见决策 6）
  - 自定义 tabBar（`custom: true`）悬浮胶囊样式，CSS 绘制图标
  - Node.js 构建脚本仅用于离线生成历史数据（`tools/`，不参与小程序运行）


---

# 2. 项目架构 / Architecture

## 整体架构 / High-Level Architecture

三层结构，全部运行在小程序端：

```
pages/（7 个页面） + custom-tab-bar/（自定义导航）
    ↓ 依赖
components/（4 个展示组件） + utils/（6 个工具模块）
    ↓ 依赖
wx.setStorage 本地缓存（版本化 key） + USER_DATA_PATH 文件（照片）
```

关键约束：**红黄绿状态只有一个计算来源**（`utils/record.js`），**日期计算只走** `utils/date.js`（禁止 `new Date('YYYY-MM-DD')`，一律 `new Date(y, m-1, d)` 本地构造，避免时区偏差），**日历写入只走** `utils/calendar.js`。

## 主要模块 / Important Modules

| 模块 / Module | 作用 / Purpose | 当前状态 / Status |
| ------------- | -------------- | ----------------- |
| `miniprogram/app.js` | 全局设置、主题单一事实来源（`resolveTheme` / `effectiveTheme` / `isDark`）、主题变化监听（`onTheme`）、原生 chrome（`applyChrome` / `syncPageChrome`） | 稳定 |
| `pages/dashboard` | 首页看板：问候、三色统计、主提醒卡、近期保修卡（30 天内过保）、筛选、列表、悬浮添加按钮、历史预览卡、引导页 | 稳定 |
| `pages/items` | 全部物品：搜索 + 分类/状态/排序固定网格筛选（非横滑）、下拉刷新（自定义文案反馈）、搜索框键盘避让、悬浮添加 fab（有记录时显示，空态用流内 CTA 不重复）；**零记录时隐藏筛选面板**（无物可筛属无效 UI，且避免空态「＋ 添加物品」CTA 被下压进悬浮胶囊 tabBar 遮挡区——iOS 模拟矮视口 + safe-area 曾复现按钮被胶囊栏挡住，安卓高视口不复现；修胶囊栏遮挡时勿改 tabBar 本身，tabBar 含 safe-area 偏移是各 fab 避让的基准） | 稳定；已安卓真机验证 |
| `pages/item-form` | 新增/编辑：封面照片持久化、保质期（天/月/年）、可选开封天数、存放位置、快捷反推 | 稳定 |
| `pages/item-detail` | 详情、编辑/删除、单条写入日历 | 稳定 |
| `pages/calendar-import` | 批量导入日历：勾选、全选、跳过已导入、逐条串行写入、进度与结果统计 | 稳定（含安卓手势链方案） |
| `pages/history` | 历史上的今天：缓存→在线（可选未启用）→本地 366 天数据兜底 | 稳定 |
| `pages/profile` | 设置：临期阈值（3/7/14 天，默认 7）、外观、统计、批量导入入口、数据说明、清空数据 | 稳定 |
| `utils/record.js` | 状态唯一计算源、排序、分类定义与参考天数、示例数据 | 稳定 |
| `utils/storage.js` | 版本化缓存键（`openkeep_*_v1`）、字段规范化与旧数据迁移、清空 | 稳定 |
| `utils/date.js` | 本地 00:00、parseDate、addDays/addMonths/addYears、diffDays | 稳定 |
| `utils/calendar.js` | 日历能力检测、授权流程（含 `fresh` 首次授权标记）、事件构造、友好错误翻译 | 稳定 |
| `utils/image.js` | 照片复制到 `USER_DATA_PATH`、删除、有效性检查 | 稳定 |
| `utils/history.js` | 历史数据三级获取策略（`API_CONFIG.enabled = false`，在线功能默认关闭）；已加防御兜底（getTodayEvents 恒 settle、getLocalPreview 绝不抛异常、loadLocalEvents 畸形数据安全过滤） | 稳定 |
| `components/` | status-badge、item-card、empty-state、filter-bar | 稳定 |
| `custom-tab-bar/` | 悬浮胶囊导航，4 个入口：看板 0 / 物品 1 / 今天 2 / 我的 3 | 稳定 |
| `miniprogram/data/history/01.js~12.js` | 366 天 × 5~10 条历史事件数据（约 295KB，必须为 `.js` 模块） | 稳定 |
| `tools/` | `convert.js` 数据转换脚本 + 源数据 `history_in_today.json`（约 6MB，仅离线用） | 辅助工具 |

## 重要依赖 / Important Dependencies

- 无任何 npm / 第三方依赖（`packNpmManually: false`）。
- 微信平台能力依赖：`wx.addPhoneCalendar`（基础库 2.15.0+）、`wx.onThemeChange`、`wx.chooseMedia`、`wx.getFileSystemManager`。


---

# 3. 项目开发规则 / Development Rules

- **禁止联网**：不得引入云开发、`wx.request`、后端、登录、地图、支付等；所有数据仅存本地。
- **不得修改缓存 key 前缀**：`storage.js` 中 `openkeep_*` 键名是历史遗留但必须保留，改名不影响存储；改动会导致用户数据丢失。
- **状态 / 日期 / 日历逻辑必须走对应 utils**，不要在页面内复制粘贴计算逻辑。
- **新增数据字段必须在 `storage.js` 的 `normalizeRecord` 中做规范化与默认值兜底**，保证旧缓存不白屏。
- **危险操作（删除记录、清空数据、重新导入日历）必须二次确认**；删除记录时同步删除本地照片文件。
- **全部 7 个页面**使用 `disableScroll: true` + 内部 `scroll-view`（`.page-scroll`），不要恢复页面级原生滚动。
- 日历权限仅在用户主动点击导入后申请；禁止后台 / 页面加载时静默申请。
- 中文界面，文案克制温和；尺寸一律 `rpx`；点击区域分层：主操作按钮 / 底部操作区 ≥88rpx，次级控件（分段选择 `.seg-item`、单位选择 `.unit-item`、底部取消 `.bb-cancel`）76–80rpx，筛选胶囊（`.chip` / `.fb-chip` / `.fp-cell`）与 `.clear-link` 64–68rpx（实测最小值，勿宣称「全部 ≥88rpx」）。
- **验收以用户真机反馈为准**：测试清单通过≠最终验收；已标记「验收通过」的功能若后续用户反馈问题，仍按正常缺陷流程排查修复，不因「已验收」而忽略。


---

# 4. 当前项目状态 / Current Status

## 整体状态 / Overall Status

功能完整、可编译运行。V1.0 收尾与 M1 第一批次（购买/保修）已安卓真机验收通过；本轮交付备忘模式、保修日历导入、保修窗口开关、看板搜索等 M1 扩展，待用户真机验证。用户自行真机验证（Agent 不代跑）。

## 已完成 / Completed

- 全部 7 页面 + 4 组件 + 自定义悬浮胶囊 tabBar + 深色模式
- 物品录入体系：保质期（天/月/年）为主、开封后可保存天数为可选修正、存放位置、已开封 X 天快捷反推
- 三色状态看板、搜索/筛选/排序（物品页为固定网格，一屏可见）
- 单条 + 批量手机日历导入（含安卓手势链兼容方案）
- 历史上的今天（本地 366 天数据，来自开源项目 PrintNow/TodayInHistory，经敏感词过滤）
- 首次启动引导（体验示例数据 / 从空白开始）
- 主题切换首帧闪烁修复（门控 + 开门前置 + contentReady 原子守卫 + 白屏加固，见决策 6）；2026-09-07 用户真机复测**仍有闪烁**，用户判定非主要、**缓办**（见已知问题）
- 物品页补下拉刷新（`refresher`，与首页 / 今天页同一套属性），设计依据见决策 5.1；已通过静态评审 + Node 状态机实测 + 安卓真机验证（2026-09-05）
- README、隐私政策（`privacy-policy.txt`）、小程序图标；项目已在 Git 管理（main 分支，远端 `Zoxyu/OpenKeep`），`AGENTS.md`（a284035）与 `AI_CONTEXT.md`（c1b38a1）**均已纳入版本控制**

## 进行中 / In Progress

- M1 / V1.5 进行中：备忘模式、保修日历导入、保修窗口开关、看板搜索、已过期不默认勾选等扩展已交付（2026-09-06），待用户真机验证。主题首帧修复（决策 6）仍待用户真机验证。

## 阻塞问题 / Blocked

- 无 / None

## 已知问题 / Known Issues

- **主题「残留系统色一闪」＝微信平台硬限制，非本项目缺陷、非「没找到路径」**：详见决策 6「已知平台限制」小节（含三方证据、已证伪的 7 条路径、及「三选二」权衡）。跟随系统场景完全无闪；手动锁定主题≠系统时残留一瞬系统色纯底已压到平台下限。
- **主题首帧闪烁仍存在（缓办）**：2026-09-07 用户按清单第 1–4 项复测确认首帧闪烁仍存在（具体复现场景待用户补充）；用户判定非主要、决定缓办，后续重启时按正常缺陷流程处理；修复前先读决策 6（含已证伪路径与平台硬限制边界），勿重走老路。
- 部分安卓机型首次批量导入后，第一条记录可能被误标「已导入」但系统日历中实际没有（历史数据问题，需用户关闭「跳过已导入记录」重新导入该条补写）。
- 个别安卓厂商 ROM 每次日历写入都弹系统确认页，需逐条手动保存，属平台行为无法绕过（已在批量导入页文案中提示）。
- `tools/history_in_today.json`（约 6MB 源数据）已随仓库提交，体积偏大但不影响小程序包体积（不在 `miniprogramRoot` 内）。


---

# 5. 当前任务 / Active Tasks

**本轮任务（M1 扩展 + 后续 4 点反馈修复、iOS 遮挡避让、物品页 fab）已全部交付并经用户验证通过（2026-09-07）。** 主题首帧修复（决策 6）2026-09-07 用户真机复测**仍有闪烁**，用户判定非主要、**缓办**（见已知问题与第 9 节第 1 条）。

真机验证清单（存档；Node / 模拟器无法验证渲染时序与手势，必须以真机为准。**第 5–19 项均已用户验证通过**（第 5–8 项安卓真机 2026-09-05，第 9–19 项 2026-09-07）；第 1–4 项主题首帧 2026-09-07 用户复测仍有问题、缓办）：

1. 跟随系统浅↔深切换后，首次进入各页应**完全无闪**。
2. 手动锁定主题≠系统时，旧主题内容不再闪；残留的系统色纯底已压到最短，确认观感是否可接受。
3. 回归：profile 无白屏；列表 / 表单 / 详情不再闪「暂无数据 / 共 0 件」；item-form 编辑模式不闪「新建默认值」帧；tab 二次进入不再被门控。
4. history 健壮性 + tabBar 死代码清理：history 下拉刷新可用且指示器能收起、iOS 页面拖拽已锁死、history/dashboard 数据正常无白屏无骨架卡死、tab 切换滑块瞬时到位无异常滑动、tabBar 主题深浅正常、标题栏永久深色不回退。**（2026-09-07 用户复测：第 1–4 项首帧闪烁仍存在，用户判定非主要、缓办，见已知问题）**
5. **物品页下拉刷新**（Node 只能验状态机与 setData 批次，手势与指示器视觉必须真机）：① 从搜索框 + 筛选面板一带下拉能触发、指示器能正常收回、toast「已刷新本地状态」出现；② **先设筛选条件（如只看「临期」）再下拉，筛选条件应保持不变**（`load()` 会带着当前 keyword/category/status/sort 走 `buildView()`）；③ 异常时指示器不卡死（`refreshing:false` 已并入 `load()` 的成功与 catch 两条路径，已 Node 实测）。
6. **首页下拉刷新（本轮批次对齐回归）**：`dashboard.js` 的 `onScrollRefresh` 已由 3 批 `setData` 改为 2 批（`refreshing:false` 并入 `refresh()` 成功批，catch 批原已有，与物品页同模式），需回归验证：首页下拉能触发、指示器正常收回、toast「已刷新本地状态」出现、内容照常刷新；异常路径（`refresh()` catch）仍能收起指示器。
7. **下拉刷新文案（本轮，安卓重点）**：三页改自定义 refresher（`refresher-default-style="none"` + `slot="refresher"`），下拉时依次显示「下拉刷新 → 松开立即刷新（拉够 45px）→ 正在刷新…」+ 转圈点；「今天」页下拉完成后应有 toast「内容已刷新」（此前无提示，本轮补）；深浅色下文案与转圈点均可见。
8. **输入框键盘避让（安卓重点，见决策 7）**：item-form 7 个输入框（含多行备注）+ items 搜索框聚焦弹键盘时，页面**不再整体漂移**、输入文字**始终可见**（聚焦字段自动滚到键盘上方）；**尤其购买价格等数字键盘（type=digit/number）输入完收起后，页面须恢复满高、底部不再留白遮挡**（2026-09-05 修复）；框间切换无明显抖动；反复聚焦同一字段仍能正常滚动。
9. **备忘模式（本轮）**：只填存放位置保存→状态「备忘」莫兰迪蓝；看板统计/筛选含备忘维度；纯备忘不进批量导入候选。
10. **录入 3 选 1（本轮）**：保质期/保修/位置都不填→报错提示；填任一可保存。
11. **保修进批量导入（本轮）**：有保修日(未过保)记录出现在候选(显示「保修至」)；开关开启后>30天保修也进；已过期物品默认不勾选。
12. **看板搜索+留白（本轮）**：fab 旁搜索按钮展开→关键词过滤列表；底部留白使 fab 不挡最后卡片。
13. **筛选分行（2026-09-07）**：看板筛选标签分行显示（全部/已过期/临期/安全/保修/备忘），无需左右滑动；统计卡 wrap 容纳保修/备忘。
14. **录入文本（2026-09-07）**：保质期无红色*、存放位置/保修标注三选一，无误导「可选/必填」。
15. **warranty 状态（2026-09-07）**：只填保修→徽章「保修」+「保修还剩N天」，不归备忘；只填位置→「备忘」。
16. **纯备忘日历栏（2026-09-07）**：纯备忘详情页不显示「到期提醒·手机日历」栏；warranty 记录日历栏显示且导入用保修日。
17. **统计卡同行（2026-09-07，用户验证通过）**：看板已过期/临期/安心保存三卡同一行（`.stat` 加 `box-sizing: border-box`）；仅当出现保修/备忘卡（4–5 个）时自动换两行。
18. **物品页空态 CTA 避让（2026-09-07，用户 iOS 模拟验证通过）**：空态「＋ 添加物品」完整显示在胶囊栏上方；零记录时筛选面板隐藏（无物可筛属无效 UI）。
19. **物品页 fab（2026-09-07，用户验证通过）**：有记录时右下角「＋ 添加物品」fab、点击进表单；滚到底最后一卡不被遮；空态不与流内 CTA 重复。

可选后续（非本轮范围，需用户确认）：见第 9 节第 4、5 条。


---

# 6. 重要技术决策 / Important Decisions

## 决策 1：纯本地数据，零网络

**日期 / Date:** 2026-08（项目初始）

**决定 / Decision:** 不使用云开发 / 后端 / 登录，所有数据仅存 `wx.setStorage` 与本地文件系统。

**原因 / Reason:** 产品定位为离线可用的家庭工具，隐私优先。

**影响 / Impact:** 所有功能设计必须考虑离线可用；「历史上的今天」在线接口做成可选关闭的增强项。

## 决策 2：红黄绿状态实时计算，永不落库

**日期 / Date:** 2026-08

**决定 / Decision:** 状态每次打开页面时由 `utils/record.js` 基于当前本地日期实时计算；`warningDays` 阈值（3/7/14）修改后全局立即重算。

**原因 / Reason:** 避免缓存中状态过期导致颜色、统计、筛选不一致。

**影响 / Impact:** 页面不允许缓存状态字段；`withStatus` 是唯一入口。

## 决策 3：项目更名为「到期那天 In Time」，但保留 `openkeep_*` 缓存键

**日期 / Date:** 2026-08

**决定 / Decision:** 品牌从「开封守护 OpenKeep」更名为「到期那天 In Time」（界面文案、导航标题、`project.config.json` projectname 均已更新），但本地缓存 key 前缀保持 `openkeep_` 不变。

**原因 / Reason:** 修改缓存键会使已安装用户的数据全部丢失。

**影响 / Impact:** 代码中 `openkeep_` 前缀与新品牌名并存属正常现象，不是待办。

## 决策 4：安卓批量导入日历采用「逐条弹窗确认续写」

**日期 / Date:** 2026-08-21

**决定 / Decision:** 安卓端批量导入每条写入成功后弹确认框（「已写入 x/n，继续写入」），由用户点击发起下一条；首次授权后再弹「已获得日历权限，点击开始写入」。iOS / 开发者工具保持 800ms 间隔自动串行。

**原因 / Reason:** 微信要求 `wx.addPhoneCalendar` 在用户点击手势链内发起；安卓端第一条写入调起系统日历后手势链即失效，自动续写必报 `fail can only be invoked by user TAP gesture`（曾误译成「设备不支持」）；首次授权瞬间权限未同步，第一条写入会被吞掉。

**影响 / Impact:** 安卓批量导入交互为逐条确认，属平台限制；勿改回自动串行。

## 决策 5：全页面 `disableScroll` + `scroll-view` 滚动锁死

**日期 / Date:** 2026-08-21（滚动锁死）；2026-09-04（物品页补下拉刷新）

**决定 / Decision:** 页面配置 `"disableScroll": true`，主体内容放入 `scroll-view.page-scroll`（`100vh`）；下拉刷新改用 `scroll-view` 的 `refresher`（页面级下拉已被 `disableScroll` 锁死）。**全部 7 个页面均已落地滚动锁死；`refresher` 落地于首页、「今天」、物品三页。**

**原因 / Reason:** iOS WebView 页面整体可上下左右拖拽、内容偏移、双向滚动条，真机实锤；锁死后横向位移彻底消失。

**影响 / Impact:** 新增页面必须沿用此模式；fixed 元素（悬浮按钮、弹层、底部操作栏）需放在 `scroll-view` 之外。

### 5.1 下拉刷新的覆盖范围（权威表述，勿再当作缺陷反复排查）

- **首页 / 今天 / 物品三页有，「我的」页刻意没有**：它是设置页，在设置页下拉刷新统计不符合用户心智。这是有意为之，不是遗漏。
- **真实价值不是「拉新数据」**：三页数据全部本地同步可得，日常路径（增删改后返回、切 Tab、改临期阈值）`onShow` 已全覆盖重算，下拉刷新在内容上通常是 no-op。它真正解决的是**小程序长时间停在前台跨过零点**：红黄绿状态依赖「今天」（决策 2），而这种场景不会触发 `onShow`，状态会停在昨天，用户需手动重算自救。「今天」页另有一层语义：`load(true)` 强制跳过当天缓存。
- **历史沿革**：`enablePullDownRefresh` 自初始提交 `fbde576` 起只存在于首页，「今天」页在 `f525ef9` 引入时也带；物品页与「我的」页从未有过。`1b19fdd` 做 `disableScroll` 改造时只是把「原本就有」的两页迁移到 `refresher`，物品页直到 2026-09-04 才首次补上。
- **实现约束**：`refreshing:false` 必须并入 `load()` 那次合并 `setData`（成功与 catch 两条路径都要），与 `contentReady` / 列表数据同批原子翻转，否则异常时指示器会卡住不收。`refresherText`（下拉文案）同样并入这些批次复位为「下拉刷新」。
- **下拉反馈样式（2026-09-04 起为自定义文案）**：三页 `refresher-default-style="none"` + `slot="refresher"`（样式在 `app.wxss .rf`，节点须有固定高度否则微信不渲染），文案由 `onRefresherPulling`（下拉中，`e.detail.dy>=45` 切「松开立即刷新」）/ `onScrollRefresh`（「正在刷新…」）/ `onRefresherRestore`·`onRefresherAbort`（复位）驱动；`refresher-background="transparent"` 跟随主题背景。
- **遗留死配置（已清理，2026-09-04）**：`dashboard.json` / `history.json` 里曾有的 `backgroundTextStyle: "dark"` 只服务于页面级下拉的 loading 三点颜色，`disableScroll` 后已无作用，已删除；`app.json` 全局 `window.backgroundTextStyle: "@bgText"` 属另一回事，保留不动。

## 决策 6：主题首帧用 `themeReady` 门控 + `contentReady` 原子守卫

**日期 / Date:** 2026-09-04（提交 `841744e` 门控落地 + `5caae4d` 开门前置 / contentReady 收口）

### 6.1 主题架构（单一事实来源，最终设计）

- **唯一来源链**：`settings.theme`（system/light/dark）→ `app.js resolveTheme()` → `globalData.effectiveTheme`（真正生效的 light/dark）→ 一律经 `app.isDark()` 读取。`app.wxss` 的 `@media (prefers-color-scheme: dark)`（page 元素）与 `app.json` + `theme.json` 的 `@navBg` / `@bg` 只是「JS 尚未执行时的首帧兜底」、且只能跟随系统；一旦 JS 生效一律以 `effectiveTheme` 为准。**不得引入第五个主题判断来源。**
- **DOM 深浅色走两条互不混淆的通道**：
  - 通道 A（首次初始化）：页面 `onLoad` / 组件 `attached` 内同步读 `app.isDark()`。首帧正确性只由通道 A 承担。
  - 通道 B（运行时变化）：`app.onTheme` **只服务已存在实例**，注册时**不立即回调**，回调内**先比对再** `setData({dark})`（同值不渲染）。不承担首次初始化。
- **原生 chrome（标题栏 / 窗口背景）**：`applyChrome()` **无条件**按 `effectiveTheme` 写 `setNavigationBarColor` / `setBackgroundColor`（这两个是「每页一份」的运行时覆盖，一旦某页被显式设置过 theme.json 声明值对该页即失效，故必须无条件写，否则手动锁定过的页会永久停在旧色）；调用频率由挂在**页面实例**上的 `_chromeDark` 守卫控制（`syncPageChrome(page)`，守卫挂页面而非 app，否则新页会被误判为已应用而漏设）。自定义 tabBar **不用** `wx.setTabBarStyle`（对 `custom: true` 无效且触发底部重绘闪烁，已移除），由组件自身 `dark` 类驱动。

### 6.2 门控设计（决定）

- **`themeReady` 门控**：7 个页面（dashboard / items / history / profile / item-form / item-detail / calendar-import）的 `.page-root` 加 `wx:if="{{themeReady}}"`；**开门 setData 是 `onLoad` 第一条 setData、无条件执行**，内容为 `{ dark, themeReady:true, + 廉价纯计算静态字段 }`。`themeReady` 之前只允许**已核实的纯非抛异常计算**；有风险的存储读取（如 item-form 编辑模式的 `storage.getRecord`）一律**后移到开门之后**。
- **`contentReady` 原子守卫**：`contentReady` 必须与它所守卫的列表内容在**同一次 setData** 里原子翻转——4 个列表页（dashboard / items / history / calendar-import）即 `onShow` 的 `refresh()` / `load()` / `buildList()`（history 在 `load()` 的 `.then`，且有 `.catch` 兜底）。**严禁在 `onLoad` 提前置真而数据由 `onShow` 填**：二者非原子会留下「contentReady 已 true、列表仍为默认空值」的窗口，使空状态守卫 `contentReady && !hasAny` 误判为真、闪「暂无数据 / 共 0 件」。空状态 / 三色统计 / 共 N 件 / 筛选栏 / 列表容器均由 `contentReady` 守卫。这三个内容函数（`dashboard.refresh` / `items.load` / `calendar-import.buildList`）已加 `try/catch` 兜底（抛异常也置 `contentReady:true` 及该页收口字段，避免内容区整块缺失、可自愈）。**item-form / item-detail / profile 无 `contentReady`**（其门开帧已完整 / 干净，无需守卫）。
- **profile 不加守卫、dashboard 必须加守卫的判定依据**（勿按「一致性」互相拉齐）：dashboard 门开帧若不守卫会呈现**断言性空状态**（引导卡「从第一件物品开始」/ `empty-state`「暂无物品」），等于向用户断言一个可能为假的事实，属内容错误；profile 无 `empty-state` 组件、只有纯数字统计行，0 等同空账户的合法展示、不构成断言；且两者 `onLoad` / `onShow` 同 tick、统计很快被 `refreshStats()` 纠正，profile 又是常驻 tab 实例（门控仅首次进入生效）。
- **已登记的守卫例外（此例外至今未改代码，属可选加固、尚未实施）**：calendar-import 底部操作条的「已选 N 条 / 导入 N 条到手机日历」只受 `wx:if="{{!importing}}"` 控制、**未加 `contentReady` 守卫**，门开帧会短暂显示「0 条」+ 禁用态，再由 `onShow` 的 `buildList()` 纠正——不含断言性空状态，属可接受例外；若要加守卫属代码改动，需另行确认。
- **item-form 编辑模式**：开门 setData 按 `editIntent = !!(options && options.id)` 分支写 `isEdit` / `openedAt` / `refHint`（编辑模式 `openedAt`/`refHint` 留空、`isEdit=true`），避免门开帧先呈现「今日日期 + 冰箱提示 + 『保存物品』 + 无删除按钮」的错误新建态（`isEdit` 驱动保存按钮文案与删除按钮显隐）；编辑真实值由开门之后的第二段 setData（`storage.getRecord` + 含 `origin`）填入，保存分支用 `isEdit && origin` 判定，逻辑不变。item-detail 的 `id` 用防御式 `(options && options.id) || ''`。
- **`onShow` 职责**：仅 `syncPageChrome` + 业务刷新（+ 内容 setData 里并入的 `contentReady`）；**绝不写 `dark` / `themeReady`**（把 contentReady 并入 onShow 既有那次内容 setData 是允许的，不新增渲染次数）。

### 6.3 原因

`Page({ data:{...} })` 的 data 字面量只在模块求值时（无分包 ≈ 启动时）构造一次，新建实例的 `dark` 初值是「启动那一刻」的旧快照；`setData` 又是跨线程异步消息，无法保证并入首帧渲染。因此改主题后首次进入未访问页面，会先渲染旧主题一帧再纠正。门控是唯一能保证「错误主题内容绝不进入视觉」的手段；`contentReady` 与内容原子翻转则避免门开后闪空状态。

### 6.4 已知平台限制（残留「系统色一闪」＝微信硬限制，非本项目缺陷、非「没找到路径」）

- **现象与机理**：当用户手动锁定主题≠系统主题时，导航到**新建页面实例**，其首帧在 JS(`setData`) 生效前只能由「跟随系统」的表面着色决定（CSS page 背景的 `@media`、`theme.json` 的 `@bg`、data 快照、`initialRenderingCache` 全是快照 / 跟随系统），而运行时改色 API（`setBackgroundColor` / `setNavigationBarColor` / `page-meta`）都是「每页一份且首帧之后才落地」。
- **三方证据**：微信官方社区同场景 bug（编号 `0008428094` / `0002ee2684`）自 2019 至 2025-12 未修；uni-app 官方文档承认「前端设背景色生效晚于首帧、是硬伤」；框架快照式首帧架构决定。
- **结论**：**跟随系统场景＝完全无闪**；手动锁定≠系统时残留一瞬系统色纯底（远轻于旧主题内容闪现），当前设计已把它压到平台下限。
- **影响范围（tab 页 vs navigateTo 页，据 `app.json` tabBar.list）**：tab 页（dashboard / items / history / profile）实例常驻，门控仅**首次进入**生效；item-form / item-detail / calendar-import 每次 `navigateTo` 都新建实例、门控**每次**生效。故「系统色一闪」只可能出现在这三个 navigateTo 页 + tab 页的首次进入。
- **要真正零闪只能「三选二」**：① 保留手动锁定 + 保留原生导航 → 必有那一瞬系统色（**当前状态，用户已选此**）；② 放弃手动锁定（仅跟随系统）；③ 放弃原生导航（SPA）。
- **已证伪、后续 agent 勿再尝试的路径**：
  1. 迁移 Skyline（暗色仍跟随系统、且不支持 `initialRenderingCache`、迁移成本高）；
  2. `wx.onAppRoute` / `onBeforePageLoad` 设首帧背景（时机晚于或够不到新页首帧）；
  3. `page-meta` 的 `root-background-color` / `background-color`（data 驱动、首帧取旧快照）；
  4. 透明化 page + 依赖窗口背景（新页窗口背景初始来自 theme.json 系统色，不继承上一页 `setBackgroundColor`）；
  5. 模块级 data 快照 / `withTheme` 影响未来实例（已两次真机证伪、`withTheme` 已删）。同机制残留（`app.tabBarSnapshot` / `app.prepareTabSwitch`、`custom-tab-bar/index.js` 的 `SHARED_DATA.selected` 预置、`dashboard.js` 的 `app.prepareTabSwitch(2)`）**已于本轮清理移除**；tabBar 选中态的真实机制＝`setActive` 瞬时纠正 + `index.wxss` 刻意不设 `transition`（滑块瞬移而非滑动）；
  6. 全量 SPA（能让导航零新建首帧，但安卓物理返回键会直接退出小程序、丢原生转场，代价远大于收益）；
  7. tab 预热（微信无页面实例预创建 API）。

### 6.5 不变量（维护须知）

- `themeReady` / `contentReady` 必须**无条件写入、永不被前置计算或提前 return 阻断**；不用 `setTimeout` / 动画补救主题。
- **profile 须无条件写 `themeReady`**：其 `onLoad` 若用 `dark` 比对守卫，「启动后未改主题」时条件为假 → 不 setData → `themeReady` 永远 false → 白屏。
- 开门 setData 之前或其字面量内**不得加入会抛异常的存储读取**，否则 `onLoad` 中断 → 永久白屏。dashboard 的 `historyUtil.getLocalPreview()` 是唯一非纯内存计算的开门前置字段，其内部已加顶层 try/catch 保证绝不抛异常（数据损坏时降级返回 `{month, day, first:'', second:''}`），白屏隐患已消除。
- **tabBar 与 4 个组件不做门控**：tabBar 渲染在 `.page-root` 之外，加 `wx:if` 会让切页时底部导航消失再现（tabBar 已有 `attached` 通道 A）；4 个组件（item-card / empty-state / filter-bar / status-badge）渲染在页面 `.page-root` 内部，随页面门控自动覆盖。
- 门控放行前那一瞬视口仅显示 `page` 元素背景色（跟随系统），属既定权衡、非缺陷。
- 首帧 / 渲染时序无法用 Node 或模拟器验证，最终以真机为准。

## 决策 7：输入框键盘避让用 `adjust-position=false` + 动态收缩 scroll-view + `scroll-into-view`

**日期 / Date:** 2026-09-04 实施（安卓真机反馈「输入框漂移、看不到输入内容」）；2026-09-05 修复「数字键盘收起后 scroll-view 卡在收缩高度、底部留白遮挡内容」，同日安卓真机验证通过并分批提交入库。

**决定 / Decision:** item-form 的 7 个输入控件（6 `input` + 1 `textarea`）与 items 搜索框全部设 `adjust-position="{{false}}"`，关闭微信「键盘弹起整页上推」；item-form 由 `wx.onKeyboardHeightChange` 监听键盘高度 `kbHeight`，把 `scroll-view` 高度设为 `calc(100vh - {{kbHeight}}px)` 动态收缩可视区，`bindfocus` 时读 `e.detail.height` 立即收缩、并用 `scroll-into-view` 把聚焦字段（每个 `.field` 有 `id="f-*"`、input 带 `data-target`）滚到顶部；`bindblur` **延迟 120ms 兜底把 `kbHeight` 归零** + 清空 `scrollIntoId`（延迟期内若 focus 了新框则取消归零，避免框间切换先弹回满高再收缩的抖动）。items 搜索框在顶部、键盘弹起本就可见，仅关 `adjust-position`，不收缩高度（避免与其 `refresher` 冲突）。

**原因 / Reason:** 页面 `disableScroll` + `scroll-view(100vh)`（决策 5）下，微信 `adjust-position` 默认的整页上推作用于 page/webview 层、与固定高度 scroll-view 是两套机制，安卓真机表现为整页漂移 + input 内文字/placeholder 相对边框错位（看不到已输入内容）。这是 scroll-view 内原生输入组件的已知平台问题。`always-embed`（iOS 同层渲染）只对 iOS 生效，用户当前只有安卓真机，故走「关上推 + 自行避让」的通用方案。

**影响 / Impact（不变量）:**
- **不得把 item-form / items 输入框的 `adjust-position` 改回 `true`**，否则漂移复现；新增输入框须同样加 `adjust-position="{{false}}"` + `id`/`data-target` + `bindfocus`/`bindblur`。
- 键盘监听在 `onLoad` 注册、`onUnload` 用 `wx.offKeyboardHeightChange` 注销（item-form 每次 `navigateTo` 新建实例，必须注销防泄漏 / 重复回调）。
- `scroll-view` 高度改内联 `style` 覆盖 `.page-scroll` 的 `height:100vh`；键盘收起 `kbHeight=0` 时等价 `100vh`，无残留。
- **`kbHeight` 归零必须由 `onFieldBlur` 兜底，不能只依赖 `wx.onKeyboardHeightChange`**：安卓数字键盘（`type="digit"`/`"number"`）收起时该事件常不回调 `height=0`，只靠它会让 `scroll-view` 卡在收缩高度、底部留白遮挡内容（2026-09-05 安卓真机复现并修复）；`onFieldFocus` 亦用 `e.detail.height` 主动收缩。对应 `onUnload` 须一并 `clearTimeout(this._blurTimer)`。
- **安卓首次聚焦可能仍有一次极轻微原生视口上推**（webview adjustPan 层行为，社区反馈 `adjust-position=false` 亦难完全阻止首次那一下，失焦复位后同页后续聚焦不再上推）；若真机验证发现残留，属平台限制、非本方案缺陷。

## 决策 8：备忘模式（3 选 1 录入）+ 保修提醒窗口开关 + 保修进日历导入

**日期 / Date:** 2026-09-06（用户真机反馈后实施）；2026-09-07 用户真机验证通过，其中「只填保修不应归备忘」反馈在当日 4 点反馈轮修订为独立 warranty 状态（见第 8 节变更记录）

**决定 / Decision:**
- **录入 3 选 1**：保质期（或开封后可保存天数）/ 保修结束日 / 存放位置 至少填一项即可保存（保质期不再强制必填，label 不带必填星号；存放位置/保修标注「三选一」）。
- **无到期日的两种辅助状态**（2026-09-07 拆分；均不参与红黄绿、莫兰迪蓝、排序最后）：只填保修（无保质期）＝`warranty` 状态（徽章「保修」、label「保修还剩N天/已过保N天」，**不归备忘**）；只填存放位置（无保质期无保修）＝`memo` 备忘状态。看板统计/筛选含「保修」「备忘」两个维度；筛选标签与统计卡均 flex-wrap 分行（避免横滑）。
- **进日历导入规则**：纯备忘（无任何日期）不进批量导入候选、详情页隐藏日历栏；warranty 记录用保修日导入（`buildEvent` kind='warranty'，详情页单条导入同）；有保质期的记录按到期日导入（正常红黄绿）。
- **保修提醒窗口开关**：`settings.warrantyBeyond30`（默认 false＝保修只看 30 天内）。开关 UI 在「批量导入日历」页；同时影响看板「近期保修」卡与批量导入保修候选的窗口（开启后 >30 天保修也纳入）。
- **批量导入已过期物品默认不勾选**（仍出现在候选，需手动勾选才导入）；未来到期与保修候选默认勾选。

**原因 / Reason:** 用户希望低压力录入（备忘录场景）、保修到期可被日历提醒、且保修提醒范围可配置；已过期物品默认勾选易误导（用户反馈）。

**影响 / Impact（不变量）:**
- `memo` 状态贯穿：record.computeStatus / 看板统计+筛选 / items 筛选 / status-badge / app.wxss 莫兰迪蓝变量；新增状态展示处须容纳 memo。
- 保修窗口开关存 `settings.warrantyBeyond30`（storage normalize 兜底 false）；看板与批量导入都读它，勿各自硬编码 30。
- 批量导入候选元素为 `{ record, kind }`，kind='due'|'warranty' 决定 buildEvent 日期来源；runStep 传 item.kind。


---

# 7. 重要约束 / Important Constraints

- 基础库最低兼容 2.15.0；使用较高版本 API 前必须 `wx.canIUse` 检测。
- 微信 `require()` 不支持加载 `.json` 文件（基础库 3.x 报 `module not defined`），数据文件必须输出为 `.js` 模块（`module.exports = {...}`）。
- 日历 API 只写不读、不返回事件 ID，无法删除/更新已写入日程；时间戳与 `alarmOffset` 均为**秒**；事件固定到期日上午 09:00；需显式传 `endTime`（+3600s）否则部分安卓异常；已过期物品的事件时间钳制到最近未来的 09:00。
- `wx.setStorage` 总量约 10MB、单 key 约 1MB；照片走文件系统不占该额度。
- 卸载微信 / 清缓存 / 换设备会丢数据，已在「本地数据说明」中向用户明示。
- 模拟器与真机行为差异大（相机、日历、首帧渲染时序），验证以真机为准；用户自行真机验证，Agent 无需代跑。
- 日历写入需隐私协议中声明「使用你的日历（仅写入）权限」。


---

# 8. 最近的重要变化 / Recent Significant Changes

- 2026-09-07 — **物品页添加入口补齐：悬浮 fab（提交 `728a1e4`，docs `73bdbc1`）**：物品页此前仅空态有流内 CTA、有记录后无添加入口；补 `wx:if="{{hasAny}}"` fab（与空态 CTA 互斥不重复，复用 `goAdd`），避让基准与看板 fab 同（`bottom: calc(180rpx + env(safe-area-inset-bottom))`）；`.list` 底部预留 220→380rpx 防 fab 遮末卡。改动文件：items.wxml、items.wxss。状态＝待用户验证。
- 2026-09-07 — **物品页空态 CTA 遮挡修复（iOS 模拟复现，提交 `d7739a6`，docs `11b480c`）**：根因——空态 CTA 在 scroll-view 流内无底部避让，iOS 模拟矮视口 + 34px safe-area 使胶囊 tabBar 整体抬高恰好遮住（安卓高视口未复现）。修复——零记录隐藏筛选面板使 CTA 上移约 440rpx + `.empty-action` 底部预留 `calc(160rpx + env(safe-area-inset-bottom))`；**不改 tabBar 本身**（其 safe-area 偏移是各 fab 避让基准）。改动文件：items.wxml、items.wxss。状态＝**用户 iOS 模拟验证通过**（空态截图 CTA 完整可见于胶囊栏上方）。
- 2026-09-07 — **看板统计卡同行修复（提交 `1750abe`）**：`.stat` 默认 content-box 致 1rpx 边框未计入 flex-basis、三卡超宽约 4rpx 触发 wrap 成 2+1；加 `box-sizing: border-box` 后三色卡精确同行、4–5 卡才换行。改动文件：dashboard.wxss。状态＝待用户验证。
- 2026-09-07 — **真机反馈 4 点修复（提交 `033540d`/`c0b52a6`/`bcba469`，docs `dffa9fd`）**：① 看板筛选标签改分行（filter-bar 去横滑改 flex-wrap 三列）+ 统计卡 wrap 容纳保修/备忘；② item-form 文本优化（保质期去必填星号、存放位置/保修标注三选一）；③ 拆出 warranty 状态（只填保修≠备忘，正常显示保修剩余，贯穿统计/筛选/排序/徽章/卡片）；④ 纯备忘详情页隐藏日历栏、warranty 单条导入用保修日。改动文件：record.js、app.wxss、status-badge/item-card/filter-bar 组件、dashboard/items/item-form/item-detail。状态＝`node --check` 通过；2026-09-07 用户复测确认筛选分行、保修/备忘状态、详情日历栏均正常，遗留问题收敛于上述遮挡与 fab 两轮。
- 2026-09-06 — **M1 扩展交付：备忘模式+保修日历导入+看板搜索（提交 `e65f1a5`/`ceeeb28`/`674c0b9`，回归修正 `0ccd8ac`，docs `b73be9e`）**：① 录入 3 选 1（保质期/保修/位置），只填位置＝备忘模式（新状态 memo 莫兰迪蓝，看板统计/筛选容纳）；② 批量导入候选新增保修到期（buildEvent kind='warranty' 用保修日），纯备忘不进候选；③ 「批量导入」页加 warrantyBeyond30 开关（>30 天保修也纳入，同控看板保修卡窗口）；④ 已过期物品默认不勾选；⑤ 看板加关键词搜索（fab 旁圆形入口）+ 底部留白防 fab 遮挡。改动文件：record/storage/calendar.js、item-form、dashboard、items、calendar-import、app.wxss、status-badge.wxss。状态＝`node --check` 通过；用户真机验证通过（2026-09-07），4 条体验反馈已在当日 4 点修复轮处理。
- 2026-09-05 — **修复键盘避让：数字键盘收起后 scroll-view 卡收缩高度、底部留白遮挡内容（安卓真机，提交 `a46a49c`）**：根因——`kbHeight` 只靠 `wx.onKeyboardHeightChange` 回调 `height=0` 复位，而安卓数字键盘（`type=digit/number`）收起常不回调。修复：`onFieldBlur` 延迟 120ms 兜底归零（延迟兼容框间切换、focus 取消归零防抖动）+ `onFieldFocus` 用 `e.detail.height` 立即收缩 + `onUnload` 清理定时器。详见决策 7。改动文件：item-form.js。状态＝`node --check` 通过 + **安卓真机验证通过（2026-09-05）**，已随本轮提交。
- 2026-09-04 — **真机反馈修复：下拉刷新文案 + 输入框键盘避让（提交 `3e96a70`/`a46a49c`）**：① 三页下拉刷新改自定义 refresher 文案（`refresher-default-style="none"` + `slot="refresher"`：下拉刷新→松开立即刷新→正在刷新…+转圈），「今天」页补下拉完成 toast「内容已刷新」（此前无提示）；② item-form 7 输入框 + items 搜索框键盘避让（`adjust-position=false` + `wx.onKeyboardHeightChange` 动态收缩 scroll-view + `scroll-into-view` 滚到聚焦字段，见决策 7），根治安卓「输入框漂移、看不到输入内容」。改动文件：app.wxss、dashboard.js/wxml、items.js/wxml、history.js/wxml、item-form.js/wxml。状态＝已通过 `node --check` + 结构 grep + **安卓真机验证通过（2026-09-05）**，已随本轮提交。
- 2026-09-04 — **下拉刷新收尾清理（A①+A②，提交 `3e96a70`）**：① `dashboard.js` 的 `onScrollRefresh` 由 3 批 `setData` 对齐为 2 批——`refreshing:false` 并入 `refresh()` 成功批（catch 批原已有），与物品页 `load()` 同模式，用户无感知、少一趟渲染消息；② 删除 `dashboard.json` / `history.json` 中 `disableScroll` 后失效的 `backgroundTextStyle: "dark"`（`app.json` 全局项保留）。改动文件：dashboard.js、dashboard.json、history.json。状态＝已通过 `node --check` + JSON 合法性校验 + 安卓真机验证，已随本轮提交。
- 2026-09-04 — **物品页补下拉刷新**（提交 `5903e81`；设计依据见决策 5.1）：`items.wxml` 的 `scroll-view` 展开为多行并加 4 个 `refresher` 属性（与首页 / 今天页逐字节一致）；`items.js` 新增 `refreshing` 字段与 `onScrollRefresh()`，并把 `refreshing:false` 并入 `load()` 的合并 `setData`（含 catch 路径）以遵守 `contentReady` 原子翻转不变量；下拉刷新仅 **2 批** `setData`（首页现为 3 批）。`items.json` 无需改动（refresher 是组件属性，非页面配置）。改动文件：items.js、items.wxml。状态＝已提交 + 已通过静态评审与 Node 状态机实测（含异常路径），**待真机验证**。
- 2026-09-04 — **history 健壮性加固 + 死代码清理**：① `history.json` 补 `disableScroll:true` 并移除冗余 `enablePullDownRefresh`（全 7 页对齐）；② `utils/history.js` 根治 never-settle（内层链补 `.catch` 恒 settle）+ `getLocalPreview` 顶层 try/catch 绝不抛异常 + `loadLocalEvents` 畸形数据安全过滤 + 诊断 `console.warn`；③ 移除 tabBar 选中态快照死代码（`app.tabBarSnapshot` / `prepareTabSwitch` / `SHARED_DATA.selected` 预置及误导注释）。改动文件：history.json、utils/history.js、app.js、custom-tab-bar/index.js、dashboard.js、pages/history/history.js（注释）。状态＝已通过评审 + 静态实测，**待真机验证**。
- 2026-09-04 — **主题切换首帧闪烁修复**（设计细节见决策 6，此处不重述）：两次提交 `841744e`（themeReady 门控落地）+ `5caae4d`（开门前置 / contentReady 原子收口），累计改动 **7 页 js + 7 页 wxml + AI_CONTEXT.md**。状态＝2026-09-07 用户真机复测**首帧闪烁仍存在**，用户判定非主要、缓办（见已知问题；与决策 6.4 平台硬限制「残留系统色一闪」区分）。
- 2026-08-27 — 新增并已提交两份 agent 协作文档：`AI_CONTEXT.md`（`c1b38a1`）与 `AGENTS.md`（`a284035`）；其中 AI_CONTEXT.md 后续随主题修复更新（`841744e` / `5caae4d`），AGENTS.md 自 a284035 后未再变更。
- 2026-08-21 前后 — 修复安卓日历导入三连问题（手势链逐条确认、首次授权吞第一条、全选/取消全选破坏列表数据结构）；各页面 `disableScroll` + `scroll-view` 改造锁定 iOS 滚动。
- 2026-08 中旬 — 保质期体系重构（保质期为主、开封天数为可选修正、存放位置、日历文案「你放在XX的XX快要到期啦」）；物品页筛选改固定网格。
- 2026-08 上旬 — 项目更名为「到期那天 In Time」；新增「历史上的今天」功能；自定义悬浮胶囊 tabBar。

完整开发说明见 `README.md`；提交历史见 `git log`（main 分支）。


---

# 9. 下一步建议 / Next Recommended Actions

> 第 1 条主题首帧 2026-09-07 用户真机复测仍有闪烁、用户决定缓办（非主要）；V1.5 第一批次 + M1 扩展已全部用户验证通过（2026-09-07）；第 4–5 条为可选后续，需用户确认后再做。

1. **主题首帧闪烁（缓办，2026-09-07 用户决定）**：用户复测确认闪烁仍存在，判定非主要、缓办；后续重启时按缺陷流程处理，先读决策 6 与已知问题（含已证伪路径与平台硬限制边界），勿重走老路。
2. **本轮改动已分批提交入库（2026-09-05）**：下拉刷新反馈（三页自定义文案 + 今天页 toast + A①A② 清理）、输入框键盘避让（item-form + items 搜索框）、配套文档，均已安卓真机验证通过后提交。
3. A①A②（下拉刷新 2 批对齐 + 删除失效 `backgroundTextStyle`）已随本轮一并入库；提交历史见 `git log`（main 分支）。
4. 可选优化方向（需用户确认后再做）：考虑把 `tools/history_in_today.json`（6MB）移出仓库或加入忽略；为「历史上的今天」补充更多日期事件需重新运行 `node tools/convert.js`。
5. 若未来开放在线接口，需在小程序后台配置合法域名并更新隐私协议；目前 `utils/history.js` 中 `API_CONFIG.enabled = false`。
6. **V1.5 收尾方向（待用户决策）**：第一批次 + M1 扩展已全部用户验证通过（2026-09-07）；按 PROJECT_PLAN Step 11–12 闸门，由用户决定：启动第二批次「维护周期」（8.6 节，做完 V1.5 完整）或 V1.5 按当前范围封口转 M2/V2.0 规划。


---

# 10. 上下文维护规则 / Context Maintenance

本文件描述「项目现在是什么状态」，而不是完整开发日志。信息过期时更新或删除，不无限追加。未知信息标记 `UNKNOWN`，不猜测；与代码冲突时以代码实际状态为准。
