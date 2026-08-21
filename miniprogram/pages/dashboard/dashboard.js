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
    dark: false,
    showOnboarding: false,   // 首次启动：选择「体验示例数据 / 从空白开始」
    todayText: '',
    stats: { expired: 0, warning: 0, safe: 0 },
    hasRecords: false,
    urgent: null,            // 最紧急的一条（优先已过期，其次临期）
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
    const now = dateUtil.todayStart();
    const preview = historyUtil.getLocalPreview();
    this.setData({
      todayText: (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 · ' + dateUtil.weekdayCN(now),
      historyPreview: {
        month: preview.month,
        day: preview.day,
        text: preview.first || preview.second || ''
      }
    });
    this._untheme = app.onTheme(dark => this.setData({ dark }));
  },

  onShow() {
    this.setData({ dark: app.isDark() });
    app.applyChrome();
    this.syncTabBar(0);
    this.refresh();
  },

  // 同步自定义 tabBar 选中态
  syncTabBar(index) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: index });
    }
  },

  onUnload() {
    if (this._untheme) this._untheme();
  },

  // 从本地缓存读取记录，实时计算状态并刷新整个看板
  refresh() {
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

    const filter = this.data.filter;
    const list = filter === 'all' ? items : items.filter(it => it.status.level === filter);

    this.setData({
      showOnboarding: !storage.isOnboarded(),
      stats,
      urgent: urgentItem,
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
