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
  - 深浅色主题：`app.wxss` CSS 变量双套色板，`app.js` 主题广播（跟随系统 / 手动切换）
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
| `miniprogram/app.js` | 全局设置、主题解析与广播（`isDark` / `onTheme` / `applyChrome`） | 稳定 |
| `pages/dashboard` | 首页看板：问候、三色统计、主提醒卡、筛选、列表、悬浮添加按钮、历史预览卡、引导页 | 稳定 |
| `pages/items` | 全部物品：搜索 + 分类/状态/排序固定网格筛选（非横滑） | 稳定 |
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
| `utils/history.js` | 历史数据三级获取策略（`API_CONFIG.enabled = false`，在线功能默认关闭） | 稳定 |
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
- 所有页面使用 `disableScroll: true` + 内部 `scroll-view`（`.page-scroll`），不要恢复页面级原生滚动。
- 日历权限仅在用户主动点击导入后申请；禁止后台 / 页面加载时静默申请。
- 中文界面，文案克制温和；尺寸一律 `rpx`；点击区不小于 68rpx。


---

# 4. 当前项目状态 / Current Status

## 整体状态 / Overall Status

功能完整、可编译运行。近两周边开发边在安卓 / iOS 真机上测试，已修复多轮兼容性缺陷；用户正在自行进行最终真机验证（用户明确不需要 Agent 代跑验证）。

## 已完成 / Completed

- 全部 7 页面 + 4 组件 + 自定义悬浮胶囊 tabBar + 深色模式
- 物品录入体系：保质期（天/月/年）为主、开封后可保存天数为可选修正、存放位置、已开封 X 天快捷反推
- 三色状态看板、搜索/筛选/排序（物品页为固定网格，一屏可见）
- 单条 + 批量手机日历导入（含安卓手势链兼容方案）
- 历史上的今天（本地 366 天数据，来自开源项目 PrintNow/TodayInHistory，经敏感词过滤）
- 首次启动引导（体验示例数据 / 从空白开始）
- README、隐私政策（`privacy-policy.txt`）、小程序图标；项目已在 Git 管理（main 分支，共 7 个提交，工作区仅有未跟踪的 `AGENTS.md` / `AI_CONTEXT.md`）

## 进行中 / In Progress

- 用户真机最终验证；等待用户反馈新问题。

## 阻塞问题 / Blocked

- 无 / None

## 已知问题 / Known Issues

- 部分安卓机型首次批量导入后，第一条记录可能被误标「已导入」但系统日历中实际没有（历史数据问题，需用户关闭「跳过已导入记录」重新导入该条补写）。
- 个别安卓厂商 ROM 每次日历写入都弹系统确认页，需逐条手动保存，属平台行为无法绕过（已在批量导入页文案中提示）。
- `tools/history_in_today.json`（约 6MB 源数据）已随仓库提交，体积偏大但不影响小程序包体积（不在 `miniprogramRoot` 内）。


---

# 5. 当前任务 / Active Tasks

无进行中任务。等待用户真机测试反馈。


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

**日期 / Date:** 2026-08-21

**决定 / Decision:** 所有 7 个页面配置 `"disableScroll": true`，主体内容放入 `scroll-view.page-scroll`（`100vh`）；首页与「今天」页下拉刷新改用 `refresher`。

**原因 / Reason:** iOS WebView 页面整体可上下左右拖拽、内容偏移、双向滚动条，真机实锤；锁死后横向位移彻底消失。

**影响 / Impact:** 新增页面必须沿用此模式；fixed 元素（悬浮按钮、弹层、底部操作栏）需放在 `scroll-view` 之外。

## 决策 6：主题首帧用 `themeReady` 门控，杜绝旧主题闪现

**日期 / Date:** 2026-09-04

**决定 / Decision:** 7 个页面（dashboard / items / history / profile / item-form / item-detail / calendar-import）统一采用 `themeReady` 门控：页面 `data` 新增 `themeReady: false`，WXML 根节点 `.page-root` 加 `wx:if="{{themeReady}}"`，`onLoad` 的通道 A `setData` 并入 `themeReady: true`（与 `dark` 同一条消息）。原有「通道 A（`onLoad` 同步读 `app.isDark()`）+ 通道 B（`app.onTheme` 监听已存在实例）」架构保持不变。

**原因 / Reason:** `Page({data:{...}})` 的 data 字面量只在模块求值时（无分包＝启动时）构造一次，新建实例的 `dark` 初值是「启动那一刻」的旧快照；`setData` 又是跨线程异步消息，无法保证并入首帧渲染。因此改主题后首次进入未访问页面，会先渲染旧主题一帧再纠正。门控是唯一能保证「错误主题内容绝不进入视觉」的手段。

**影响 / Impact:**
- **profile 页须无条件写 `themeReady`**：其 `onLoad` 原为守卫式（`if (this.data.dark !== dark) setData(...)`），若保留守卫，「启动后未改主题」时条件为假 → 不 `setData` → `themeReady` 永远 false → 白屏。已改为无条件 `this.setData({ dark: dark, themeReady: true })`。
- **门控期间视口仅显示 `page` 元素背景色**（跟随系统主题），这是「绝不允许错误主题内容进入视觉」的既定权衡，属正常表现，非缺陷。
- **custom-tab-bar 不门控**：tabBar 渲染在 `.page-root` 之外，加 `wx:if` 会导致切页时底部导航消失再现，体验更差；tabBar 已有 `attached` 通道 A。
- **4 个组件不门控**：item-card / empty-state / filter-bar / status-badge 均渲染在页面 `.page-root` 内部，随页面门控自动覆盖。
- `onShow` 职责不变（仅 `app.syncPageChrome(this)` 处理原生标题栏/窗口背景），不得在此加 `dark` / `themeReady` 纠正。
- 首帧/渲染时序无法用 Node 或模拟器验证，最终以真机为准。

**补充（2026-09-04 修正版，取代当日早先的「开门前置两段式」描述）：开门 setData 含廉价纯字段 + `contentReady` 与内容在 onShow 原子翻转**

门控放行前那一瞬视口显示 `page` 元素背景（只跟随系统主题）；手动锁定主题≠系统时会露一帧系统色纯底。经查证这是微信平台硬限制（新建页首帧只认系统色/快照，运行时改色都在首帧之后），**颜色无法根治**。用户批准的优化：尽量缩短该空帧可见时长并顺带加固白屏，且不得改变「跟随系统」场景观感。早先的「两段式」把廉价静态字段推迟到第二段、又把 `contentReady` 放在 onLoad，三维度评审发现两大缺陷（门开空壳帧 + contentReady 与列表数据非原子导致仍闪空状态），现修正为下述最终设计：

- **最终设计（一句话）**：开门 setData（onLoad **第一条 setData**、无条件；其前只允许已核实的纯非抛异常计算，禁止存储读取或任何可能抛异常的表达式）= `themeReady` + 所有「纯计算、不读存储、不依赖记录」的廉价静态字段；有风险的存储读取一律后移到开门之后；`contentReady` 与它守卫的内容数据在 **onShow** 的同一次 setData 里原子翻转。
- **`contentReady` 不变量（核心）**：`contentReady` 必须在「写入其所守卫内容」的**同一次 setData** 里原子置真——列表页即 onShow 的 `load()` / `refresh()` / `buildList()`（与 allItems/list/stats/total/items/events 等同批）。**绝不允许在 onLoad 提前置真而数据由 onShow 填充**：二者非原子会留下「contentReady 已 true、列表仍为默认空值」的窗口，使空状态守卫 `contentReady && !hasAny` 误判为真、仍闪「暂无数据 / 共 0 件」。本项目已多次证伪「onLoad 与 onShow 两次 setData 同帧落地」假设，故不得依赖它。为兜底，dashboard `refresh()` / items `load()` / calendar-import `buildList()` 均包 try/catch，catch 分支置 `contentReady:true`（及该页适用的收口字段如 dashboard `refreshing:false`），保证计算意外抛异常时 contentReady 仍会置真、内容区可自愈（与 history 的 `.catch` 同理）。
- **开门 setData 各页内容**（onLoad 第一条、无条件，themeReady 前只允许纯非抛异常计算）：
  - **dashboard**：`{ dark, themeReady:true, todayText, historyPreview }`（todayText 纯日期计算；historyPreview=`getLocalPreview()` 查已缓存 require 模块、纯且廉价、不抛异常）。onLoad 无第二段；list/stats/total 由 onShow `refresh()` 负责并置 contentReady。
  - **items**：`{ dark, themeReady:true, categoryOptions }`（`Object.keys(...).map` 纯计算）。contentReady 由 onShow `load()` 置真。
  - **history**：`{ dark, themeReady:true, month, day, dateText }`（纯日期计算）。contentReady 由 onShow `load()` 的 `.then` 与 events/loading:false 同批置真；**并补 `.catch` 也置 contentReady:true**——但该 `.catch` 仅覆盖 `getTodayEvents` executor 同步抛异常导致的 reject；其内层 `.then` 链无 catch，若内层回调同步抛异常会导致外层 promise 永不 settle（`.then`/`.catch` 均不触发），属 utils 层既有限制，需另行在 utils 内层补 catch 才能根治（本轮不改 utils）。
  - **calendar-import**：`{ dark, themeReady:true, supported }`（`calendarUtil.isSupported()` 纯 `wx.canIUse`）。contentReady 由 onShow `buildList()` 置真。
  - **item-detail**：`{ dark, themeReady:true, id, calSupported }`（id 来自 options、calSupported 纯判断）。record 由 onShow `refresh()` 读取。
  - **item-form**：`{ dark, themeReady:true, categoryOptions, isEdit, openedAt, refHint }`，按 `editIntent=!!(options&&options.id)` 分支——categoryOptions（`Object.keys.map`）恒为纯计算；新建模式 openedAt=今日、refHint=冰箱提示、isEdit=false；编辑模式 openedAt/refHint 留空、isEdit=true（isEdit 驱动保存按钮文案与删除按钮显隐，故门开帧模式相关 UI 即正确，不会先闪「今日日期+冰箱提示+『保存物品』+无删除按钮」的错误新建态）。**门开帧即为完整表单壳**（分类格已渲染）。开门之后再处理编辑模式：`if (options && options.id)` 时 `storage.getRecord(options.id)` + 第二次 setData 写入编辑真实字段（含 origin）+ `wx.setNavigationBarTitle('编辑物品')`；记录不存在则 toast+`setTimeout(navigateBack,800)`（原有业务逻辑）；新建模式无需第二段。保存分支用 `isEdit && origin` 判定，开门帧 origin 仍为 null、编辑值在第二段随 origin 一起写入，逻辑不变。
  - **profile**：`{ dark, themeReady:true }`（本页 onLoad 无业务字段，设置/统计在 onShow）。仍须无条件写 themeReady 防白屏（守卫式会因未改主题时条件为假→themeReady 永不置真→白屏）。
- **`contentReady` 只保留在 4 个列表页**（dashboard / items / history / calendar-import），均在 onShow 内容 setData 里与数据原子置真、在 wxml 里守卫空状态。**profile / item-detail / item-form 已彻底删除 contentReady 死字段**（此前只写不读）：item-detail 用 missing/record 分支、中间帧 record=null 干净空白；item-form 门开帧已是完整表单壳、编辑值随后填入（正确主题、可接受）；profile 为静态设置 UI、stats 默认 0 等同空账户，均无空状态误导。
- **wxml 空状态守卫**（防中间帧闪「暂无数据」）：
  - **dashboard**：三色统计卡 `wx:if="{{contentReady}}"`、list-head「共 N 件」`wx:if="{{contentReady}}"`、filter-bar `wx:if="{{contentReady}}"`（门开帧不显示误导性 0/0/0、共 0 件、空筛选栏）；引导卡 `wx:elif="{{contentReady && !hasRecords && !showOnboarding}}"`、empty-state `wx:if="{{contentReady && !list.length}}"`。todayText/historyPreview 在开门 setData 已有，正常显示不需守卫。
  - **items**：empty-state/添加按钮 `wx:if="{{contentReady && !hasAny}}"`、搜索空态 `wx:elif="{{contentReady && !list.length}}"`、结果列表 `wx:elif="{{contentReady}}"`。
  - **history**：empty-state `wx:elif="{{contentReady}}"`（中间帧主要由 `loading` 骨架承担，contentReady 为兜底）。
  - **calendar-import**：empty-state `wx:elif="{{contentReady}}"`。
  - 用 `wx:elif="{{contentReady}}"` 收尾分支链时须确保该页有骨架或分支可达，否则失败模式为「有壳无内容」。
- **不变量**：7 个根节点 `wx:if="{{themeReady}}"` 原样保留；通道 B（`app.onTheme` 回调仅 `setData({dark})` 带同值守卫）不碰 themeReady/contentReady；onShow 仍只做 `syncPageChrome` + 业务刷新，**把 contentReady 并入 onShow 既有那次内容 setData 是允许的**（不新增渲染次数、contentReady 非 dark/themeReady）；未引入 setTimeout/动画补救；未改 app.js/app.wxss/theme.json/app.json/custom-tab-bar/4 组件主题逻辑；未删 prepareTabSwitch/tabBarSnapshot。
- **白屏不变量（维护须知）**：themeReady 在开门 setData 无条件写入、位于 onLoad 第一条 setData；其前只允许纯非抛异常计算（评审已确认各页开门字段均纯计算不抛异常）；有风险的存储读取一律后移到开门之后。未来若有人在开门 setData 之前或其字面量内加入会抛异常的存储读取，onLoad 中断→永久白屏。


---

# 7. 重要约束 / Important Constraints

- 基础库最低兼容 2.15.0；使用较高版本 API 前必须 `wx.canIUse` 检测。
- 微信 `require()` 不支持加载 `.json` 文件（基础库 3.x 报 `module not defined`），数据文件必须输出为 `.js` 模块（`module.exports = {...}`）。
- 日历 API 只写不读、不返回事件 ID，无法删除/更新已写入日程；时间戳与 `alarmOffset` 均为**秒**；事件固定到期日上午 09:00；需显式传 `endTime`（+3600s）否则部分安卓异常；已过期物品的事件时间钳制到最近未来的 09:00。
- `wx.setStorage` 总量约 10MB、单 key 约 1MB；照片走文件系统不占该额度。
- 卸载微信 / 清缓存 / 换设备会丢数据，已在「本地数据说明」中向用户明示。
- 模拟器与真机行为差异大（相机、日历），验证以真机为准；用户自行真机验证，Agent 无需代跑。
- 日历写入需隐私协议中声明「使用你的日历（仅写入）权限」。


---

# 8. 最近的重要变化 / Recent Significant Changes

- 2026-09-04 — 7 个页面新增 `themeReady` 门控（见决策 6），修复「深浅模式切换后首次进入页面闪现旧主题」顽固 bug；profile 页 `onLoad` 改为无条件写 `themeReady` 防白屏。
- 2026-09-04 — 门控优化修正版（见决策 6 补充，取代当日早先「两段式」描述）：三维度评审发现「两段式」两大缺陷（门开空壳帧 + contentReady 与列表数据非原子仍闪空状态）。修正为：开门 setData（onLoad 第一条、无条件）= themeReady + 廉价纯字段（todayText/historyPreview/categoryOptions/month/day/dateText/supported/id/calSupported/openedAt/refHint），消除空壳帧；`contentReady` 从 onLoad 移到 onShow 的 load/refresh/buildList，与列表数据原子翻转；history 补 `.catch` 兜底置 contentReady；dashboard 三色统计/共 N 件/filter-bar 补 contentReady 守卫；删除 profile/item-detail/item-form 的 contentReady 死字段（只写不读）。contentReady 最终只保留在 4 个列表页。item-form 编辑模式门开帧已是完整表单壳、编辑值在开门后第二段填入。
- 2026-08-26 — 初始化 `AI_CONTEXT.md`（本次）；根目录新增 `AGENTS.md` / `AI_CONTEXT.md`（未提交）。
- 2026-08-21 前后 — 修复安卓日历导入三连问题（手势链逐条确认、首次授权吞第一条、全选/取消全选破坏列表数据结构）；全页面 `disableScroll` + `scroll-view` 改造锁定 iOS 滚动。
- 2026-08 中旬 — 保质期体系重构（保质期为主、开封天数为可选修正、存放位置、日历文案「你放在XX的XX快要到期啦」）；物品页筛选改固定网格。
- 2026-08 上旬 — 项目更名为「到期那天 In Time」；新增「历史上的今天」功能；自定义悬浮胶囊 tabBar。

完整开发说明见 `README.md`；提交历史见 `git log`（main 分支）。


---

# 9. 下一步建议 / Next Recommended Actions

1. 等待用户真机验证反馈；若报新缺陷，优先核对本文件「已知问题」与决策 4/5 的兼容性结论。
2. 用户验证通过后：将 `AGENTS.md` / `AI_CONTEXT.md` 纳入版本控制（由用户决定是否提交）。
3. 可选优化方向（需用户确认后再做）：考虑把 `tools/history_in_today.json`（6MB）移出仓库或加入忽略；为「历史上的今天」补充更多日期事件需重新运行 `node tools/convert.js`。
4. 若未来开放在线接口，需在小程序后台配置合法域名并更新隐私协议；目前 `utils/history.js` 中 `API_CONFIG.enabled = false`。


---

# 10. 上下文维护规则 / Context Maintenance

本文件描述「项目现在是什么状态」，而不是完整开发日志。信息过期时更新或删除，不无限追加。未知信息标记 `UNKNOWN`，不猜测；与代码冲突时以代码实际状态为准。
