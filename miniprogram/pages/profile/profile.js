/**
 * 我的页 · 设置与数据说明
 * 临期阈值、主题切换、数据统计、批量导入入口、本地数据说明、清空全部数据。
 */
const app = getApp();
const storage = require('../../utils/storage');
const recordUtil = require('../../utils/record');

const WARN_OPTIONS = [
  { v: 3, label: '3 天' },
  { v: 7, label: '7 天' },
  { v: 14, label: '14 天' }
];
const THEME_OPTIONS = [
  { v: 'system', label: '跟随系统' },
  { v: 'light', label: '浅色' },
  { v: 'dark', label: '深色' }
];

Page({
  data: {
    // 模块加载时（≈小程序启动时）的主题快照：只在「启动后没改过主题」时恰好正确，
    // 能让绝大多数首次进入直接首帧正确、无需任何纠正。
    // 它不是保证 —— 用户改过主题后这个值就偏旧，真正的初始化由下面 onLoad 的通道 A 负责。
    dark: app.isDark(),
    // themeReady 门控：onLoad 的通道 A setData 就绪前，wxml 根节点 wx:if 挡住整个 .page-root，
    // 确保改主题后首次进入本页时旧主题内容绝不进入视觉（门控期间仅显示 page 元素背景色）。
    themeReady: false,
    warnOptions: WARN_OPTIONS,
    warningDays: 7,
    themeOptions: THEME_OPTIONS,
    themePref: 'system',
    stats: { total: 0, expired: 0, warning: 0, safe: 0 }
  },

  onLoad() {
    // 开门 setData（profile 特例：本页 onLoad 无业务计算——设置/统计在 onShow 刷新）。
    // 必须无条件写入 themeReady（不能用 dark 比对守卫），否则「启动后未改主题」时
    // 条件为假 → 不 setData → themeReady 永远 false → wxml 根节点 wx:if 挡住整页 → 白屏。
    // 本页无 contentReady 死字段：wxml 从未读取，stats 默认 0（等同空账户）无空状态误导。
    this.setData({ dark: app.isDark(), themeReady: true });
    // 通道 B · 运行时主题变化：只负责已存在实例的后续变化；同值不 setData（不碰 themeReady）
    this._untheme = app.onTheme(d => {
      if (this.data.dark !== d) this.setData({ dark: d });
    });
  },

  onShow() {
    const settings = app.globalData.settings || storage.loadSettings();
    // onShow 只管原生 chrome（每页一份的标题栏 / 窗口背景），不再负责 DOM 主题纠正
    app.syncPageChrome(this);
    // 设置项可能在其它处被改过（如清空数据后恢复默认），仅在值真的不同时写
    if (this.data.warningDays !== settings.warningDays || this.data.themePref !== settings.theme) {
      this.setData({ warningDays: settings.warningDays, themePref: settings.theme });
    }
    this.syncTabBar(3);
    this.refreshStats();
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

  refreshStats() {
    const settings = app.globalData.settings || storage.loadSettings();
    const items = recordUtil.withStatus(storage.loadRecords(), settings.warningDays);
    const stats = { total: items.length, expired: 0, warning: 0, safe: 0 };
    items.forEach(it => { stats[it.status.level] += 1; });
    this.setData({ stats });
  },

  // 临期阈值切换：保存后所有页面的红黄绿状态在下次展示时立即按新阈值重算
  onWarnTap(e) {
    const v = Number(e.currentTarget.dataset.v);
    if (v === this.data.warningDays) return;
    app.updateWarningDays(v);
    this.setData({ warningDays: v });
    this.refreshStats();
    wx.showToast({ title: '已按新阈值重算状态', icon: 'none' });
  },

  // 主题切换：跟随系统 / 浅色 / 深色
  onThemeTap(e) {
    const v = e.currentTarget.dataset.v;
    if (v === this.data.themePref) return;
    // setThemePref 内部已经 applyChrome + notifyTheme，而 notifyTheme 会驱动本页的
    // onTheme 监听把 dark 写到位，因此这里只需写 themePref，不再重复设置同一个 dark
    app.setThemePref(v);
    this._chromeDark = app.isDark();  // 本页（当前可见页）chrome 已应用，免下次 onShow 重复调用
    this.setData({ themePref: v });
  },

  goArchive() { wx.navigateTo({ url: '/pages/archive/archive' }); },

  goCalendarImport() {
    wx.navigateTo({ url: '/pages/calendar-import/calendar-import' });
  },

  // 本地数据说明
  onDataInfo() {
    wx.showModal({
      title: '本地数据说明',
      content: '你的所有物品记录、家庭事项、封面照片与设置，仅保存在当前设备、当前微信的本地缓存中。\n\n本应用不使用云开发、不联网、不收集任何信息。\n\n请注意：卸载微信、清理小程序缓存或更换设备，都可能导致这些数据丢失。重要信息建议另行备份。',
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  // 清空全部本地数据：两次确认的危险操作
  onClearAll() {
    wx.showModal({
      title: '清空全部本地数据',
      content: '将删除所有物品记录、家庭事项、本地保存的照片与全部设置，且无法恢复。确定继续吗？',
      confirmText: '继续',
      confirmColor: '#C65B55',
      success: r => {
        if (!r.confirm) return;
        wx.showModal({
          title: '再次确认',
          content: '真的要清空吗？此操作不可撤销。',
          confirmText: '清空',
          confirmColor: '#C65B55',
          success: r2 => {
            if (!r2.confirm) return;
            storage.clearAllData();
            // 恢复全局设置为默认值，并按默认主题重新渲染
            app.globalData.settings = storage.loadSettings();
            app.resolveTheme(app.globalData.settings.theme);
            app.applyChrome();
            this._chromeDark = app.isDark();  // 本页 chrome 已应用，免下次 onShow 重复调用
            // notifyTheme 会驱动本页 onTheme 监听更新 dark，这里不再重复写入同一个值
            app.notifyTheme();
            this.setData({
              warningDays: app.globalData.settings.warningDays,
              themePref: app.globalData.settings.theme
            });
            this.refreshStats();
            wx.showToast({ title: '已清空全部数据', icon: 'none' });
          }
        });
      }
    });
  }
});
