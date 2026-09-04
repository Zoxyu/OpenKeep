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
  { v: 2, label: '提前 2 天提醒' },
  { v: 3, label: '提前 3 天提醒' },
  { v: 5, label: '提前 5 天提醒' },
  { v: 7, label: '提前 7 天提醒' },
  { v: 14, label: '提前 14 天提醒' }
];

// 两条写入之间的串行间隔（毫秒）：iOS 端系统日历写入是异步落盘的，
// 间隔过短会导致第二条及之后全部失败
const STEP_INTERVAL = 800;

// 安卓端：微信要求日历写入必须在用户点击手势链内发起，
// 第一条写入调起系统日历后手势链即被消耗，无论间隔多久自动续写
// 下一条都会被拒绝（报错 addPhoneCalendar:fail can only be invoked
// by user TAP gesture）。因此安卓端改为「逐条弹窗确认续写」，
// 每次弹窗按钮点击形成新的手势链，保证后续条目也能写入成功。
const IS_ANDROID = (wx.getSystemInfoSync() || {}).platform === 'android';

Page({
  data: {
    // 模块加载时（≈小程序启动时）的主题快照：只在「启动后没改过主题」时恰好正确。
    // 本页每次 navigateTo 都新建实例，用户改过主题后该值会偏旧，
    // 真正的初始化由下面 onLoad 的通道 A 负责。
    dark: app.isDark(),
    // themeReady 门控：onLoad 的通道 A setData 就绪前，wxml 根节点 wx:if 挡住整个 .page-root，
    // 确保改主题后首次进入本页时旧主题内容绝不进入视觉（门控期间仅显示 page 元素背景色）。
    themeReady: false,
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
    // 通道 A · 首次主题初始化：并入本页原有的 onLoad setData，不额外增加渲染次数
    this.setData({ dark: app.isDark(), themeReady: true, supported: calendarUtil.isSupported() });
    // 通道 B · 运行时主题变化：只负责已存在实例的后续变化；同值不 setData
    this._untheme = app.onTheme(dark => {
      if (this.data.dark !== dark) this.setData({ dark });
    });
  },

  onShow() {
    // onShow 只管原生 chrome（每页一份的标题栏 / 窗口背景），不再负责 DOM 主题纠正
    app.syncPageChrome(this);
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
    // 存在未勾选的可选记录时全部勾选，否则全部取消。
    // 注意：必须映射为新的记录对象，不能把元素替换成布尔值，
    // 否则会丢掉 record 等字段，导致列表空白且无法再勾选
    const anyUnchecked = items.some(i => !i.checked && !i.disabled);
    const next = items.map(i =>
      i.disabled ? i : Object.assign({}, i, { checked: anyUnchecked })
    );
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
      content: '将为选中的 ' + selected.length + ' 件物品添加到期提醒（到期日上午 9:00）。提醒只写入、不读取你的已有日程；已添加的提醒请在系统日历中管理，本应用无法删除或修改。',
      confirmText: '开始导入',
      cancelText: '取消',
      success: r => {
        if (!r.confirm) return;
        // 仅在用户明确确认后申请权限
        calendarUtil.requestAuth().then(res => {
          if (!res.granted) return;
          if (!res.fresh) {
            // 之前已授权：手势链完整，直接开始
            this.startImport(selected);
            return;
          }
          // 首次授权：权限同步存在延迟，紧接着的第一条写入可能被系统
          // 吞掉（甚至误报成功，导致第一条被标为已导入但实际未写入），
          // 改为弹确认框由用户点击重新发起，确保第一条真正写入
          wx.showModal({
            title: '日历权限已开启',
            content: '请再次点击，为选中的 ' + selected.length + ' 件物品添加到期提醒（到期日上午 9:00）。',
            confirmText: '开始添加',
            cancelText: '取消',
            success: r2 => {
              if (r2.confirm) this.startImport(selected);
            }
          });
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

  // 串行逐条写入：避免并发轰炸日历 API，同时能展示真实进度。
  // 安卓端每次调用会调起系统日历写入流程，上一条尚未落盘就发起下一条会失败
  // （表现为「选 N 条只成功第一条」），因此每条完成后固定间隔 STEP_INTERVAL 再继续。
  runStep(list, idx, reminderDays) {
    if (this._cancelled) { this.finishImport(true); return; }
    if (idx >= list.length) { this.finishImport(false); return; }

    const item = list[idx];
    const evt = calendarUtil.buildEvent(item.record, item.record.status, reminderDays);

    // 到期日期非法等构造失败：记为失败，不阻断后续条目
    if (!evt) {
      this._results.push({
        name: item.record.name,
        ok: false,
        reason: '到期日期无效，无法创建日程'
      });
      this.runStep(list, idx + 1, reminderDays);
      return;
    }

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
        reason: calendarUtil.friendlyError(err)
      });
    }).then(() => {
      // 完成进度同步刷新后再继续下一条
      this.setData({ progressPct: Math.round((idx + 1) / list.length * 100) });
      if (this._cancelled) { this.finishImport(true); return; }

      // 安卓：借弹窗按钮点击获得新手势链，续写下一条（直接自动续写会被微信拒绝）
      if (IS_ANDROID && idx + 1 < list.length) {
        wx.showModal({
          title: '已写入 ' + (idx + 1) + ' / ' + list.length,
          content: '下一条：「' + list[idx + 1].record.name + '」。安卓系统每次写入日历需点击确认。',
          confirmText: '继续写入',
          cancelText: '停止',
          success: r => {
            if (this._cancelled) { this.finishImport(true); return; }
            if (r.confirm) {
              this.runStep(list, idx + 1, reminderDays);
            } else {
              this._cancelled = true;
              this.finishImport(true);
            }
          }
        });
        return;
      }

      // iOS / 开发者工具：间隔后自动串行下一条，给系统日历留出落盘时间
      setTimeout(() => {
        this.runStep(list, idx + 1, reminderDays);
      }, STEP_INTERVAL);
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
    } else if (ok > 0) {
      wx.showToast({ title: '已添加 ' + ok + ' 条提醒', icon: 'success' });
    }
    this.buildList(); // 刷新列表与「已导入」标记
  },

  onCloseResult() {
    this.setData({ showResult: false });
  }
});
