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
    dark: false,
    warnOptions: WARN_OPTIONS,
    warningDays: 7,
    themeOptions: THEME_OPTIONS,
    themePref: 'system',
    stats: { total: 0, expired: 0, warning: 0, safe: 0 }
  },

  onLoad() {
    this._untheme = app.onTheme(dark => this.setData({ dark }));
  },

  onShow() {
    const settings = app.globalData.settings || storage.loadSettings();
    this.setData({ dark: app.isDark(), warningDays: settings.warningDays, themePref: settings.theme });
    app.applyChrome();
    this.syncTabBar(2);
    this.refreshStats();
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
    app.setThemePref(v);
    this.setData({ themePref: v, dark: app.isDark() });
  },

  goCalendarImport() {
    wx.navigateTo({ url: '/pages/calendar-import/calendar-import' });
  },

  // 本地数据说明
  onDataInfo() {
    wx.showModal({
      title: '本地数据说明',
      content: '你的所有物品记录、封面照片与设置，仅保存在当前设备、当前微信的本地缓存中。\n\n本应用不使用云开发、不联网、不收集任何信息。\n\n请注意：卸载微信、清理小程序缓存或更换设备，都可能导致这些数据丢失。重要信息建议另行备份。',
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  // 清空全部本地数据：两次确认的危险操作
  onClearAll() {
    wx.showModal({
      title: '清空全部本地数据',
      content: '将删除所有物品记录、本地保存的照片与全部设置，且无法恢复。确定继续吗？',
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
            app.notifyTheme();
            this.setData({
              warningDays: app.globalData.settings.warningDays,
              themePref: app.globalData.settings.theme,
              dark: app.isDark()
            });
            this.refreshStats();
            wx.showToast({ title: '已清空全部数据', icon: 'none' });
          }
        });
      }
    });
  }
});
