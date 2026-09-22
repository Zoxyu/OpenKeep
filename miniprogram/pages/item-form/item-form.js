/**
 * 新增 / 编辑物品页
 * - 封面照片：拍照或相册选择，保存时复制到 USER_DATA_PATH 持久化
 * - 「已使用 X 天」快捷输入自动反推开始使用日期
 * - 保质期 / 保修 / 维保三栏至少填一类，存放位置是通用可选信息
 * - 切栏只切换展示，保留所有字段；旧版纯位置备忘可继续编辑保存
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
    // 模块加载时（≈小程序启动时）的主题快照：只在「启动后没改过主题」时恰好正确。
    // 本页每次 navigateTo 都新建实例，用户改过主题后该值会偏旧，
    // 真正的初始化由下面 onLoad 的通道 A 负责。
    dark: app.isDark(),
    // themeReady 门控：onLoad 的通道 A setData 就绪前，wxml 根节点 wx:if 挡住整个 .page-root，
    // 确保改主题后首次进入本页时旧主题内容绝不进入视觉（门控期间仅显示 page 元素背景色）。
    themeReady: false,
    isEdit: false,
    id: '',
    origin: null,             // 编辑模式下的原始记录
    entryTab: 'shelf',        // 仅控制表单展示，不写入物品记录
    legacyMemo: false,        // 旧版仅位置备忘的编辑兼容提示
    photoPath: '',            // 已持久化的照片（编辑模式沿用旧照片时）
    tempPhoto: '',            // 本次新选择、尚未持久化的照片
    name: '',
    category: 'fridge',
    categoryOptions: [],
    openedAt: '',
    shelfLifeValue: '',       // 保质期数值（三类信息至少填一类）
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
    maintenanceLast: '',      // 上次维护日期（M1 第二批次可选，'YYYY-MM-DD' 或 ''）
    maintenanceCycle: 'none', // 维护周期：不设/每月/每年/自定义天数
    maintenanceCycleDays: '', // 自定义周期天数（表单内字符串，保存交由 storage 规范化）
    cycleOptions: [
      { v: 'none', label: '不设' },
      { v: 'monthly', label: '每月' },
      { v: 'yearly', label: '每年' },
      { v: 'custom', label: '自定义' }
    ],
    quickOpenedInput: '',     // 「已开封 X 天」快捷输入
    quickHint: '',
    quickOk: false,           // 快捷输入是否推算成功（控制提示文案颜色）
    notes: '',
    errors: {},
    saving: false,
    // 键盘避让（本项目 disableScroll + scroll-view(100vh)，微信 adjust-position 整页上推会与
    // scroll-view 冲突导致安卓输入框漂移/文字错位）：input 全部关闭 adjust-position，改由本页
    // 监听键盘高度动态收缩 scroll-view 可视区（kbHeight）+ scroll-into-view 滚到聚焦字段（scrollIntoId）。
    kbHeight: 0,
    scrollIntoId: ''
  },

  onLoad(options) {
    // 开门 setData：onLoad 第一条 setData、无条件执行（其前只允许纯非抛异常计算）。themeReady 尽早翻起
    // 缩短系统色空帧；categoryOptions（Object.keys.map）为纯计算，一并写入使门开瞬间分类格即完整。
    // 按编辑意图分支：编辑模式下 openedAt/refHint 留空、isEdit 置真，避免门开帧先呈现「今日日期+冰箱提示+
    // 『保存物品』+无删除按钮」的错误新建态；isEdit 驱动保存按钮文案与删除按钮显隐（见 wxml），故开门帧即正确。
    // 编辑真实值仍由开门之后的 storage.getRecord + 第二段 setData 填入（getRecord 勿前移，守白屏不变量）。
    // themeReady 写在读记录之前，永不被 storage.getRecord 抛异常阻断。本页无 contentReady 死字段。
    const cats = Object.keys(recordUtil.CATEGORIES).map(k => recordUtil.CATEGORIES[k]);
    const editIntent = !!(options && options.id);
    this.setData({
      dark: app.isDark(),
      themeReady: true,
      categoryOptions: cats,
      isEdit: editIntent,
      openedAt: editIntent ? '' : dateUtil.todayStr(),
      refHint: editIntent ? '' : this.buildRefHint('fridge')
    });

    // 通道 B · 运行时主题变化：只负责已存在实例的后续变化；同值不 setData（不碰 themeReady）
    this._untheme = app.onTheme(dark => {
      if (this.data.dark !== dark) this.setData({ dark });
    });

    // 键盘避让：监听键盘高度动态收缩 scroll-view 可视区（见 data.kbHeight 注释）。
    // onKeyboardHeightChange 主要负责「弹起时」高度（补充 focus 的 e.detail.height，应对切换输入法高度变化）；
    // 「收起时」归零不能只靠它——安卓数字键盘（type=digit/number）收起常不回调 height=0，
    // 会导致 scroll-view 卡在收缩高度、底部留白遮挡内容，故由 onFieldBlur 延迟兜底归零。onUnload 注销避免泄漏。
    this._onKbHeight = res => {
      const h = (res && res.height) || 0;
      if (this.data.kbHeight !== h) this.setData({ kbHeight: h });
    };
    wx.onKeyboardHeightChange(this._onKbHeight);

    // 编辑模式：开门之后再读记录（有风险的存储读取后移），第二次 setData 写入编辑字段。
    // 新建模式无需第二段：上方开门 setData 已含全部默认字段。
    if (options && options.id) {
      const r = storage.getRecord(options.id);
      if (r) {
        const openedDiff = dateUtil.diffDays(dateUtil.todayStart(), dateUtil.parseDate(r.openedAt));
        this.setData({
          isEdit: true,
          id: r.id,
          origin: r,
          entryTab: r.shelfLifeValue > 0 || r.openedDays > 0 ? 'shelf'
            : (r.warrantyEnd ? 'warranty' : (recordUtil.getMaintenanceInfo(r).active ? 'maintenance' : 'shelf')),
          legacyMemo: !r.shelfLifeValue && !r.openedDays && !r.warrantyEnd &&
            !recordUtil.getMaintenanceInfo(r).active && !!r.location,
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
          maintenanceLast: r.maintenanceLast || '',
          maintenanceCycle: r.maintenanceCycle || 'none',
          maintenanceCycleDays: r.maintenanceCycleDays > 0 ? String(r.maintenanceCycleDays) : '',
          notes: r.notes,
          refHint: this.buildRefHint(r.category),
          quickOpenedInput: openedDiff >= 0 ? String(openedDiff) : ''
        });
        wx.setNavigationBarTitle({ title: '编辑物品' });
        return;
      }
      // 记录不存在：提示并返回（原有业务逻辑，非主题补救）；门开帧已是完整新建表单壳，800ms 内不白屏/破损
      wx.showToast({ title: '记录不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
    }
  },

  // 按分类生成「开封后可保存天数」的保守参考提示（宁少勿多）
  buildRefHint(category) {
    const cat = recordUtil.categoryOf(category);
    return '参考：' + cat.label + '类开始使用后建议 ' + cat.refOpenedDays + ' 天内用完';
  },

  onShow() {
    // onShow 只管原生 chrome（每页一份的标题栏 / 窗口背景），不再负责 DOM 主题纠正
    app.syncPageChrome(this);
  },

  onUnload() {
    this._unloaded = true;
    if (this._untheme) this._untheme();
    if (this._onKbHeight) wx.offKeyboardHeightChange(this._onKbHeight);
    if (this._blurTimer) clearTimeout(this._blurTimer);
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this.clearPendingPhoto();
  },

  // ====== 照片 ======
  // 仅清理本页复制、但尚未写入记录的照片，不触碰原记录引用的文件。
  clearPendingPhoto() {
    if (this._pendingPhoto) imageUtil.removePhoto(this._pendingPhoto);
    this._pendingPhoto = '';
  },

  onPhotoTap() {
    if (this.data.saving) return;
    const hasPhoto = !!(this.data.photoPath || this.data.tempPhoto);
    const items = ['拍照', '从相册选择'];
    if (hasPhoto) items.push('移除照片');
    wx.showActionSheet({
      itemList: items,
      success: res => {
        if (this._unloaded || this.data.saving) return;
        if (res.tapIndex === 0) this.choosePhoto('camera');
        else if (res.tapIndex === 1) this.choosePhoto('album');
        else if (res.tapIndex === 2) {
          this.clearPendingPhoto();
          this.setData({ photoPath: '', tempPhoto: '' });
        }
      }
    });
  },

  choosePhoto(source) {
    if (this.data.saving) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [source],
      sizeType: ['compressed'],
      success: res => {
        if (this._unloaded || this.data.saving) return;
        const tempFilePath = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
        if (tempFilePath) {
          this.clearPendingPhoto();
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

  // ====== 键盘避让：聚焦字段滚入可视区 + 收起后恢复满高 ======
  // input/textarea 已关闭 adjust-position（不整页上推），聚焦时把所在字段滚到 scroll-view 顶部；
  // 键盘弹起后 scroll-view 已按 kbHeight 收缩，顶部字段必在键盘上方、始终可见。
  onFieldFocus(e) {
    this._focusing = true;
    // 框间切换：旧框 blur 可能先于新框 focus 触发并挂了延迟归零，这里取消它，
    // 让 kbHeight 从旧值直接切到新值，避免 scroll-view 先弹回满高再收缩的抖动。
    if (this._blurTimer) { clearTimeout(this._blurTimer); this._blurTimer = null; }
    const id = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.target) || '';
    // e.detail.height 是键盘高度：聚焦即收缩，不完全依赖 onKeyboardHeightChange（安卓数字键盘可能不回调）
    const h = (e.detail && e.detail.height) || 0;
    const patch = {};
    if (id && this.data.scrollIntoId !== id) patch.scrollIntoId = id;
    if (h && this.data.kbHeight !== h) patch.kbHeight = h;
    if (Object.keys(patch).length) this.setData(patch);
  },
  // 失焦：延迟归零 kbHeight 并清空 scrollIntoId（清空使下次聚焦同一字段仍能触发滚动）。
  // 延迟 120ms 是为兼容框间切换的 blur/focus 顺序不定：若期间 focus 了新框，onFieldFocus 会取消归零；
  // 若确无新焦点（真正收起键盘），延迟后归零恢复满高，消除底部空白遮挡。
  // 关键：安卓数字键盘收起时 onKeyboardHeightChange 常不回调 height=0，必须靠本 blur 兜底。
  onFieldBlur() {
    this._focusing = false;
    if (this._blurTimer) clearTimeout(this._blurTimer);
    this._blurTimer = setTimeout(() => {
      this._blurTimer = null;
      if (!this._focusing && (this.data.scrollIntoId || this.data.kbHeight)) {
        this.setData({ scrollIntoId: '', kbHeight: 0 });
      }
    }, 120);
  },

  // ====== 表单输入 ======
  onEntryTabTap(e) {
    const tab = e.currentTarget.dataset.tab;
    if (this.data.saving || ['shelf', 'warranty', 'maintenance'].indexOf(tab) < 0 || tab === this.data.entryTab) return;
    // 切栏先结束输入，避免隐藏控件残留键盘高度；所有录入值留在 data 中。
    this._focusing = false;
    if (this._blurTimer) { clearTimeout(this._blurTimer); this._blurTimer = null; }
    if (wx.hideKeyboard) wx.hideKeyboard();
    this.setData({ entryTab: tab, kbHeight: 0, scrollIntoId: '' });
  },

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

  // ====== 维护周期（M1 第二批次可选字段）======
  onMaintenanceLastChange(e) {
    const errors = Object.assign({}, this.data.errors); delete errors.maintenanceLast;
    this.setData({ maintenanceLast: e.detail.value, errors });
  },
  onClearMaintenanceLast() { this.setData({ maintenanceLast: '' }); },
  onCycleTap(e) {
    const errors = Object.assign({}, this.data.errors);
    delete errors.maintenanceLast; delete errors.maintenanceCycle; delete errors.maintenanceCycleDays;
    this.setData({ maintenanceCycle: e.currentTarget.dataset.v, errors });
  },
  onMaintenanceDaysInput(e) {
    const errors = Object.assign({}, this.data.errors); delete errors.maintenanceCycleDays;
    this.setData({ maintenanceCycleDays: e.detail.value, errors });
  },

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
      patch.quickHint = '已推算开始使用日期为 ' + patch.openedAt + '（仍可手动修改）';
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

    // 新录入：保质期 / 保修 / 维保至少填一类，位置不再作为新记录的有效依据。
    const shelfRaw = String(this.data.shelfLifeValue).trim();
    const openedRaw = String(this.data.openedDays).trim();
    const hasShelf = !!shelfRaw || !!openedRaw;
    const hasWarranty = !!String(this.data.warrantyEnd).trim();
    const hasMaintenance = this.data.maintenanceCycle !== 'none';
    const origin = this.data.origin;
    const keepLegacyMemo = this.data.isEdit && origin && !origin.shelfLifeValue && !origin.openedDays &&
      !origin.warrantyEnd && !recordUtil.getMaintenanceInfo(origin).active &&
      !!origin.location && !!this.data.location.trim();
    if (shelfRaw) {
      const v = Number(shelfRaw);
      if (!isFinite(v) || Math.floor(v) !== v || v < 1 || v > 3650) {
        errors.shelfLifeValue = '请输入 1–3650 之间的整数';
      }
    }
    if (!hasShelf && !hasWarranty && !hasMaintenance && !keepLegacyMemo) {
      errors.recordType = '请至少填写保质期、保修结束日期或完整的维保信息';
    }

    // 开封后可保存天数：可选，填了则必须是 1–3650 整数
    if (openedRaw) {
      const v = Number(openedRaw);
      if (!isFinite(v) || Math.floor(v) !== v || v < 1 || v > 3650) {
        errors.openedDays = '请输入 1–3650 之间的整数天数';
      }
    }

    if (!dateUtil.parseDate(this.data.openedAt)) errors.openedAt = '开始使用日期无效，请重新选择';
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

    // 维保可独立作为录入依据；需合法日期和周期，自定义天数必须 1–3650 整数。
    if (this.data.maintenanceLast && !dateUtil.parseDate(this.data.maintenanceLast)) {
      errors.maintenanceLast = '上次维护日期无效，请重新选择';
    }
    if (hasMaintenance) {
      if (['monthly', 'yearly', 'custom'].indexOf(this.data.maintenanceCycle) < 0) errors.maintenanceCycle = '请选择有效的维护周期';
      if (!this.data.maintenanceLast) errors.maintenanceLast = '设置了维护周期，请选择上次维护日期';
      if (this.data.maintenanceCycle === 'custom') {
        const dRaw = String(this.data.maintenanceCycleDays).trim();
        const d = Number(dRaw);
        if (!dRaw || !isFinite(d) || Math.floor(d) !== d || d < 1 || d > 3650) {
          errors.maintenanceCycleDays = '请输入 1–3650 之间的整数';
        }
      }
    }
    return errors;
  },

  // 校验隐藏栏内的字段时，自动展开对应栏并定位，避免错误不可见。
  showValidationErrors(errors) {
    const targets = [
      ['name', '', 'f-name'], ['openedAt', 'shelf', 'f-start'],
      ['shelfLifeValue', 'shelf', 'f-shelf'], ['openedDays', 'shelf', 'f-opened'],
      ['warrantyEnd', 'warranty', 'f-warranty'], ['purchaseDate', 'warranty', 'f-purchase'],
      ['purchasePrice', 'warranty', 'f-price'], ['maintenanceLast', 'maintenance', 'f-mlast'],
      ['maintenanceCycle', 'maintenance', 'f-cycle'], ['maintenanceCycleDays', 'maintenance', 'f-mdays'],
      ['location', '', 'f-location'], ['notes', '', 'f-notes'], ['recordType', '', 'f-entry']
    ];
    const target = targets.find(t => errors[t[0]]);
    const patch = { errors: errors, scrollIntoId: '' };
    if (target && target[1]) patch.entryTab = target[1];
    this.setData(patch, () => {
      if (target) this.setData({ scrollIntoId: target[2] });
    });
  },

  // ====== 保存 ======
  onSave() {
    if (this._unloaded || this.data.saving) return;
    const errors = this.validate();
    if (Object.keys(errors).length) {
      this.showValidationErrors(errors);
      wx.showToast({ title: '请先修正表单中的问题', icon: 'none' });
      return;
    }
    this.setData({ saving: true, errors: {} });

    const finish = photoPath => {
      if (this.data.isEdit) {
        let latest;
        try { latest = storage.loadEntriesStrict('record').find(r => r.id === this.data.origin.id); } catch (e) { /* 读失败拒绝保存 */ }
        if (!latest || latest.archived || JSON.stringify(latest.processingHistory) !== JSON.stringify(this.data.origin.processingHistory)) {
          this.setData({ saving: false });
          wx.showModal({ title: '记录已变化', content: '记录已归档、被处理或暂时无法读取。请返回后重新打开，填写内容仍保留在当前页面。', showCancel: false });
          return;
        }
      }
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
      // 分类选择仅在保质期栏展示；新建纯保修/维保不沿用未选择的「冷藏」默认值。
      const hasShelf = !!String(this.data.shelfLifeValue).trim() || !!String(this.data.openedDays).trim();
      base.category = !this.data.isEdit && !hasShelf ? 'other' : this.data.category;
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
      // M1 第二批次：维护周期透传，由 storage.normalizeRecord 统一规范化
      base.maintenanceLast = this.data.maintenanceLast;
      base.maintenanceCycle = this.data.maintenanceCycle;
      base.maintenanceCycleDays = parseInt(this.data.maintenanceCycleDays, 10) || 0;
      base.updatedAt = now;

      let ok = false;
      try { ok = storage.upsertRecord(base); } catch (e) { /* 写入异常按保存失败处理 */ }
      if (!ok) {
        this.setData({ saving: false });
        wx.showModal({
          title: '保存失败',
          content: '未能保存到本地，填写内容仍保留在当前页面。请重试；若仍失败，请检查设备存储空间。',
          showCancel: false
        });
        return;
      }
      // 写入成功后，新照片归记录所有，退出页面时不再当作草稿清理。
      this._pendingPhoto = '';
      // 编辑模式下清理不再被引用的旧照片文件：统一覆盖「移除照片」「替换照片」「移除后重拍」，
      // 避免 USER_DATA_PATH 孤儿文件堆积；仅在记录已成功持久化、且旧照片与最终照片不同时删除。
      // 新增模式 origin 为 null，oldPhoto 为空，不会误删。
      const oldPhoto = this.data.origin ? this.data.origin.photoPath : '';
      if (oldPhoto && oldPhoto !== base.photoPath) {
        imageUtil.removePhoto(oldPhoto);
      }
      wx.showToast({ title: this.data.isEdit ? '已保存修改' : '已添加物品', icon: 'success' });
      this._saveTimer = setTimeout(() => { if (!this._unloaded) wx.navigateBack(); }, 600);
    };

    if (this.data.tempPhoto) {
      // 新照片：持久化到 USER_DATA_PATH；旧照片清理统一在 finish 中按 origin 比对处理
      return imageUtil.savePhoto(this.data.tempPhoto).then(saved => {
        // 复制期间用户离开，不再写入记录；清理本次刚复制的文件。
        if (this._unloaded) { imageUtil.removePhoto(saved); return; }
        this._pendingPhoto = saved;
        // 即使随后记录写入失败，也复用已复制的照片，重试不重复复制。
        this.setData({ photoPath: saved, tempPhoto: '' });
        finish(saved);
      }).catch(() => {
        if (this._unloaded) return;
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
    if (this.data.saving) return;
    wx.showModal({
      title: '删除物品',
      content: '删除后，这条记录、处理历史与本地保存的照片都无法恢复。确定删除吗？',
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
