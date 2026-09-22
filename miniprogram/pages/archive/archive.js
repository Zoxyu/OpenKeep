const app = getApp();
const storage = require('../../utils/storage');
const processing = require('../../utils/processing');
Page({
  data: { dark: app.isDark(), themeReady: false, contentReady: false, items: [], filter: 'all', loadError: false, undoing: false },
  onLoad() {
    this.setData({ dark: app.isDark(), themeReady: true });
    this._untheme = app.onTheme(dark => this.setData({ dark }));
  },
  onShow() { app.syncPageChrome(this); this.refresh(); },
  onUnload() { this._unloaded = true; if (this._untheme) this._untheme(); },
  refresh() {
    try {
      let items = processing.history('record', storage.loadEntriesStrict('record')).concat(processing.history('household', storage.loadEntriesStrict('household')));
      items.sort((a, b) => b.processedAt - a.processedAt);
      if (this.data.filter !== 'all') items = items.filter(e => e.source === this.data.filter);
      this.setData({ items, loadError: false, contentReady: true });
    } catch (e) { this.setData({ loadError: true, contentReady: true }); }
  },
  onFilter(e) {
    if (this.data.undoing) return;
    const filter = e.currentTarget.dataset.filter;
    if (['all', 'record', 'household'].indexOf(filter) < 0) return;
    this.setData({ filter }); this.refresh();
  },
  goDetail(e) {
    const entry = this.data.items.find(i => i.key === e.currentTarget.dataset.key);
    if (!entry) return;
    const page = entry.source === 'household' ? 'household-detail' : 'item-detail';
    wx.navigateTo({ url: '/pages/' + page + '/' + page + '?id=' + encodeURIComponent(entry.recordId) });
  },
  onUndo(e) {
    if (this.data.undoing || this.data.loadError) return;
    const entry = this.data.items.find(i => i.key === e.currentTarget.dataset.key);
    if (!entry || !entry.canUndo) return;
    this.setData({ undoing: true });
    wx.showModal({ title: '撤销本次处理', content: '恢复「' + entry.title + '」处理前的状态和日期。本次处理记录会标记为已撤销；手机日历不会同步修改。', confirmText: '确认撤销',
      success: res => {
        if (this._unloaded || !res.confirm) return;
        try {
          if (!processing.undo(entry.source, entry.recordId, entry.entryId)) throw new Error('保存失败，请重试');
          wx.showToast({ title: '已撤销处理', icon: 'success' }); this.refresh();
        } catch (error) { wx.showModal({ title: '未能撤销', content: error.message, showCancel: false }); this.refresh(); }
      },
      fail: () => { if (!this._unloaded) wx.showToast({ title: '请重试', icon: 'none' }); },
      complete: () => { if (!this._unloaded) this.setData({ undoing: false }); }
    });
  }
});
