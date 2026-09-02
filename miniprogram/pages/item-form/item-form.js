/**
 * 新增 / 编辑物品页
 * - 封面照片：拍照或相册选择，保存时复制到 USER_DATA_PATH 持久化
 * - 「已开封 X 天」快捷输入自动反推开封日期
 * - 保质期（必填，可选天/个月/年）是到期日的主要依据；
 *   「开封后可保存天数」为可选修正项（填了则优先按它算到期），
 *   并按分类给出保守参考值；新增「存放位置」可选字段供日历提醒文案使用
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
    shelfLifeValue: '',       // 保质期数值（必填）
    shelfLifeUnit: 'day',     // 保质期单位：天 / 个月 / 年
    unitOptions: [
      { v: 'day', label: '天' },
      { v: 'month', label: '个月' },
      { v: 'year', label: '年' }
    ],
    openedDays: '',           // 开封后可保存天数（可选，填了优先按它算到期）
    refHint: '',              // 开封后可保存天数的分类参考值提示
    location: '',             // 存放位置（可选，用于日历提醒文案）
    purchaseDate: '',         // 购买日期（M1 可选，'YYYY-MM-DD' 或 ''）
    purchasePrice: '',        // 购买价格（M1 可选，表单内为字符串，保存交由 storage 规范化为 number|null）
    warrantyEnd: '',          // 保修结束日期（M1 可选，'YYYY-MM-DD' 或 ''）
    quickOpenedInput: '',     // 「已开封 X 天」快捷输入
    quickHint: '',
    quickOk: false,           // 快捷输入是否推算成功（控制提示文案颜色）
    notes: '',
    errors: {},
    saving: false
  },

  onLoad(options) {
    const cats = Object.keys(recordUtil.CATEGORIES).map(k => recordUtil.CATEGORIES[k]);
    this.setData({
      categoryOptions: cats,
      openedAt: dateUtil.todayStr(),
      refHint: this.buildRefHint('fridge')
    });
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
          shelfLifeValue: r.shelfLifeValue ? String(r.shelfLifeValue) : '',
          shelfLifeUnit: r.shelfLifeUnit || 'day',
          openedDays: r.openedDays > 0 ? String(r.openedDays) : '',
          location: r.location || '',
          purchaseDate: r.purchaseDate || '',
          purchasePrice: (r.purchasePrice === null || r.purchasePrice === undefined) ? '' : String(r.purchasePrice),
          warrantyEnd: r.warrantyEnd || '',
          notes: r.notes,
          refHint: this.buildRefHint(r.category),
          quickOpenedInput: openedDiff >= 0 ? String(openedDiff) : ''
        });
        wx.setNavigationBarTitle({ title: '编辑物品' });
      } else {
        wx.showToast({ title: '记录不存在', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 800);
      }
    }
  },

  // 按分类生成「开封后可保存天数」的保守参考提示（宁少勿多）
  buildRefHint(category) {
    const cat = recordUtil.categoryOf(category);
    return '参考：' + cat.label + '类开封后建议 ' + cat.refOpenedDays + ' 天内用完';
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
  onShelfValueInput(e) { this.setData({ shelfLifeValue: e.detail.value }); },
  onOpenedDaysInput(e) { this.setData({ openedDays: e.detail.value }); },
  onLocationInput(e) { this.setData({ location: e.detail.value }); },
  onNotesInput(e) { this.setData({ notes: e.detail.value }); },

  // ====== 购买 / 保修（M1 可选字段）======
  // 输入即清除对应字段错误，交互与既有字段一致
  onPurchaseDateChange(e) {
    const errors = Object.assign({}, this.data.errors); delete errors.purchaseDate;
    this.setData({ purchaseDate: e.detail.value, errors });
  },
  onPurchasePriceInput(e) {
    const errors = Object.assign({}, this.data.errors); delete errors.purchasePrice;
    this.setData({ purchasePrice: e.detail.value, errors });
  },
  onWarrantyEndChange(e) {
    const errors = Object.assign({}, this.data.errors); delete errors.warrantyEnd;
    this.setData({ warrantyEnd: e.detail.value, errors });
  },
  onClearPurchaseDate() { this.setData({ purchaseDate: '' }); },
  onClearWarrantyEnd() { this.setData({ warrantyEnd: '' }); },

  onUnitTap(e) {
    this.setData({ shelfLifeUnit: e.currentTarget.dataset.v });
  },

  onCategoryTap(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ category: key, refHint: this.buildRefHint(key) });
  },

  onDateChange(e) {
    this.setData({ openedAt: e.detail.value, quickHint: '', quickOk: false });
  },

  // 「已开封 X 天」快捷输入：自动反推开封日期。
  // 注意：仅凭已开封天数无法推算到期日，到期日由保质期或「开封后可保存天数」决定。
  onQuickOpenedInput(e) {
    const v = e.detail.value;
    const patch = { quickOpenedInput: v, quickOk: false };
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

    // 保质期：未填「开封后可保存天数」时必填；填了则为 1–3650 整数
    const shelfRaw = String(this.data.shelfLifeValue).trim();
    const openedRaw = String(this.data.openedDays).trim();
    if (shelfRaw) {
      const v = Number(shelfRaw);
      if (!isFinite(v) || Math.floor(v) !== v || v < 1 || v > 3650) {
        errors.shelfLifeValue = '请输入 1–3650 之间的整数';
      }
    } else if (!openedRaw) {
      errors.shelfLifeValue = '请填写保质期，或填写下方的开封后可保存天数';
    }

    // 开封后可保存天数：可选，填了则必须是 1–3650 整数
    if (openedRaw) {
      const v = Number(openedRaw);
      if (!isFinite(v) || Math.floor(v) !== v || v < 1 || v > 3650) {
        errors.openedDays = '请输入 1–3650 之间的整数天数';
      }
    }

    if (!dateUtil.parseDate(this.data.openedAt)) errors.openedAt = '开封日期无效，请重新选择';
    if (this.data.location.trim().length > 20) errors.location = '存放位置最多 20 个字';
    if (this.data.notes.length > 100) errors.notes = '备注最多 100 个字';

    // 购买 / 保修（M1 可选）：非空才校验；不强制、不做跨字段约束，避免录入压力
    if (this.data.purchaseDate && !dateUtil.parseDate(this.data.purchaseDate)) {
      errors.purchaseDate = '购买日期无效，请重新选择';
    }
    if (this.data.warrantyEnd && !dateUtil.parseDate(this.data.warrantyEnd)) {
      errors.warrantyEnd = '保修结束日期无效，请重新选择';
    }
    const priceRaw = String(this.data.purchasePrice).trim();
    if (priceRaw !== '') {
      const p = Number(priceRaw);
      if (!isFinite(p) || p < 0) errors.purchasePrice = '请输入有效的购买价格（不小于 0）';
    }
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
      base.shelfLifeValue = parseInt(this.data.shelfLifeValue, 10) || 0;
      base.shelfLifeUnit = this.data.shelfLifeUnit;
      base.openedDays = parseInt(this.data.openedDays, 10) || 0;
      base.location = this.data.location.trim();
      base.notes = this.data.notes.trim();
      // M1 可选字段：透传表单值，由 storage.normalizeRecord 统一规范化（页面不自行兜底）
      base.purchaseDate = this.data.purchaseDate;
      base.purchasePrice = this.data.purchasePrice;
      base.warrantyEnd = this.data.warrantyEnd;
      base.updatedAt = now;

      const ok = storage.upsertRecord(base);
      // 编辑模式下清理不再被引用的旧照片文件：统一覆盖「移除照片」「替换照片」「移除后重拍」，
      // 避免 USER_DATA_PATH 孤儿文件堆积；仅在记录已成功持久化、且旧照片与最终照片不同时删除。
      // 新增模式 origin 为 null，oldPhoto 为空，不会误删。
      const oldPhoto = this.data.origin ? this.data.origin.photoPath : '';
      if (ok && oldPhoto && oldPhoto !== base.photoPath) {
        imageUtil.removePhoto(oldPhoto);
      }
      wx.showToast({ title: this.data.isEdit ? '已保存修改' : '已添加物品', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    };

    if (this.data.tempPhoto) {
      // 新照片：持久化到 USER_DATA_PATH；旧照片清理统一在 finish 中按 origin 比对处理
      imageUtil.savePhoto(this.data.tempPhoto).then(saved => {
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
