const app = getApp();
const processing = require('../../utils/processing');
const record = require('../../utils/record');
const date = require('../../utils/date');

Page({
  data: { dark: app.isDark(), themeReady: false, contentReady: false, source: '', id: '', item: null,
    options: [], kind: '', nextDate: '', needsNext: false, resultText: '', saving: false, error: '', loadError: false,
    unavailableText: '该记录已处理、已归档或不存在。' },
  onLoad(query) {
    this._targetKind = query.kind || '';
    this._targetDueDate = query.dueDate || '';
    this.setData({ dark: app.isDark(), themeReady: true, source: query.source, id: query.id });
    this._untheme = app.onTheme(dark => this.setData({ dark }));
    this.refresh();
  },
  onShow() { app.syncPageChrome(this); },
  onUnload() { this._unloaded = true; if (this._untheme) this._untheme(); },
  refresh() {
    try {
      const item = processing.get(this.data.source, this.data.id);
      let options = processing.options(item, this.data.source);
      if (this._targetKind) {
        // 从某条提醒进入时只处理该类别；提醒失效不能退回“已用完”等另一种操作。
        const kinds = this._targetKind === 'due' ? ['consumed', 'discarded'] : [this._targetKind];
        options = options.filter(option => kinds.indexOf(option.key) > -1);
        let dueDate = '';
        if (item) {
          if (this._targetKind === 'household' && this.data.source === 'household') dueDate = item.dueDate;
          if (this.data.source === 'record') {
            if (this._targetKind === 'due') dueDate = record.computeStatus(item, 7).dueDate;
            if (this._targetKind === 'warranty') dueDate = record.getWarrantyStatus(item).endDate;
            if (this._targetKind === 'maintenance') dueDate = record.getMaintenanceInfo(item).nextDate;
          }
        }
        if (!dueDate || (this._targetDueDate && dueDate !== this._targetDueDate)) options = [];
      }
      this._expected = item ? processing.revision(item, this.data.source) : '';
      this._today = date.todayStr();
      this.setData({ item, options, kind: options.length ? options[0].key : '',
        unavailableText: this._targetKind === 'maintenance' && item && item.maintenanceLast === this._today
          ? '今天已记录维护，下次维护请到时再处理。'
          : this._targetKind ? '这条提醒已变化或当前不可处理，请返回看板查看最新安排。' : '该记录已处理、已归档或不存在。',
        title: item ? item.title || item.name : '', nextDate: item && this.data.source === 'household' ? processing.followingDate(item) : '',
        contentReady: true, loadError: false, error: '' });
      this.describeResult();
    } catch (e) { this.setData({ contentReady: true, loadError: true }); }
  },
  onKind(e) {
    if (this.data.saving) return;
    const kind = e.currentTarget.dataset.kind;
    if (!this.data.options.some(o => o.key === kind)) return;
    this.setData({ kind, error: '' }); this.describeResult();
  },
  onDate(e) { if (!this.data.saving) { this.setData({ nextDate: e.detail.value, error: '' }); this.describeResult(); } },
  describeResult() {
    const { item, kind, nextDate } = this.data;
    if (!item || !kind) return;
    const needsNext = kind === 'household' && item.repeatRule !== 'none';
    let resultText = '整条记录将移入归档，不再出现在待处理看板和日历候选中。';
    if (needsNext) resultText = '本次处理存入归档，下一期安排在 ' + nextDate + '。不会自动跳过遗漏的期次。';
    if (kind === 'warranty') resultText = '本次保修提醒移入归档，物品及其保质期、维保信息继续保留。';
    if (kind === 'maintenance') resultText = '记录今天完成维护，下次维护为 ' + record.getMaintenanceInfo(Object.assign({}, item, { maintenanceLast: date.todayStr() })).nextDate + '。物品继续保留。';
    this.setData({ needsNext, resultText });
  },
  onSave() {
    if (this._unloaded || this.data.saving || this.data.loadError || !this.data.kind) return;
    if (date.todayStr() !== this._today) { this.refresh(); this.setData({ error: '日期已变化，请重新确认处理信息。' }); return; }
    if (this.data.needsNext && (!date.parseDate(this.data.nextDate) || this.data.nextDate <= this.data.item.dueDate)) {
      this.setData({ error: '下一期日期需晚于本期日期。' }); return;
    }
    this.setData({ saving: true, error: '' });
    try {
      if (!processing.complete(this.data.source, this.data.id, this._expected, this.data.kind, this.data.nextDate)) throw new Error('保存失败，请重试');
      wx.showToast({ title: '已记录处理结果', icon: 'success' });
      wx.navigateBack();
    } catch (e) { this.setData({ saving: false, error: e.message || '保存失败，请重试' }); }
  },
  goArchive() { wx.navigateTo({ url: '/pages/archive/archive' }); }
});
