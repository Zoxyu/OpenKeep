const app = getApp();
const storage = require('../../utils/storage');
const household = require('../../utils/household');
const recordUtil = require('../../utils/record');

Page({
  data: { dark: app.isDark(), themeReady: false, contentReady: false, id: '', item: null, missing: false, loadError: false, deleting: false },
  onLoad(options) {
    this.setData({ dark: app.isDark(), themeReady: true, id: options && options.id || '' });
    this._untheme = app.onTheme(dark => { if (dark !== this.data.dark) this.setData({ dark }); });
  },
  onShow() { app.syncPageChrome(this); this.refresh(); },
  onUnload() { this._unloaded = true; if (this._untheme) this._untheme(); },
  refresh() {
    try {
      const item = storage.getHousehold(this.data.id);
      this.setData({
        item: item ? Object.assign(household.describe(item), { status: recordUtil.computeHouseholdStatus(item) }) : null,
        missing: !item, loadError: false, contentReady: true
      });
    } catch (e) { this.setData({ loadError: true, contentReady: true }); }
  },
  goEdit() {
    if (this.data.deleting || !this.data.item || this.data.loadError) return;
    wx.navigateTo({ url: '/pages/household-form/household-form?id=' + encodeURIComponent(this.data.id) });
  },
  onDelete() {
    if (this.data.deleting || !this.data.item || this.data.loadError) return;
    this.setData({ deleting: true });
    wx.showModal({
      title: '删除事项', content: '删除「' + this.data.item.title + '」后无法恢复，确定删除吗？',
      confirmText: '删除', confirmColor: '#C65B55',
      success: res => {
        if (this._unloaded || !res.confirm) return;
        if (storage.removeHousehold(this.data.id)) {
          wx.showToast({ title: '已删除事项', icon: 'success' });
          wx.navigateBack();
        } else {
          wx.showToast({ title: '删除失败，请重试', icon: 'none' });
          this.refresh();
        }
      },
      fail: () => { if (!this._unloaded) wx.showToast({ title: '未能打开确认框，请重试', icon: 'none' }); },
      complete: () => { if (!this._unloaded) this.setData({ deleting: false }); }
    });
  },
  goBack() { wx.navigateBack(); }
});
