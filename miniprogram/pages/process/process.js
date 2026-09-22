const app = getApp();
const processing = require('../../utils/processing');
const record = require('../../utils/record');
const date = require('../../utils/date');

Page({
  data: { dark: app.isDark(), themeReady: false, contentReady: false, source: '', id: '', item: null,
    options: [], kind: '', nextDate: '', needsNext: false, resultText: '', saving: false, error: '', loadError: false },
  onLoad(query) {
    this.setData({ dark: app.isDark(), themeReady: true, source: query.source, id: query.id });
    this._untheme = app.onTheme(dark => this.setData({ dark }));
    this.refresh();
  },
  onShow() { app.syncPageChrome(this); },
  onUnload() { this._unloaded = true; if (this._untheme) this._untheme(); },
  refresh() {
    try {
      const item = processing.get(this.data.source, this.data.id);
      const options = processing.options(item, this.data.source);
      this._expected = item ? processing.revision(item, this.data.source) : '';
      this._today = date.todayStr();
      this.setData({ item, options, kind: options.length ? options[0].key : '',
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
