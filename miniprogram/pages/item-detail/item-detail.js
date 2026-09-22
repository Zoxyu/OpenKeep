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
const dateUtil = require('../../utils/date');
const processing = require('../../utils/processing');

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
    // 模块加载时（≈小程序启动时）的主题快照：只在「启动后没改过主题」时恰好正确。
    // 本页每次 navigateTo 都新建实例，用户改过主题后该值会偏旧，
    // 真正的初始化由下面 onLoad 的通道 A 负责。
    dark: app.isDark(),
    // themeReady 门控：onLoad 的通道 A setData 就绪前，wxml 根节点 wx:if 挡住整个 .page-root，
    // 确保改主题后首次进入本页时旧主题内容绝不进入视觉（门控期间仅显示 page 元素背景色）。
    themeReady: false,
    id: '',
    record: null,
    status: null,
    cat: null,
    photoOk: false,
    shelfLifeText: '',
    priceText: '',            // 购买价格展示串（M1，未设置为 ''）
    warranty: null,           // getWarrantyStatus 结果（M1）
    warrantyLeftText: '',     // 保修剩余 / 已过保的展示文案（M1）
    maintenance: null,        // 维护信息（M1 第二批次，getMaintenanceInfo 结果）
    maintenanceDoneToday: false,
    completingMaintenance: false,
    missing: false,
    loadError: false,
    deleting: false,
    calendarEntries: [],
    calendarIndex: 0,
    calendarEntry: null,
    calendarBusy: false,
    reminderOptions: REMINDER_OPTIONS.map(r => r.label),
    reminderIndex: 1,
    calSupported: true,
    writing: false
  },

  onLoad(options) {
    // 开门 setData：onLoad 第一条 setData、无条件执行（其前只允许纯非抛异常计算）。themeReady 尽早翻起
    // 缩短系统色空帧；id（来自 options，防御式取值）与 calSupported（纯判断）均为廉价非抛异常计算，一并写入；
    // 记录本体由 onShow refresh() 读取。本页无 contentReady 死字段：中间帧 record=null 时
    // missing 与 record 块均不渲染（干净空白），wxml 无需守卫。
    this.setData({
      dark: app.isDark(),
      themeReady: true,
      id: (options && options.id) || '',
      calSupported: calendarUtil.isSupported()
    });

    // 通道 B · 运行时主题变化：只负责已存在实例的后续变化；同值不 setData（不碰 themeReady）
    this._untheme = app.onTheme(dark => {
      if (this.data.dark !== dark) this.setData({ dark });
    });
  },

  // ====== 分享：发送给朋友 / 分享到朋友圈 ======
  // 数据纯本地存储：朋友设备没有这条记录，分享详情路径必然「记录不存在」；
  // 故标题携带物品状态作谈资，落地页统一指向首页看板（朋友圈 query 同样不携带 id）。
  onShareAppMessage() {
    const r = this.data.record;
    const title = r
      ? '「' + r.name + '」' + this.data.status.label + '——我在用「到期那天」管理保质期'
      : '到期那天：全家物品的保质期看板，红黄绿一眼看清';
    return { title: title, path: '/pages/dashboard/dashboard' };
  },
  onShareTimeline() {
    const r = this.data.record;
    return {
      title: r
        ? '「' + r.name + '」' + this.data.status.label + '——我在用「到期那天」管理保质期'
        : '到期那天：全家物品的保质期看板，红黄绿一眼看清'
    };
  },

  onShow() {
    // onShow 只管原生 chrome（每页一份的标题栏 / 窗口背景），不再负责 DOM 主题纠正
    app.syncPageChrome(this);
    this.refresh();
  },

  onUnload() {
    this._unloaded = true;
    if (this._deleteTimer) clearTimeout(this._deleteTimer);
    if (this._untheme) this._untheme();
  },

  // 每次展示都重新读取并实时计算状态（编辑返回后数据保持最新）
  refresh() {
    if (this._unloaded) return;
    let r;
    try { r = storage.loadEntriesStrict('record').find(it => it.id === this.data.id); }
    catch (e) { this.setData({ loadError: true, missing: false, record: null }); return; }
    if (!r) {
      this.setData({ loadError: false, missing: true, record: null });
      return;
    }
    const settings = app.globalData.settings || storage.loadSettings();
    const status = recordUtil.computeStatus(r, settings.warningDays);
    if (r.archived) Object.assign(status, { level: 'memo', levelText: '已归档', label: '已处理 · 已归档' });
    // M1：保修状态走 record.getWarrantyStatus（与到期状态分离）；价格仅做展示格式化
    const warranty = recordUtil.getWarrantyStatus(r);
    let warrantyLeftText = '';
    if (warranty.hasWarranty) {
      if (warranty.expired) warrantyLeftText = '已过保 ' + (-warranty.daysLeft) + ' 天';
      else if (warranty.daysLeft === 0) warrantyLeftText = '今天最后一天';
      else warrantyLeftText = '还剩 ' + warranty.daysLeft + ' 天';
    }
    const priceText = (r.purchasePrice === null || r.purchasePrice === undefined)
      ? '' : '¥' + Number(r.purchasePrice).toFixed(2);
    // M1 第二批次：维护信息（与到期/保修正交；未设置时 active=false，详情页不显示维护卡）
    const maintenance = recordUtil.getMaintenanceInfo(r);
    const entries = recordUtil.calendarEntries(r).map(entry => Object.assign({}, entry, {
      imported: entry.imported || !!(this._submittedKeys && this._submittedKeys[entry.key])
    }));
    const previousKind = this.data.calendarEntry && this.data.calendarEntry.kind;
    const calendarIndex = Math.max(0, entries.findIndex(e => e.kind === previousKind));
    const calendarEntry = entries[calendarIndex] || null;
    let idx = 1;
    for (let i = 0; i < REMINDER_OPTIONS.length; i++) {
      if (REMINDER_OPTIONS[i].v === (calendarEntry ? calendarEntry.reminderDays : r.calendarReminderDays)) { idx = i; break; }
    }
    this.setData({
      record: r,
      missing: false, loadError: false,
      calendarEntries: entries, calendarIndex, calendarEntry,
      status,
      cat: recordUtil.categoryOf(r.category),
      shelfLifeText: recordUtil.shelfLifeText(r),
      priceText: priceText,
      warranty: warranty,
      warrantyLeftText: warrantyLeftText,
      maintenance: maintenance,
      maintenanceDoneToday: maintenance.active && maintenance.lastDate === dateUtil.todayStr(),
      photoOk: !!r.photoPath && imageUtil.isPhotoValid(r.photoPath),
      reminderIndex: idx
    });
  },

  onReminderChange(e) {
    if (this.data.calendarBusy || this.data.writing) return;
    this.setData({ reminderIndex: Number(e.detail.value) });
  },

  onCalendarKindChange(e) {
    if (this.data.calendarBusy || this.data.writing) return;
    const index = Number(e.detail.value), entry = this.data.calendarEntries[index];
    if (!entry) return;
    const reminderIndex = REMINDER_OPTIONS.findIndex(o => o.v === entry.reminderDays);
    this.setData({ calendarIndex: index, calendarEntry: entry, reminderIndex: reminderIndex < 0 ? 1 : reminderIndex });
  },

  goProcess() {
    if (this.data.deleting || this.data.calendarBusy || this.data.writing) return;
    wx.navigateTo({ url: '/pages/process/process?source=record&id=' + encodeURIComponent(this.data.id) });
  },
  goArchive() { wx.navigateTo({ url: '/pages/archive/archive' }); },
  onEdit() {
    if (this.data.deleting || this.data.calendarBusy || this.data.writing) return;
    if (this.data.record && this.data.record.archived) return;
    wx.navigateTo({ url: '/pages/item-form/item-form?id=' + this.data.id });
  },

  // 完成维护：以本次实际维护日为新起点，不累加旧的计划日期，也不自动写日历。
  onCompleteMaintenance() {
    if (this._unloaded || this.data.deleting || this.data.calendarBusy || this.data.completingMaintenance || this.data.writing) return;
    const record = storage.getRecord(this.data.id);
    if (!record || record.archived || !recordUtil.getMaintenanceInfo(record).active) {
      this.refresh();
      return;
    }
    const today = dateUtil.todayStr();
    if (record.maintenanceLast === today) {
      this.refresh();
      wx.showToast({ title: '今天已记录维护', icon: 'none' });
      return;
    }
    const next = recordUtil.getMaintenanceInfo(Object.assign({}, record, { maintenanceLast: today }));
    this.setData({ completingMaintenance: true });
    wx.showModal({
      title: '确认完成维护',
      content: '将「' + record.name + '」的上次维护日期更新为今天（' + today + '），下次维护为 ' + next.nextDate + '。如需补记其他日期，请使用“编辑物品”。',
      confirmText: '确认完成',
      cancelText: '取消',
      success: res => {
        if (!res.confirm) return;
        // 确认后重读，保留最新的其他字段；记录删除或周期变化时不覆盖、不复活旧记录。
        const latest = storage.getRecord(record.id);
        if (!latest || latest.maintenanceLast !== record.maintenanceLast ||
            latest.maintenanceCycle !== record.maintenanceCycle ||
            latest.maintenanceCycleDays !== record.maintenanceCycleDays || dateUtil.todayStr() !== today) {
          this.refresh();
          wx.showToast({ title: '记录或日期已变化，请重试', icon: 'none' });
          return;
        }
        let saved = false;
        try { saved = processing.complete('record', latest.id, processing.revision(latest, 'record'), 'maintenance'); } catch (e) { /* 保留原状态，允许重试 */ }
        if (!saved) {
          wx.showToast({ title: '保存失败，请重试', icon: 'none' });
          return;
        }
        this.refresh();
        wx.showToast({ title: '已完成维护', icon: 'success' });
      },
      fail: () => wx.showToast({ title: '暂时无法确认，请重试', icon: 'none' }),
      complete: () => this.setData({ completingMaintenance: false })
    });
  },

  // 先成功删除最新记录，再清理照片；异常时保留页面与重试入口。
  onDelete() {
    if (this._unloaded || this.data.deleting || this.data.writing || this.data.calendarBusy || this.data.completingMaintenance || !this.data.record) return;
    this.setData({ deleting: true });
    const id = this.data.id;
    let deleted = false;
    const unlock = () => { if (!this._unloaded && !deleted) this.setData({ deleting: false }); };
    try { wx.showModal({
      title: '删除物品',
      content: '删除后，这条记录、处理历史与本地保存的照片都无法恢复。确定删除吗？',
      confirmText: '删除', confirmColor: '#C65B55',
      success: res => {
        if (this._unloaded) return;
        if (!res.confirm) { unlock(); return; }
        try {
          const latest = storage.loadEntriesStrict('record').find(r => r.id === id);
          if (!latest) throw new Error('记录不存在');
          if (!storage.removeRecord(id)) throw new Error('删除失败');
          deleted = true;
          if (latest.photoPath) imageUtil.removePhoto(latest.photoPath);
          wx.showToast({ title: '已删除', icon: 'none' });
          this._deleteTimer = setTimeout(() => { if (!this._unloaded) wx.navigateBack(); }, 600);
        } catch (e) {
          unlock();
          wx.showToast({ title: '删除失败，请重试', icon: 'none' });
        }
      },
      fail: () => { unlock(); if (!this._unloaded) wx.showToast({ title: '暂时无法确认，请重试', icon: 'none' }); },
      complete: unlock
    }); } catch (e) {
      unlock();
      if (!this._unloaded) wx.showToast({ title: '暂时无法确认，请重试', icon: 'none' });
    }
  },

  // 对已知回执与旧版未知标记均先确认；授权期间锁定所选类别和提前量。
  onAddCalendar() {
    if (this._unloaded || this.data.writing || this.data.calendarBusy || this.data.deleting || this.data.completingMaintenance || !this.data.calendarEntry) return;
    if (!calendarUtil.isSupported()) {
      wx.showModal({ title: '暂不支持写入日历', content: '当前微信版本或设备不支持添加系统日历事件。物品看板功能不受影响。', showCancel: false });
      return;
    }
    const entry = this.data.calendarEntry;
    const reminderDays = REMINDER_OPTIONS[this.data.reminderIndex].v;
    this.setData({ calendarBusy: true });
    const confirm = options => new Promise(resolve => wx.showModal(Object.assign({}, options, {
      success: r => resolve(!!r.confirm), fail: () => resolve(false)
    })));
    const duplicate = entry.imported || entry.legacyUnknown;
    return (duplicate ? confirm({ title: entry.legacyUnknown && !entry.imported ? '旧提醒待核对' : '重新添加',
      content: entry.legacyUnknown && !entry.imported
        ? '旧版本没有记录提醒类别和日期，请先核对手机日历。继续添加可能产生重复提醒。'
        : '本期这类提醒已添加过，再次添加会产生重复提醒。确定继续吗？',
      confirmText: '继续添加', cancelText: '取消' }) : Promise.resolve(true))
      .then(ok => ok && !this._unloaded ? calendarUtil.requestAuth() : { granted: false })
      .then(res => {
        if (!res.granted || this._unloaded) return false;
        if (!res.fresh) return true;
        return confirm({ title: '日历权限已开启', content: '请再次点击，添加所选类别的本期提醒。', confirmText: '添加提醒', cancelText: '取消' });
      })
      .then(ok => { if (ok && !this._unloaded) return this.writeCalendar(entry, reminderDays); })
      .catch(() => { if (!this._unloaded) wx.showToast({ title: '暂时无法添加，请重试', icon: 'none' }); })
      .then(() => { if (!this._unloaded) this.setData({ calendarBusy: false }); });
  },

  writeCalendar(entry, reminderDays) {
    if (this._unloaded || this.data.writing || this.data.deleting || this.data.completingMaintenance) return;
    entry = entry || this.data.calendarEntry;
    if (!entry) return;
    if (reminderDays === undefined) reminderDays = REMINDER_OPTIONS[this.data.reminderIndex].v;
    let record, evt;
    try {
      record = storage.loadEntriesStrict('record').find(r => r.id === this.data.id);
      const current = calendarUtil.currentItemEntry(record, entry);
      if (!current || (current.imported && !entry.imported)) throw new Error('提醒已变化');
      evt = calendarUtil.buildEvent(Object.assign({}, record, { categoryLabel: recordUtil.categoryOf(record.category).label }),
        recordUtil.computeStatus(record, 7), reminderDays, entry.kind);
      if (!evt) throw new Error('日期无效');
    } catch (e) {
      this.refresh();
      wx.showToast({ title: '读取失败或提醒已变化，请重试', icon: 'none' });
      return;
    }
    this.setData({ writing: true });
    return calendarUtil.addEvent(evt).then(() => {
      this._submittedKeys = this._submittedKeys || {};
      this._submittedKeys[entry.key] = true;
      let saved = false;
      try {
        saved = storage.updateExisting('record', record.id, latest => calendarUtil.markItemImported(latest, entry, reminderDays));
      } catch (e) { /* 外部写入已成功，不能把旧期回执写到新期或复活已删除物品。 */ }
      if (this._unloaded) return;
      this.refresh(); this.setData({ writing: false });
      if (saved) wx.showToast({ title: '已添加提醒', icon: 'success' });
      else wx.showModal({ title: '提醒已提交', content: '本地标记未保存或物品已变化。再次添加前请先检查手机日历，避免重复。', showCancel: false });
    }, err => {
      if (this._unloaded) return;
      this.setData({ writing: false });
      wx.showModal({ title: '写入失败', content: '日历事件未能写入：' + calendarUtil.friendlyError(err) + '。物品记录不受影响，可稍后重试。', showCancel: false });
    });
  },

  goBack() {
    wx.navigateBack();
  }
});
