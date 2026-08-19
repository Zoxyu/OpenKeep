/**
 * 新增 / 编辑物品页
 * - 封面照片：拍照或相册选择，保存时复制到 USER_DATA_PATH 持久化
 * - 「已开封 X 天」快捷输入自动反推开封日期（仍需填写可保存天数）
 * - 保存前逐字段校验，错误信息显示在字段附近
 * - 编辑模式支持替换 / 移除照片与删除记录（删除同步清理本地照片文件）
 */
const app = getApp();
const storage = require('../../utils/storage');
const recordUtil = require('../../utils/record');
const imageUtil = require('../../utils/image');
const dateUtil = require('../../utils/date');

Page({
  data: {
    dark: false,
    isEdit: false,
    id: '',
    origin: null,             // 编辑模式下的原始记录
    photoPath: '',            // 已持久化的照片（编辑模式沿用旧照片时）
    tempPhoto: '',            // 本次新选择、尚未持久化的照片
    name: '',
    category: 'fridge',
    categoryOptions: [],
    openedAt: '',
    shelfLifeDays: '',
    openedDaysInput: '',      // 「已开封 X 天」快捷输入
    quickHint: '',
    quickOk: false,           // 快捷输入是否推算成功（控制提示文案颜色）
    notes: '',
    errors: {},
    saving: false
  },

  onLoad(options) {
    const cats = Object.keys(recordUtil.CATEGORIES).map(k => recordUtil.CATEGORIES[k]);
    this.setData({ categoryOptions: cats, openedAt: dateUtil.todayStr() });
    this._untheme = app.onTheme(dark => this.setData({ dark }));

    if (options && options.id) {
      const r = storage.getRecord(options.id);
      if (r) {
        const openedDiff = dateUtil.diffDays(dateUtil.todayStart(), dateUtil.parseDate(r.openedAt));
        this.setData({
          isEdit: true,
          id: r.id,
          origin: r,
          name: r.name,
          category: r.category,
          photoPath: r.photoPath,
          openedAt: r.openedAt,
          shelfLifeDays: String(r.shelfLifeDays),
          notes: r.notes,
          openedDaysInput: openedDiff >= 0 ? String(openedDiff) : ''
        });
        wx.setNavigationBarTitle({ title: '编辑物品' });
      } else {
        wx.showToast({ title: '记录不存在', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 800);
      }
    }
  },

  onShow() {
    this.setData({ dark: app.isDark() });
  },

  onUnload() {
    if (this._untheme) this._untheme();
  },

  // ====== 照片 ======
  onPhotoTap() {
    const hasPhoto = !!(this.data.photoPath || this.data.tempPhoto);
    const items = ['拍照', '从相册选择'];
    if (hasPhoto) items.push('移除照片');
    wx.showActionSheet({
      itemList: items,
      success: res => {
        if (res.tapIndex === 0) this.choosePhoto('camera');
        else if (res.tapIndex === 1) this.choosePhoto('album');
        else if (res.tapIndex === 2) this.setData({ photoPath: '', tempPhoto: '' });
      }
    });
  },

  choosePhoto(source) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [source],
      sizeType: ['compressed'],
      success: res => {
        const tempFilePath = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
        if (tempFilePath) {
          const errors = Object.assign({}, this.data.errors);
          delete errors.photo;
          this.setData({ tempPhoto: tempFilePath, errors });
        }
      },
      fail: err => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') > -1) return; // 用户主动取消，不打扰
        if (msg.indexOf('auth') > -1 || msg.indexOf('authorize') > -1 || msg.indexOf('deny') > -1) {
          const name = source === 'camera' ? '相机' : '相册';
          wx.showModal({
            title: '无法访问' + name,
            content: '需要你在设置中允许访问' + name + '，才能添加封面照片。也可以跳过照片，直接手动录入。',
            confirmText: '去设置',
            cancelText: '知道了',
            success: r => { if (r.confirm) wx.openSetting(); }
          });
        } else {
          wx.showToast({ title: '选择图片失败', icon: 'none' });
        }
      }
    });
  },

  // ====== 表单输入 ======
  onNameInput(e) { this.setData({ name: e.detail.value }); },
  onShelfInput(e) { this.setData({ shelfLifeDays: e.detail.value }); },
  onNotesInput(e) { this.setData({ notes: e.detail.value }); },

  onCategoryTap(e) {
    this.setData({ category: e.currentTarget.dataset.key });
  },

  onDateChange(e) {
    this.setData({ openedAt: e.detail.value, quickHint: '', quickOk: false });
  },

  // 「已开封 X 天」快捷输入：自动反推开封日期。
  // 注意：仅凭已开封天数无法推算到期日，仍必须填写「开封后可保存天数」。
  onOpenedDaysInput(e) {
    const v = e.detail.value;
    const patch = { openedDaysInput: v, quickOk: false };
    const x = parseInt(v, 10);
    if (v === '') {
      patch.quickHint = '';
    } else if (isFinite(x) && x >= 0 && x <= 3650 && String(x) === v.trim()) {
      patch.openedAt = dateUtil.formatDate(dateUtil.addDays(dateUtil.todayStart(), -x));
      patch.quickHint = '已推算开封日期为 ' + patch.openedAt + '（仍可手动修改）';
      patch.quickOk = true;
    } else {
      patch.quickHint = '请输入 0 以上的整数天数';
    }
    this.setData(patch);
  },

  // ====== 校验 ======
  validate() {
    const errors = {};
    const name = this.data.name.trim();
    if (!name) errors.name = '请输入物品名称';
    else if (name.length > 30) errors.name = '名称最多 30 个字';

    const shelfRaw = String(this.data.shelfLifeDays).trim();
    const shelf = Number(shelfRaw);
    if (!shelfRaw) errors.shelfLifeDays = '请填写开封后可保存天数';
    else if (!isFinite(shelf) || Math.floor(shelf) !== shelf || shelf < 1 || shelf > 3650) {
      errors.shelfLifeDays = '请输入 1–3650 之间的整数天数';
    }

    if (!dateUtil.parseDate(this.data.openedAt)) errors.openedAt = '开封日期无效，请重新选择';
    if (this.data.notes.length > 100) errors.notes = '备注最多 100 个字';
    return errors;
  },

  // ====== 保存 ======
  onSave() {
    if (this.data.saving) return;
    const errors = this.validate();
    if (Object.keys(errors).length) {
      this.setData({ errors });
      wx.showToast({ title: '请先修正表单中的问题', icon: 'none' });
      return;
    }
    this.setData({ saving: true, errors: {} });

    const finish = photoPath => {
      const now = Date.now();
      const base = this.data.isEdit && this.data.origin
        ? Object.assign({}, this.data.origin)
        : {
          id: storage.genId(),
          createdAt: now,
          calendarImported: false,
          calendarImportedAt: null,
          calendarReminderDays: 1
        };
      base.name = this.data.name.trim();
      base.category = this.data.category;
      base.photoPath = photoPath || '';
      base.openedAt = this.data.openedAt;
      base.shelfLifeDays = parseInt(this.data.shelfLifeDays, 10);
      base.notes = this.data.notes.trim();
      base.updatedAt = now;

      storage.upsertRecord(base);
      wx.showToast({ title: this.data.isEdit ? '已保存修改' : '已添加物品', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    };

    if (this.data.tempPhoto) {
      // 新照片：持久化到 USER_DATA_PATH；替换时删除旧照片文件
      imageUtil.savePhoto(this.data.tempPhoto).then(saved => {
        if (this.data.isEdit && this.data.photoPath) {
          imageUtil.removePhoto(this.data.photoPath);
        }
        finish(saved);
      }).catch(() => {
        this.setData({ saving: false });
        wx.showModal({
          title: '照片保存失败',
          content: '封面照片未能保存到本地。你可以重试，或移除照片后保存。',
          showCancel: false
        });
      });
    } else {
      finish(this.data.photoPath);
    }
  },

  // ====== 删除（编辑模式，二次确认） ======
  onDelete() {
    wx.showModal({
      title: '删除物品',
      content: '删除后，这条记录与本地保存的照片都无法恢复。确定删除吗？',
      confirmText: '删除',
      confirmColor: '#C65B55',
      success: r => {
        if (!r.confirm) return;
        const rec = this.data.origin;
        storage.removeRecord(rec.id);
        if (rec.photoPath) imageUtil.removePhoto(rec.photoPath);
        wx.showToast({ title: '已删除', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 600);
      }
    });
  }
});
