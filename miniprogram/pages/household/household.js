const app = getApp();
const storage = require('../../utils/storage');
const household = require('../../utils/household');
const record = require('../../utils/record');

Page({
  data: { dark: app.isDark(), themeReady: false, contentReady: false, items: [], loadError: false },
  onLoad() {
    this.setData({ dark: app.isDark(), themeReady: true });
    this._untheme = app.onTheme(dark => { if (dark !== this.data.dark) this.setData({ dark }); });
  },
  onShow() { app.syncPageChrome(this); this.refresh(); },
  onUnload() { if (this._untheme) this._untheme(); },
  refresh() {
    try {
      const items = storage.loadHousehold().map(item => Object.assign(household.describe(item), {
        status: record.computeHouseholdStatus(item)
      })).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
      this.setData({ items, loadError: false, contentReady: true });
    } catch (e) {
      this.setData({ loadError: true, contentReady: true });
    }
  },
  goAdd() { wx.navigateTo({ url: '/pages/household-form/household-form' }); },
  goDetail(e) { wx.navigateTo({ url: '/pages/household-detail/household-detail?id=' + encodeURIComponent(e.currentTarget.dataset.id) }); }
});
