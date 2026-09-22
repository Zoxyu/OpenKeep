const app = getApp();
const storage = require('../../utils/storage');
const household = require('../../utils/household');
const recordUtil = require('../../utils/record');
const calendar = require('../../utils/calendar');
const REMINDER_DAYS = [0, 1, 2, 3, 5, 7, 14];

Page({
  data: { dark: app.isDark(), themeReady: false, contentReady: false, id: '', item: null, missing: false, loadError: false, deleting: false, writing: false, calendarAdded: false, reminderIndex: 1, reminderOptions: REMINDER_DAYS.map(d => d ? '提前 ' + d + ' 天提醒' : '当天提醒') },
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
        missing: !item, loadError: false, contentReady: true,
        calendarAdded: !!item && (item.calendarImportedFor === calendar.householdKey(item) || this._submittedKey === calendar.householdKey(item)),
        reminderIndex: item ? Math.max(0, REMINDER_DAYS.indexOf(item.calendarReminderDays)) : 1
      });
    } catch (e) { this.setData({ loadError: true, contentReady: true }); }
  },
  goProcess() {
    if (this.data.writing || this.data.deleting || !this.data.item || this.data.item.archived) return;
    wx.navigateTo({ url: '/pages/process/process?source=household&id=' + encodeURIComponent(this.data.id) });
  },
  goArchive() { wx.navigateTo({ url: '/pages/archive/archive' }); },
  onReminderChange(e) {
    const index = Number(e.detail.value);
    if (!this.data.writing && Number.isInteger(index) && index >= 0 && index < REMINDER_DAYS.length) this.setData({ reminderIndex: index });
  },
  confirmCalendar(title, content) {
    return new Promise(resolve => wx.showModal({ title, content, confirmText: '添加提醒',
      success: res => resolve(res.confirm), fail: () => resolve(false) }));
  },
  async onAddCalendar() {
    if (this._unloaded || this.data.writing || this.data.deleting || this.data.loadError || !this.data.item || this.data.item.archived) return;
    if (!calendar.isSupported()) {
      wx.showModal({ title: '暂不支持写入日历', content: '当前微信版本或设备不支持添加系统日历事件，事项管理不受影响。', showCancel: false }); return;
    }
    const item = this.data.item;
    const key = calendar.householdKey(item);
    const reminderDays = REMINDER_DAYS[this.data.reminderIndex];
    this.setData({ writing: true });
    try {
      if (this.data.calendarAdded && !await this.confirmCalendar('重新添加提醒', '本期已添加过提醒，再次添加可能重复。确定继续吗？')) return;
      if (this._unloaded) return;
      const auth = await calendar.requestAuth();
      if (!auth.granted || this._unloaded) return;
      if (auth.fresh && !await this.confirmCalendar('日历权限已开启', '请再次点击，添加本期事项的日历提醒。')) return;
      if (this._unloaded) return;
      const latest = storage.getHousehold(item.id);
      if (!latest || latest.archived || calendar.householdKey(latest) !== key) {
        wx.showToast({ title: '事项已变化，请重试', icon: 'none' }); this.refresh(); return;
      }
      const event = calendar.buildHouseholdEvent(latest, reminderDays);
      if (!event) throw new Error('处理日期无效');
      await calendar.addEvent(event);
      this._submittedKey = key;
      let saved = false;
      try {
        saved = storage.updateExisting('household', item.id, current => {
          if (current.archived || calendar.householdKey(current) !== key) throw new Error('事项已变化');
          return Object.assign({}, current, { calendarImportedFor: key, calendarImportedAt: Date.now(), calendarReminderDays: reminderDays });
        });
      } catch (e) { /* 外部日历已提交，不能误报失败并引导直接重试 */ }
      if (this._unloaded) return;
      this.refresh();
      if (saved) wx.showToast({ title: '已添加提醒', icon: 'success' });
      else wx.showModal({ title: '提醒已提交', content: '日历提醒已提交，但本地标记未保存或事项已变化。再次添加前请先检查手机日历，避免重复。', showCancel: false });
    } catch (error) {
      if (!this._unloaded) wx.showModal({ title: '未能添加提醒', content: calendar.friendlyError(error) + '。事项记录保留，可稍后重试。', showCancel: false });
    } finally { if (!this._unloaded) this.setData({ writing: false }); }
  },
  goEdit() {
    if (this.data.item && this.data.item.archived) return;
    if (this.data.deleting || this.data.writing || !this.data.item || this.data.loadError) return;
    wx.navigateTo({ url: '/pages/household-form/household-form?id=' + encodeURIComponent(this.data.id) });
  },
  onDelete() {
    if (this.data.deleting || this.data.writing || !this.data.item || this.data.loadError) return;
    this.setData({ deleting: true });
    wx.showModal({
      title: '删除事项', content: '删除「' + this.data.item.title + '」及其处理历史后无法恢复，确定删除吗？',
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
