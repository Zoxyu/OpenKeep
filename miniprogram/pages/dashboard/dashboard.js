/**
 * 首页 · 看板
 * 打开即看：问候语、三色统计、主提醒卡、快捷筛选、物品卡片列表。
 * 状态每次 onShow 实时重算，绝不读取写死的旧状态；下拉刷新仅本地重算。
 */
const app = getApp();
const storage = require('../../utils/storage');
const recordUtil = require('../../utils/record');
const imageUtil = require('../../utils/image');
const dateUtil = require('../../utils/date');
const historyUtil = require('../../utils/history');

Page({
  data: {
    // 模块加载时（≈小程序启动时）的主题快照：只在「启动后没改过主题」时恰好正确，
    // 能让绝大多数首次进入直接首帧正确、无需任何纠正。
    // 它不是保证 —— 用户改过主题后这个值就偏旧，真正的初始化由下面 onLoad 的通道 A 负责。
    dark: app.isDark(),
    // themeReady 门控：onLoad 的通道 A setData 就绪前，wxml 根节点 wx:if 挡住整个 .page-root，
    // 确保改主题后首次进入本页时旧主题内容绝不进入视觉（门控期间仅显示 page 元素背景色）。
    themeReady: false,
    // contentReady：守卫空状态 UI，避免中间帧闪「暂无数据 / 共 0 件」误导文案（见 wxml）。
    // 不变量：必须与它所守卫的列表数据在同一次 setData 里原子翻转——本页由 onShow 的 refresh()
    // 与 stats/list/hasRecords/total 同批置真，绝不在 onLoad 提前置真（否则守卫失效、仍闪空状态）。
    contentReady: false,
    showOnboarding: false,   // 首次启动：选择「体验示例数据 / 从空白开始」
    todayText: '',
    stats: { expired: 0, warning: 0, safe: 0 },
    hasRecords: false,
    urgent: null,            // 最紧急的一条（优先已过期，其次临期）
    warrantySoon: [],        // M1：近期即将过保的物品（轻量提醒，独立于三色到期统计）
    filter: 'all',
    filterOptions: [],
    list: [],
    total: 0,
    // 「历史上的今天」首页预览（本地数据，不触发网络请求）
    historyPreview: null,
    // scroll-view 下拉刷新状态（页面已 disableScroll，改用 refresher）
    refreshing: false
  },

  onLoad() {
    // 开门 setData：onLoad 第一条 setData、无条件执行（其前只允许纯非抛异常计算）。themeReady 尽早翻起打开门控，缩短
    // 「手动锁定主题≠系统」时新建页首帧的系统色空帧；todayText（纯日期计算）与 historyPreview
    // （getLocalPreview 查已缓存模块、纯且廉价、内部 try/catch 保证不抛异常）一并写入，使门开瞬间即为完整正确主题的
    // 静态壳。二者均为纯计算，故置于 themeReady 同批不引入白屏风险；contentReady 交由 onShow
    // refresh() 与列表数据原子置真（本页 onLoad 无第二段，避免多一趟渲染）。
    const now = dateUtil.todayStart();
    const preview = historyUtil.getLocalPreview();
    this.setData({
      dark: app.isDark(),
      themeReady: true,
      todayText: (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 · ' + dateUtil.weekdayCN(now),
      historyPreview: {
        month: preview.month,
        day: preview.day,
        text: preview.first || preview.second || ''
      }
    });

    // 通道 B · 运行时主题变化：只负责已存在实例的后续变化；同值不 setData（不碰 themeReady/contentReady）
    this._untheme = app.onTheme(dark => {
      if (this.data.dark !== dark) this.setData({ dark });
    });
  },

  onShow() {
    // onShow 只管原生 chrome（每页一份的标题栏 / 窗口背景），不再负责 DOM 主题纠正
    app.syncPageChrome(this);
    this.syncTabBar(0);
    this.refresh();
  },

  // 同步自定义 tabBar 选中态
  syncTabBar(index) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setActive(index);
    }
  },

  onUnload() {
    if (this._untheme) this._untheme();
  },

  // 从本地缓存读取记录，实时计算状态并刷新整个看板
  refresh() {
    // try/catch 兜底：本函数承载 contentReady:true，若计算意外抛异常则 contentReady 永不置真、
    // 内容区整块缺失且不自愈；catch 里置 contentReady 并收起刷新态，保证门开后可自愈。
    try {
    const settings = app.globalData.settings || storage.loadSettings();
    const records = storage.loadRecords();
    const items = recordUtil.sortUrgent(recordUtil.withStatus(records, settings.warningDays));

    // 照片文件可能已被清理 / 路径失效，逐条校验后再展示
    items.forEach(it => {
      it.photoOk = !!it.photoPath && imageUtil.isPhotoValid(it.photoPath);
    });

    const stats = { expired: 0, warning: 0, safe: 0 };
    items.forEach(it => { stats[it.status.level] += 1; });

    // 主提醒卡：第一条非「安全」记录；没有则展示新手引导
    let urgentItem = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].status.level !== 'safe') { urgentItem = items[i]; break; }
    }

    // M1：近期保修提醒（轻量，独立于三色到期统计，不改变其含义）；
    // 仅统计已设置保修、且将在 30 天内到期（含今天）的物品，按剩余天数升序。
    const WARRANTY_WINDOW = 30;
    const warrantySoon = [];
    items.forEach(it => {
      const w = recordUtil.getWarrantyStatus(it);
      if (w.hasWarranty && w.daysLeft >= 0 && w.daysLeft <= WARRANTY_WINDOW) {
        warrantySoon.push({
          id: it.id,
          name: it.name,
          daysLeft: w.daysLeft,
          warrantyText: w.daysLeft === 0 ? '今天过保' : '还有 ' + w.daysLeft + ' 天'
        });
      }
    });
    warrantySoon.sort((a, b) => a.daysLeft - b.daysLeft);

    const filter = this.data.filter;
    const list = filter === 'all' ? items : items.filter(it => it.status.level === filter);

    this.setData({
      // contentReady 与它守卫的列表数据同批原子翻转：门开帧不显示误导性的 0/0/0、共 0 件
      contentReady: true,
      showOnboarding: !storage.isOnboarded(),
      stats,
      urgent: urgentItem,
      warrantySoon,
      list,
      hasRecords: items.length > 0,
      total: items.length,
      filterOptions: [
        { key: 'all', label: '全部', count: items.length },
        { key: 'expired', label: '已过期', count: stats.expired },
        { key: 'warning', label: '临期', count: stats.warning },
        { key: 'safe', label: '安全', count: stats.safe }
      ]
    });
    } catch (e) {
      console.error('[dashboard] refresh failed', e);
      this.setData({ contentReady: true, refreshing: false });
    }
  },

  onFilterChange(e) {
    this.setData({ filter: e.detail.key });
    this.refresh();
  },

  // 点击统计卡片 = 快捷筛选到对应状态
  onStatTap(e) {
    this.setData({ filter: e.currentTarget.dataset.level });
    this.refresh();
  },

  onCardTap(e) {
    wx.navigateTo({ url: '/pages/item-detail/item-detail?id=' + e.detail.id });
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/item-detail/item-detail?id=' + e.currentTarget.dataset.id });
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/item-form/item-form' });
  },

  // 跳转「历史上的今天」tab 页
  goHistory() {
    wx.switchTab({ url: '/pages/history/history' });
  },

  // 首次启动引导：写入示例数据（相对今天生成，保证红黄绿都有）
  onUseDemo() {
    storage.saveRecords(recordUtil.demoRecords());
    storage.setOnboarded();
    this.refresh();
    wx.showToast({ title: '已载入示例数据', icon: 'none' });
  },

  // 首次启动引导：空白开始，不写入任何演示数据
  onStartBlank() {
    storage.setOnboarded();
    this.refresh();
  },

  // 下拉刷新（scroll-view refresher）：仅重新计算本地状态，不发起任何网络请求
  onScrollRefresh() {
    this.setData({ refreshing: true });
    this.refresh();
    this.setData({ refreshing: false });
    wx.showToast({ title: '已刷新本地状态', icon: 'none' });
  }
});
