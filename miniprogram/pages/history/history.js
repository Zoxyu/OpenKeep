/**
 * 历史上的今天页
 * 数据获取策略见 utils/history.js：当天缓存 → 在线接口（需配置）→ 本地精选兜底。
 * 保证在任何情况下（断网、接口失效、未配置 key）都有内容可看。
 */
const app = getApp();
const historyUtil = require('../../utils/history');
const dateUtil = require('../../utils/date');

const SOURCE_TEXT = {
  local: '本地精选内容 · 零联网',
  remote: '内容来自在线接口',
  cache: '内容来自本地缓存（在线数据）'
};

Page({
  data: {
    dark: false,
    loading: true,
    // scroll-view 下拉刷新状态（页面已 disableScroll，改用 refresher）
    refreshing: false,
    month: '',
    day: '',
    dateText: '',
    events: [],
    source: 'local',
    sourceText: SOURCE_TEXT.local
  },

  onLoad() {
    const now = dateUtil.todayStart();
    this.setData({
      month: now.getMonth() + 1,
      day: now.getDate(),
      dateText: (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 · ' + dateUtil.weekdayCN(now)
    });
    this._untheme = app.onTheme(dark => this.setData({ dark }));
  },

  onShow() {
    this.setData({ dark: app.isDark() });
    app.applyChrome();
    this.syncTabBar(2);
    this.load(false);
  },

  onUnload() {
    if (this._untheme) this._untheme();
  },

  // 同步自定义 tabBar 选中态（第 3 个入口：今天）
  syncTabBar(index) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setActive(index);
    }
  },

  load(force) {
    this.setData({ loading: true });
    historyUtil.getTodayEvents(force).then(res => {
      this.setData({
        loading: false,
        // 数据返回后同时收起下拉刷新指示器
        refreshing: false,
        events: res.events || [],
        source: res.source,
        sourceText: SOURCE_TEXT[res.source] || SOURCE_TEXT.local
      });
    });
  },

  // 下拉刷新（scroll-view refresher）：强制重新获取，跳过当天缓存
  onScrollRefresh() {
    this.setData({ refreshing: true });
    this.load(true);
  }
});
