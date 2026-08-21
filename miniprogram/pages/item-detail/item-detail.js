/**
 * 物品详情页
 * 展示完整信息 + 编辑 / 删除 + 单条「添加到手机日历」。
 * 日历写入只在用户主动点击后触发；已导入的记录允许重新导入，但明确提示可能重复。
 */
const app = getApp();
const storage = require('../../utils/storage');
const recordUtil = require('../../utils/record');
const imageUtil = require('../../utils/image');
const calendarUtil = require('../../utils/calendar');

const REMINDER_OPTIONS = [
  { v: 0, label: '到期当天提醒' },
  { v: 1, label: '提前 1 天提醒' },
  { v: 2, label: '提前 2 天提醒' },
  { v: 3, label: '提前 3 天提醒' },
  { v: 5, label: '提前 5 天提醒' },
  { v: 7, label: '提前 7 天提醒' },
  { v: 14, label: '提前 14 天提醒' }
];

Page({
  data: {
    dark: false,
    id: '',
    record: null,
    status: null,
    cat: null,
    photoOk: false,
    shelfLifeText: '',
    missing: false,
    reminderOptions: REMINDER_OPTIONS.map(r => r.label),
    reminderIndex: 1,
    calSupported: true,
    writing: false
  },

  onLoad(options) {
    this.setData({
      id: options.id || '',
      calSupported: calendarUtil.isSupported()
    });
    this._untheme = app.onTheme(dark => this.setData({ dark }));
  },

  onShow() {
    this.setData({ dark: app.isDark() });
    this.refresh();
  },

  onUnload() {
    if (this._untheme) this._untheme();
  },

  // 每次展示都重新读取并实时计算状态（编辑返回后数据保持最新）
  refresh() {
    const r = storage.getRecord(this.data.id);
    if (!r) {
      this.setData({ missing: true, record: null });
      return;
    }
    const settings = app.globalData.settings || storage.loadSettings();
    const status = recordUtil.computeStatus(r, settings.warningDays);
    let idx = 1;
    for (let i = 0; i < REMINDER_OPTIONS.length; i++) {
      if (REMINDER_OPTIONS[i].v === r.calendarReminderDays) { idx = i; break; }
    }
    this.setData({
      record: r,
      status,
      cat: recordUtil.categoryOf(r.category),
      shelfLifeText: recordUtil.shelfLifeText(r),
      photoOk: !!r.photoPath && imageUtil.isPhotoValid(r.photoPath),
      reminderIndex: idx
    });
  },

  onReminderChange(e) {
    this.setData({ reminderIndex: Number(e.detail.value) });
  },

  onEdit() {
    wx.navigateTo({ url: '/pages/item-form/item-form?id=' + this.data.id });
  },

  // 删除：二次确认 + 同步删除本地照片文件
  onDelete() {
    wx.showModal({
      title: '删除物品',
      content: '删除后，这条记录与本地保存的照片都无法恢复。确定删除吗？',
      confirmText: '删除',
      confirmColor: '#C65B55',
      success: r => {
        if (!r.confirm) return;
        const rec = this.data.record;
        storage.removeRecord(rec.id);
        if (rec.photoPath) imageUtil.removePhoto(rec.photoPath);
        wx.showToast({ title: '已删除', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 600);
      }
    });
  },

  // ====== 单条日历导入（仅用户主动点击触发） ======
  onAddCalendar() {
    if (this.data.writing || !this.data.record) return;

    // 低版本 / 不支持的设备：降级提示，不影响主功能
    if (!calendarUtil.isSupported()) {
      wx.showModal({
        title: '暂不支持写入日历',
        content: '当前微信版本或设备不支持添加系统日历事件。物品看板功能不受影响。',
        showCancel: false
      });
      return;
    }

    const doWrite = () => {
      calendarUtil.requestAuth().then(res => {
        if (!res.granted) return;
        if (!res.fresh) {
          // 之前已授权：直接写入
          this.writeCalendar();
          return;
        }
        // 首次授权：权限同步存在延迟，紧接着的写入可能被系统吞掉
        // （甚至误报成功），改为弹确认框由用户点击重新发起
        wx.showModal({
          title: '已获得日历权限',
          content: '点击开始写入这条到期提醒（到期日上午 9:00）。',
          confirmText: '开始写入',
          cancelText: '取消',
          success: r => {
            if (r.confirm) this.writeCalendar();
          }
        });
      });
    };

    // 已导入过：重新导入前明确提示可能产生重复日程
    if (this.data.record.calendarImported) {
      wx.showModal({
        title: '重新导入',
        content: '这条记录已写入过日历。再次导入会在系统日历中产生重复日程，确定继续吗？',
        confirmText: '继续导入',
        cancelText: '取消',
        success: r => { if (r.confirm) doWrite(); }
      });
      return;
    }
    doWrite();
  },

  writeCalendar() {
    const { record, status, reminderIndex } = this.data;
    const reminderDays = REMINDER_OPTIONS[reminderIndex].v;
    const evt = calendarUtil.buildEvent(
      Object.assign({}, record, { categoryLabel: this.data.cat.label }),
      status,
      reminderDays
    );
    // 到期日期非法时 buildEvent 返回 null，提前拦截避免崩溃
    if (!evt) {
      wx.showToast({ title: '到期日期无效，无法创建日程', icon: 'none' });
      return;
    }
    this.setData({ writing: true });
    calendarUtil.addEvent(evt).then(() => {
      const updated = Object.assign({}, record, {
        calendarImported: true,
        calendarImportedAt: Date.now(),
        calendarReminderDays: reminderDays,
        updatedAt: Date.now()
      });
      storage.upsertRecord(updated);
      this.setData({ record: updated, writing: false });
      wx.showToast({ title: '已写入日历', icon: 'success' });
    }).catch(err => {
      this.setData({ writing: false });
      wx.showModal({
        title: '写入失败',
        content: '日历事件未能写入：' + calendarUtil.friendlyError(err) + '。物品记录不受影响，可稍后重试。',
        showCancel: false
      });
    });
  },

  goBack() {
    wx.navigateBack();
  }
});
