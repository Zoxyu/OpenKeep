const app = getApp();
const storage = require('../../utils/storage');
const date = require('../../utils/date');
const household = require('../../utils/household');
const repeat = require('../../utils/repeat');

Page({
  data: {
    dark: app.isDark(), themeReady: false, contentReady: false,
    id: '', isEdit: false, missing: false, loadError: false, saving: false,
    title: '', type: 'bill', dueDate: '', repeatRule: 'none', notes: '',
    typeOptions: Object.keys(household.TYPES).map(key => ({ key, label: household.TYPES[key].label })),
    repeatOptions: Object.keys(repeat.RULES).map(key => ({ key, label: repeat.RULES[key] })),
    example: household.TYPES.bill.example, followingDate: '', errors: {},
    kbHeight: 0, scrollIntoId: ''
  },
  onLoad(options) {
    const id = options && options.id || '';
    this.setData({ dark: app.isDark(), themeReady: true, id, isEdit: !!id });
    this._untheme = app.onTheme(dark => { if (dark !== this.data.dark) this.setData({ dark }); });
    this._onKeyboard = res => this.setData({ kbHeight: res.height || 0 });
    wx.onKeyboardHeightChange(this._onKeyboard);
    wx.setNavigationBarTitle({ title: id ? '编辑事项' : '新增事项' });
    this.loadForm();
  },
  onShow() { app.syncPageChrome(this); },
  onUnload() {
    this._unloaded = true;
    if (this._untheme) this._untheme();
    if (this._onKeyboard) wx.offKeyboardHeightChange(this._onKeyboard);
    if (this._blurTimer) clearTimeout(this._blurTimer);
    if (this._saveTimer) clearTimeout(this._saveTimer);
  },
  loadForm() {
    if (!this.data.isEdit) {
      this.setData({ dueDate: date.todayStr(), contentReady: true });
      return;
    }
    try {
      const item = storage.getHousehold(this.data.id);
      if (!item) { this.setData({ missing: true, loadError: false, contentReady: true }); return; }
      this._loadedHistory = JSON.stringify(item.processingHistory);
      this._schedule = item;
      this.setData({
        title: item.title, type: item.type, dueDate: item.dueDate,
        repeatRule: item.repeatRule, notes: item.notes,
        example: household.TYPES[item.type].example,
        followingDate: repeat.followingDate(item),
        contentReady: true, loadError: false, missing: false
      });
    } catch (e) { this.setData({ loadError: true, contentReady: true }); }
  },
  onInput(e) {
    if (this.data.saving) return;
    const field = e.currentTarget.dataset.field;
    if (['title', 'notes'].indexOf(field) < 0) return;
    const errors = Object.assign({}, this.data.errors);
    delete errors[field];
    this.setData({ [field]: e.detail.value, errors });
  },
  onTypeTap(e) {
    if (this.data.saving) return;
    const type = e.currentTarget.dataset.key;
    if (!Object.prototype.hasOwnProperty.call(household.TYPES, type)) return;
    this.setData({ type, example: household.TYPES[type].example });
  },
  followingDate(dueDate, repeatRule) {
    const item = this._schedule;
    return item && item.dueDate === dueDate && item.repeatRule === repeatRule
      ? repeat.followingDate(item) : repeat.occurrenceDate(dueDate, repeatRule, 1);
  },
  onDateChange(e) {
    if (this.data.saving) return;
    const dueDate = e.detail.value;
    const errors = Object.assign({}, this.data.errors); delete errors.dueDate;
    this.setData({ dueDate, errors, followingDate: this.followingDate(dueDate, this.data.repeatRule) });
  },
  onRepeatTap(e) {
    if (this.data.saving) return;
    const rule = e.currentTarget.dataset.key;
    if (!Object.prototype.hasOwnProperty.call(repeat.RULES, rule)) return;
    this.setData({ repeatRule: rule, followingDate: this.followingDate(this.data.dueDate, rule) });
  },
  onFieldFocus(e) {
    if (this._blurTimer) clearTimeout(this._blurTimer);
    this.setData({ scrollIntoId: e.currentTarget.dataset.target, kbHeight: e.detail.height || this.data.kbHeight });
  },
  onFieldBlur() {
    if (this._blurTimer) clearTimeout(this._blurTimer);
    this._blurTimer = setTimeout(() => this.setData({ kbHeight: 0, scrollIntoId: '' }), 120);
  },
  onSave() {
    if (this._unloaded || this.data.saving || this.data.missing || this.data.loadError) return;
    const errors = household.validate(this.data);
    if (Object.keys(errors).length) {
      const first = Object.keys(errors)[0];
      this.setData({ errors, scrollIntoId: '' }, () => this.setData({ scrollIntoId: 'hh-' + first }));
      wx.showToast({ title: '请先修正表单中的问题', icon: 'none' });
      return;
    }
    this.setData({ saving: true, errors: {} });
    try {
      const original = this.data.isEdit ? storage.getHousehold(this.data.id) : null;
      if (this.data.isEdit && (!original || original.archived)) {
        this.setData({ saving: false, missing: true });
        return;
      }
      if (original && JSON.stringify(original.processingHistory) !== this._loadedHistory) throw new Error('事项已被处理，请返回重试');
      const now = Date.now();
      const item = Object.assign({}, original || { id: storage.genId(), createdAt: now }, {
        title: this.data.title.trim(), type: this.data.type,
        dueDate: this.data.dueDate, repeatRule: this.data.repeatRule,
        notes: this.data.notes.trim(), updatedAt: now
      });
      if (!original || original.dueDate !== item.dueDate || original.repeatRule !== item.repeatRule) {
        item.repeatAnchor = item.dueDate; item.repeatIndex = 0;
      }
      if (!storage.upsertHousehold(item, this.data.isEdit)) throw new Error('save failed');
      wx.showToast({ title: this.data.isEdit ? '已保存修改' : '已添加事项', icon: 'success' });
      this._saveTimer = setTimeout(() => { if (!this._unloaded) wx.navigateBack(); }, 600);
    } catch (e) {
      this.setData({ saving: false });
      wx.showModal({ title: '保存失败', content: '填写内容仍保留在当前页面，请重试。', showCancel: false });
    }
  },
  goBack() { wx.navigateBack(); }
});
