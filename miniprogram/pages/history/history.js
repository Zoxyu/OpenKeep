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
    // 模块加载时（≈小程序启动时）的主题快照：只在「启动后没改过主题」时恰好正确，
    // 能让绝大多数首次进入直接首帧正确、无需任何纠正。
    // 它不是保证 —— 用户改过主题后这个值就偏旧，真正的初始化由下面 onLoad 的通道 A 负责。
    dark: app.isDark(),
    // themeReady 门控：onLoad 的通道 A setData 就绪前，wxml 根节点 wx:if 挡住整个 .page-root，
    // 确保改主题后首次进入本页时旧主题内容绝不进入视觉（门控期间仅显示 page 元素背景色）。
    themeReady: false,
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
    // 通道 A · 首次主题初始化：并入本页原有的 onLoad setData，不额外增加渲染次数
    this.setData({
      dark: app.isDark(),
      themeReady: true,
      month: now.getMonth() + 1,
      day: now.getDate(),
      dateText: (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 · ' + dateUtil.weekdayCN(now)
    });
    // 通道 B · 运行时主题变化：只负责已存在实例的后续变化；同值不 setData
    this._untheme = app.onTheme(dark => {
      if (this.data.dark !== dark) this.setData({ dark });
    });
  },

  onShow() {
    // onShow 只管原生 chrome（每页一份的标题栏 / 窗口背景），不再负责 DOM 主题纠正
    app.syncPageChrome(this);
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
