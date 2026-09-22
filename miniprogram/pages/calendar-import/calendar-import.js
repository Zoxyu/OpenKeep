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
    // contentReady：守卫空状态 UI，避免中间帧闪「暂无需要提醒的物品」。
    // 不变量：必须与它所守卫的候选列表在同一次 setData 里原子翻转——本页由 onShow 的 buildList()
    // 与 items/hasCandidates 同批置真，绝不在 onLoad 提前置真。
    contentReady: false,
    supported: true,
    items: [],               // 每条为独立的物品＋类别＋日期提醒，附带 checked / disabled
    hasCandidates: false,
    loadError: false,
    confirming: false,
    checkedCount: 0,
    skipImported: true,
    // M1：保修提醒窗口开关（>30 天保修也纳入候选），读自 settings
    warrantyBeyond30: false,
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
    // 开门 setData：onLoad 第一条 setData、无条件执行（其前只允许纯非抛异常计算）。themeReady 尽早翻起缩短系统色空帧；
    // supported=calendarUtil.isSupported() 为纯 wx.canIUse 判断（不读存储、不抛异常），一并写入；
    // contentReady 交由 onShow buildList() 与候选列表数据原子置真。
    this.setData({ dark: app.isDark(), themeReady: true, supported: calendarUtil.isSupported() });

    // 通道 B · 运行时主题变化：只负责已存在实例的后续变化；同值不 setData（不碰 themeReady/contentReady）
    this._untheme = app.onTheme(dark => {
      if (this.data.dark !== dark) this.setData({ dark });
    });
  },

  onShow() {
    // onShow 只管原生 chrome（每页一份的标题栏 / 窗口背景），不再负责 DOM 主题纠正
    app.syncPageChrome(this);
    if (!this.data.importing && !this.data.confirming) this.buildList();
  },

  onUnload() {
    this._unloaded = true;
    if (this._stepTimer) clearTimeout(this._stepTimer);
    if (this._untheme) this._untheme();
    this._cancelled = true; // 离开页面时终止未完成的导入循环
  },

  // 构建候选列表：已过期与未来 90 天内到期
  buildList() {
    // try/catch 兜底：本函数承载 contentReady:true，若计算意外抛异常则 contentReady 永不置真、
    // 候选列表整块缺失且不自愈；catch 里置 contentReady 保证门开后可自愈（本页无 loading 字段）。
    try {
      const settings = app.globalData.settings || storage.loadSettings();
      const all = recordUtil.withStatus(storage.loadEntriesStrict('record'), settings.warningDays);
      const wWindow = settings.warrantyBeyond30 ? Infinity : 30;
      const candidates = [];
      all.forEach(record => recordUtil.calendarEntries(record).forEach(entry => {
        const inWindow = entry.kind === 'due' ? entry.daysLeft <= 90
          : entry.kind === 'warranty' ? entry.daysLeft >= 0 && entry.daysLeft <= wWindow
            : entry.daysLeft <= 30;
        if (inWindow) candidates.push(Object.assign({ record }, entry));
      }));
      candidates.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.record.name.localeCompare(b.record.name) || a.kind.localeCompare(b.kind));
      const items = candidates.map(entry => {
        const imported = entry.imported || !!(this._submittedKeys && this._submittedKeys[entry.key]);
        const expiredText = entry.kind === 'warranty' ? '已过保' : entry.kind === 'maintenance' ? '已超期' : '已过期';
        return Object.assign({}, entry, {
          imported,
          checked: !imported && !entry.legacyUnknown && entry.daysLeft >= 0,
          disabled: this.data.skipImported && imported,
          level: entry.daysLeft < 0 ? 'expired' : entry.daysLeft <= 7 ? 'warning' : 'safe',
          levelText: entry.daysLeft < 0 ? expiredText : entry.daysLeft === 0 ? '今天到期' : '未到期',
          remainingText: entry.daysLeft < 0 ? expiredText + ' ' + (-entry.daysLeft) + ' 天' : '还剩 ' + entry.daysLeft + ' 天'
        });
      });
      this.setData({
        // contentReady 与它守卫的候选列表同批原子翻转
        contentReady: true, loadError: false,
        items,
        hasCandidates: items.length > 0,
        checkedCount: items.filter(i => i.checked).length,
        warrantyBeyond30: !!settings.warrantyBeyond30
      });
    } catch (e) {
      console.error('[calendar-import] buildList failed', e);
      this.setData({ contentReady: true, loadError: true, items: [], hasCandidates: false, checkedCount: 0 });
    }
  },

  // ====== 选择控制 ======
  onToggle(e) {
    const idx = e.currentTarget.dataset.index;
    const item = this.data.items[idx];
    if (!item || item.disabled || this.data.importing || this.data.confirming) return;
    const key = 'items[' + idx + '].checked';
    this.setData({ [key]: !item.checked });
    this.recount();
  },

  onToggleAll() {
    if (this._unloaded || this.data.importing || this.data.confirming) return;
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
    if (this.data.importing || this.data.confirming) return;
    const skip = e.detail.value;
    // 开关切换后：导入开启时已导入记录不可勾选；关闭时恢复可选（保持未勾选）
    const items = this.data.items.map(i => {
      if (!i.imported) return i;
      return Object.assign({}, i, { checked: skip ? false : i.checked, disabled: skip });
    });
    this.setData({ skipImported: skip, items });
    this.recount();
  },

  onReminderChange(e) {
    if (this.data.importing || this.data.confirming) return;
    this.setData({ reminderIndex: Number(e.detail.value) });
  },

  // M1：保修提醒窗口开关（>30 天保修也纳入候选与看板卡）；持久化到 settings 并重建候选
  onWarrantyBeyondChange(e) {
    if (this.data.importing || this.data.confirming) return;
    const on = !!e.detail.value;
    const settings = app.globalData.settings || storage.loadSettings();
    settings.warrantyBeyond30 = on;
    storage.saveSettings(settings);
    app.globalData.settings = settings;
    this.setData({ warrantyBeyond30: on });
    this.buildList();
  },

  // ====== 导入流程 ======
  onImport() {
    if (this._unloaded || this.data.importing || this.data.confirming) return;

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
      wx.showToast({ title: '请先勾选要导入的提醒', icon: 'none' });
      return;
    }

    this.setData({ confirming: true });
    const confirm = options => new Promise(resolve => wx.showModal(Object.assign({}, options, {
      success: r => resolve(!!r.confirm), fail: () => resolve(false)
    })));
    const duplicate = selected.some(i => i.imported || i.legacyUnknown);
    return confirm({
      title: '导入到手机日历',
      content: '将添加 ' + selected.length + ' 条提醒，同一物品的不同类别分别写入。' +
        (duplicate ? '所选包含已添加或旧版待核对的提醒，请先检查手机日历，继续可能产生重复。' : '') +
        '提醒只写入、不读取，已添加的日程请在手机日历中管理。',
      confirmText: '开始导入', cancelText: '取消'
    }).then(ok => ok && !this._unloaded ? calendarUtil.requestAuth() : { granted: false })
      .then(res => {
        if (!res.granted || this._unloaded) return false;
        if (!res.fresh) return true;
        return confirm({ title: '日历权限已开启', content: '请再次点击，添加选中的 ' + selected.length + ' 条提醒。', confirmText: '开始添加', cancelText: '取消' });
      }).then(ok => {
        if (this._unloaded) return;
        this.setData({ confirming: false });
        if (ok) this.startImport(selected);
      }).catch(() => {
        if (this._unloaded) return;
        this.setData({ confirming: false });
        wx.showToast({ title: '暂时无法导入，请重试', icon: 'none' });
      });
  },

  startImport(selected) {
    if (this._unloaded || this.data.importing || !selected.length) return;
    this._cancelled = false;
    this._results = [];
    const reminderDays = REMINDER_OPTIONS[this.data.reminderIndex].v;
    this.setData({ importing: true, confirming: false, showResult: false,
      progressText: '正在导入 0 / ' + selected.length, progressPct: 0 });
    this.runStep(selected, 0, reminderDays);
  },

  // 串行逐条写入：避免并发轰炸日历 API，同时能展示真实进度。
  // 安卓端每次调用会调起系统日历写入流程，上一条尚未落盘就发起下一条会失败
  // （表现为「选 N 条只成功第一条」），因此每条完成后固定间隔 STEP_INTERVAL 再继续。
  runStep(list, idx, reminderDays) {
    if (this._unloaded) return;
    if (this._cancelled) { this.finishImport(true); return; }
    if (idx >= list.length) { this.finishImport(false); return; }

    const item = list[idx];
    let evt, reason = '';
    try {
      const latest = storage.loadEntriesStrict('record').find(r => r.id === item.record.id);
      const current = calendarUtil.currentItemEntry(latest, item);
      if (!current) throw new Error('物品或提醒日期已变化，请重新选择');
      if (current.imported && !item.imported) throw new Error('本期提醒刚刚已添加，请核对手机日历');
      evt = calendarUtil.buildEvent(Object.assign({}, latest, { categoryLabel: recordUtil.categoryOf(latest.category).label }),
        recordUtil.computeStatus(latest, 7), reminderDays, item.kind);
      if (!evt) throw new Error('到期日期无效，无法创建日程');
    } catch (e) { reason = e.message || '读取失败，请重试'; }
    if (!evt) {
      this._results.push({ name: item.record.name + ' · ' + item.label, ok: false, reason });
      this.runStep(list, idx + 1, reminderDays);
      return;
    }

    this.setData({
      progressText: '正在导入 ' + (idx + 1) + ' / ' + list.length,
      progressPct: Math.round(idx / list.length * 100)
    });

    calendarUtil.addEvent(evt).then(() => {
      this._results.push({ name: item.record.name + ' · ' + item.label, ok: true });
      this._submittedKeys = this._submittedKeys || {};
      this._submittedKeys[item.key] = true;
      // 写入成功：更新记录的日历导入状态
      let saved = false;
      try {
        saved = storage.updateExisting('record', item.record.id, latest => calendarUtil.markItemImported(latest, item, reminderDays));
      } catch (e) { /* 不用导入前快照覆盖新处理记录，也不复活已删除记录 */ }
      if (!saved) this._results[this._results.length - 1].warning = true;
    }).catch(err => {
      this._results.push({
        name: item.record.name + ' · ' + item.label,
        ok: false,
        reason: calendarUtil.friendlyError(err)
      });
    }).then(() => {
      if (this._unloaded) return;
      // 完成进度同步刷新后再继续下一条
      this.setData({ progressPct: Math.round((idx + 1) / list.length * 100) });
      if (this._cancelled) { this.finishImport(true); return; }

      // 安卓：借弹窗按钮点击获得新手势链，续写下一条（直接自动续写会被微信拒绝）
      if (IS_ANDROID && idx + 1 < list.length) {
        wx.showModal({
          title: '已写入 ' + (idx + 1) + ' / ' + list.length,
          content: '下一条：「' + list[idx + 1].record.name + ' · ' + list[idx + 1].label + ' · ' + list[idx + 1].dueDate + '」。安卓系统每次写入日历需点击确认。',
          confirmText: '继续写入',
          cancelText: '停止',
          success: r => {
            if (this._unloaded) return;
            if (this._cancelled) { this.finishImport(true); return; }
            if (r.confirm) {
              this.runStep(list, idx + 1, reminderDays);
            } else {
              this._cancelled = true;
              this.finishImport(true);
            }
          },
          fail: () => { this._cancelled = true; this.finishImport(true); }
        });
        return;
      }

      // iOS / 开发者工具：间隔后自动串行下一条，给系统日历留出落盘时间
      this._stepTimer = setTimeout(() => {
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
    if (this._unloaded) return;
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
      markerWarning: results.some(r => r.warning),
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
