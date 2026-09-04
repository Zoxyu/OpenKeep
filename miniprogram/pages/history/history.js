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
    // contentReady：守卫空状态（wx:elif）不在中间帧误闪；本页中间帧由 loading 骨架承担。
    // 不变量：必须与它所守卫的内容在同一次 setData 里原子翻转——本页由 onShow load() 的 .then
    // 与 events/loading:false 同批置真（.catch 也兜底置真），绝不在 onLoad 提前置真。
    contentReady: false,
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
    // 开门 setData：onLoad 第一条 setData、无条件执行（其前只允许纯非抛异常计算）。themeReady 尽早翻起缩短系统色空帧；
    // month/day/dateText 均为纯日期计算（不读存储、不抛异常），一并写入使门开瞬间
    // 日期头卡即完整；contentReady 交由 onShow load() 的 .then 与 events 原子置真。
    const now = dateUtil.todayStart();
    this.setData({
      dark: app.isDark(),
      themeReady: true,
      month: now.getMonth() + 1,
      day: now.getDate(),
      dateText: (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 · ' + dateUtil.weekdayCN(now)
    });

    // 通道 B · 运行时主题变化：只负责已存在实例的后续变化；同值不 setData（不碰 themeReady/contentReady）
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
        sourceText: SOURCE_TEXT[res.source] || SOURCE_TEXT.local,
        // contentReady 与它守卫的 events/loading:false 同批原子翻转
        contentReady: true
      });
    }).catch(() => {
      // utils/history.js 内层链已补 .catch 保证 getTodayEvents 恒 settle（不会 never-settle）；
      // 此处页面级 .catch 仅作为 executor 同步抛异常（→ 外层 reject）的末位防线，
      // 收起骨架并置 contentReady 防白屏卡死。
      this.setData({ loading: false, refreshing: false, contentReady: true });
    });
  },

  // 下拉刷新（scroll-view refresher）：强制重新获取，跳过当天缓存
  onScrollRefresh() {
    this.setData({ refreshing: true });
    this.load(true);
  }
});
