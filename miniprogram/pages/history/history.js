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
    // 创建时即取真实主题：首帧就是正确深浅色，不再靠 onLoad / onShow 的 setData 追平
    dark: app.isDark(),
    // 仅首次进入时为 true（数据真的尚未取到）；之后的切页不再重新置 true
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
    // 只处理「主题真的发生变化」；同值不 setData
    this._untheme = app.onTheme(dark => {
      if (this.data.dark !== dark) this.setData({ dark });
    });
  },

  onShow() {
    // 主题：只在真的变化时才 setData / 刷新原生 chrome（见 app.syncPageTheme）
    app.syncPageTheme(this);
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
    // 刻意不再先 setData({ loading: true })：在线接口已关闭（API_CONFIG.enabled = false），
    // 数据走本地模块、微任务即返回。先置 loading 再置回，等于每次切到本页都
    // 多渲染一趟「加载态 → 内容」，就是二次刷新感的来源之一。
    // 首次进入的加载态由 data.loading 的初值承担；下拉刷新的反馈由 refreshing 承担。
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
