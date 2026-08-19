/**
 * 批量导入日历页
 * 候选范围：已过期 + 未来 90 天内到期的记录。
 * 规则：
 *  - 默认勾选「未导入」的记录；「跳过已导入记录」开关默认开启
 *  - 用户确认 + 获得授权后，逐条串行调用 wx.addPhoneCalendar（不并发）
 *  - 展示真实进度，支持中途取消（仅停止尚未写入的任务，已写入的保留）
 *  - 结束后展示「成功 X 条，失败 Y 条」与失败原因
 */
const app = getApp();
const storage = require('../../utils/storage');
const recordUtil = require('../../utils/record');
const calendarUtil = require('../../utils/calendar');

const REMINDER_OPTIONS = [
  { v: 0, label: '到期当天提醒' },
  { v: 1, label: '提前 1 天提醒' },
  { v: 3, label: '提前 3 天提醒' },
  { v: 7, label: '提前 7 天提醒' }
];

Page({
  data: {
    dark: false,
    supported: true,
    items: [],               // [{ record, checked, disabled }]
    hasCandidates: false,
    checkedCount: 0,
    skipImported: true,
    reminderOptions: REMINDER_OPTIONS.map(r => r.label),
    reminderIndex: 1,
    importing: false,
    progressText: '',
    progressPct: 0,
    showResult: false,
    resultCancelled: false,
    resultSuccess: 0,
    resultFail: 0,
    failList: []
  },

  onLoad() {
    this.setData({ supported: calendarUtil.isSupported() });
    this._untheme = app.onTheme(dark => this.setData({ dark }));
  },

  onShow() {
    this.setData({ dark: app.isDark() });
    this.buildList();
  },

  onUnload() {
    if (this._untheme) this._untheme();
    this._cancelled = true; // 离开页面时终止未完成的导入循环
  },

  // 构建候选列表：已过期与未来 90 天内到期
  buildList() {
    const settings = app.globalData.settings || storage.loadSettings();
    const all = recordUtil.withStatus(storage.loadRecords(), settings.warningDays);
    const candidates = recordUtil.sortUrgent(all.filter(it => it.status.daysLeft <= 90));
    const skip = this.data.skipImported;
    const items = candidates.map(it => ({
      record: it,
      checked: !it.calendarImported,
      disabled: skip && it.calendarImported
    }));
    this.setData({
      items,
      hasCandidates: items.length > 0,
      checkedCount: items.filter(i => i.checked).length
    });
  },

  // ====== 选择控制 ======
  onToggle(e) {
    const idx = e.currentTarget.dataset.index;
    const item = this.data.items[idx];
    if (!item || item.disabled || this.data.importing) return;
    const key = 'items[' + idx + '].checked';
    this.setData({ [key]: !item.checked });
    this.recount();
  },

  onToggleAll() {
    if (this.data.importing) return;
    const items = this.data.items;
    const anyUnchecked = items.some(i => !i.checked && !i.disabled);
    const next = items.map(i => (i.disabled ? i.checked : anyUnchecked));
    this.setData({ items: next });
    this.recount();
  },

  recount() {
    this.setData({ checkedCount: this.data.items.filter(i => i.checked).length });
  },

  onSkipChange(e) {
    const skip = e.detail.value;
    // 开关切换后：导入开启时已导入记录不可勾选；关闭时恢复可选（保持未勾选）
    const items = this.data.items.map(i => {
      if (!i.record.calendarImported) return i;
      return {
        record: i.record,
        checked: skip ? false : i.checked,
        disabled: skip
      };
    });
    this.setData({ skipImported: skip, items });
    this.recount();
  },

  onReminderChange(e) {
    this.setData({ reminderIndex: Number(e.detail.value) });
  },

  // ====== 导入流程 ======
  onImport() {
    if (this.data.importing) return;

    if (!this.data.supported) {
      wx.showModal({
        title: '暂不支持写入日历',
        content: '当前微信版本或设备不支持添加系统日历事件。物品看板功能不受影响。',
        showCancel: false
      });
      return;
    }

    const selected = this.data.items.filter(i => i.checked);
    if (!selected.length) {
      wx.showToast({ title: '请先勾选要导入的物品', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '导入到手机日历',
      content: '将创建 ' + selected.length + ' 个系统日历事件（到期日上午 9:00）。已添加的日程请在系统日历中管理，本应用无法删除或修改它们。',
      confirmText: '开始导入',
      cancelText: '取消',
      success: r => {
        if (!r.confirm) return;
        // 仅在用户明确确认后申请权限
        calendarUtil.requestAuth().then(ok => {
          if (ok) this.startImport(selected);
        });
      }
    });
  },

  startImport(selected) {
    this._cancelled = false;
    this._results = [];
    const reminderDays = REMINDER_OPTIONS[this.data.reminderIndex].v;
    this.setData({
      importing: true,
      showResult: false,
      progressText: '正在导入 0 / ' + selected.length,
      progressPct: 0
    });
    this.runStep(selected, 0, reminderDays);
  },

  // 串行逐条写入：避免并发轰炸日历 API，同时能展示真实进度
  runStep(list, idx, reminderDays) {
    if (this._cancelled) { this.finishImport(true); return; }
    if (idx >= list.length) { this.finishImport(false); return; }

    const item = list[idx];
    const evt = calendarUtil.buildEvent(item.record, item.record.status, reminderDays);
    this.setData({
      progressText: '正在导入 ' + (idx + 1) + ' / ' + list.length,
      progressPct: Math.round(idx / list.length * 100)
    });

    calendarUtil.addEvent(evt).then(() => {
      this._results.push({ name: item.record.name, ok: true });
      // 写入成功：更新记录的日历导入状态
      storage.upsertRecord(Object.assign({}, item.record, {
        calendarImported: true,
        calendarImportedAt: Date.now(),
        calendarReminderDays: reminderDays,
        updatedAt: Date.now()
      }));
    }).catch(err => {
      this._results.push({
        name: item.record.name,
        ok: false,
        reason: (err && err.errMsg) || '未知原因'
      });
    }).then(() => {
      this.runStep(list, idx + 1, reminderDays);
    });
  },

  // 中途取消：只停止尚未写入的任务，已成功写入的事件保留
  onCancelImport() {
    this._cancelled = true;
    this.setData({ progressText: '正在停止…' });
  },

  finishImport(cancelled) {
    const results = this._results || [];
    const ok = results.filter(r => r.ok).length;
    const failList = results.filter(r => !r.ok);
    this.setData({
      importing: false,
      progressPct: 100,
      showResult: true,
      resultCancelled: cancelled,
      resultSuccess: ok,
      resultFail: failList.length,
      failList: failList
    });
    if (cancelled) {
      wx.showToast({ title: '已停止，未导入的任务已取消', icon: 'none' });
    }
    this.buildList(); // 刷新列表与「已导入」标记
  },

  onCloseResult() {
    this.setData({ showResult: false });
  }
});
