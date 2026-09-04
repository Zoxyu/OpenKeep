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
    missing: false,
    reminderOptions: REMINDER_OPTIONS.map(r => r.label),
    reminderIndex: 1,
    calSupported: true,
    writing: false
  },

  onLoad(options) {
    // 通道 A · 首次主题初始化：并入本页原有的 onLoad setData，不额外增加渲染次数
    this.setData({
      dark: app.isDark(),
      themeReady: true,
      id: options.id || '',
      calSupported: calendarUtil.isSupported()
    });
    // 通道 B · 运行时主题变化：只负责已存在实例的后续变化；同值不 setData
    this._untheme = app.onTheme(dark => {
      if (this.data.dark !== dark) this.setData({ dark });
    });
  },

  onShow() {
    // onShow 只管原生 chrome（每页一份的标题栏 / 窗口背景），不再负责 DOM 主题纠正
    app.syncPageChrome(this);
    this.refresh();
  },

  onUnload() {
    if (this._untheme) this._untheme();
  },

  // 每次展示都重新读取并实时计算状态（编辑返回后数据保持最新）
  refresh() {
    const r = storage.getRecord(this.data.id);
    if (!r) {
      this.setData({ missing: true, record: null });
      return;
    }
    const settings = app.globalData.settings || storage.loadSettings();
    const status = recordUtil.computeStatus(r, settings.warningDays);
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
    let idx = 1;
    for (let i = 0; i < REMINDER_OPTIONS.length; i++) {
      if (REMINDER_OPTIONS[i].v === r.calendarReminderDays) { idx = i; break; }
    }
    this.setData({
      record: r,
      status,
      cat: recordUtil.categoryOf(r.category),
      shelfLifeText: recordUtil.shelfLifeText(r),
      priceText: priceText,
      warranty: warranty,
      warrantyLeftText: warrantyLeftText,
      photoOk: !!r.photoPath && imageUtil.isPhotoValid(r.photoPath),
      reminderIndex: idx
    });
  },

  onReminderChange(e) {
    this.setData({ reminderIndex: Number(e.detail.value) });
  },

  onEdit() {
    wx.navigateTo({ url: '/pages/item-form/item-form?id=' + this.data.id });
  },

  // 删除：二次确认 + 同步删除本地照片文件
  onDelete() {
    wx.showModal({
      title: '删除物品',
      content: '删除后，这条记录与本地保存的照片都无法恢复。确定删除吗？',
      confirmText: '删除',
      confirmColor: '#C65B55',
      success: r => {
        if (!r.confirm) return;
        const rec = this.data.record;
        storage.removeRecord(rec.id);
        if (rec.photoPath) imageUtil.removePhoto(rec.photoPath);
        wx.showToast({ title: '已删除', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 600);
      }
    });
  },

  // ====== 单条日历导入（仅用户主动点击触发） ======
  onAddCalendar() {
    if (this.data.writing || !this.data.record) return;

    // 低版本 / 不支持的设备：降级提示，不影响主功能
    if (!calendarUtil.isSupported()) {
      wx.showModal({
        title: '暂不支持写入日历',
        content: '当前微信版本或设备不支持添加系统日历事件。物品看板功能不受影响。',
        showCancel: false
      });
      return;
    }

    const doWrite = () => {
      calendarUtil.requestAuth().then(res => {
        if (!res.granted) return;
        if (!res.fresh) {
          // 之前已授权：直接写入
          this.writeCalendar();
          return;
        }
        // 首次授权：权限同步存在延迟，紧接着的写入可能被系统吞掉
        // （甚至误报成功），改为弹确认框由用户点击重新发起
        wx.showModal({
          title: '日历权限已开启',
          content: '请再次点击，添加这条到期提醒（到期日上午 9:00）。',
          confirmText: '添加提醒',
          cancelText: '取消',
          success: r => {
            if (r.confirm) this.writeCalendar();
          }
        });
      });
    };

    // 已导入过：重新导入前明确提示可能产生重复日程
    if (this.data.record.calendarImported) {
      wx.showModal({
        title: '重新添加',
        content: '这条记录已添加过提醒。再次添加会在系统日历中产生重复提醒，确定继续吗？',
        confirmText: '继续添加',
        cancelText: '取消',
        success: r => { if (r.confirm) doWrite(); }
      });
      return;
    }
    doWrite();
  },

  writeCalendar() {
    const { record, status, reminderIndex } = this.data;
    const reminderDays = REMINDER_OPTIONS[reminderIndex].v;
    const evt = calendarUtil.buildEvent(
      Object.assign({}, record, { categoryLabel: this.data.cat.label }),
      status,
      reminderDays
    );
    // 到期日期非法时 buildEvent 返回 null，提前拦截避免崩溃
    if (!evt) {
      wx.showToast({ title: '到期日期无效，无法创建日程', icon: 'none' });
      return;
    }
    this.setData({ writing: true });
    calendarUtil.addEvent(evt).then(() => {
      const updated = Object.assign({}, record, {
        calendarImported: true,
        calendarImportedAt: Date.now(),
        calendarReminderDays: reminderDays,
        updatedAt: Date.now()
      });
      storage.upsertRecord(updated);
      this.setData({ record: updated, writing: false });
      wx.showToast({ title: '已添加提醒', icon: 'success' });
    }).catch(err => {
      this.setData({ writing: false });
      wx.showModal({
        title: '写入失败',
        content: '日历事件未能写入：' + calendarUtil.friendlyError(err) + '。物品记录不受影响，可稍后重试。',
        showCancel: false
      });
    });
  },

  goBack() {
    wx.navigateBack();
  }
});
