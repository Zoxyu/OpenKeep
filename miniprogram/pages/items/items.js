/**
 * 物品页 · 全部记录
 * 搜索（名称 / 分类 / 备注模糊匹配）+ 分类筛选 + 状态筛选 + 三种排序，可叠加。
 * 包含加载骨架、空状态、无搜索结果状态。
 */
const app = getApp();
const storage = require('../../utils/storage');
const recordUtil = require('../../utils/record');
const imageUtil = require('../../utils/image');

Page({
  data: {
    dark: false,
    loading: true,
    keyword: '',
    category: 'all',
    status: 'all',
    sort: 'due',
    categoryOptions: [],
    statusOptions: [
      { key: 'all', label: '全部状态' },
      { key: 'expired', label: '已过期' },
      { key: 'warning', label: '临期' },
      { key: 'safe', label: '安全' }
    ],
    sortOptions: [
      { key: 'due', label: '到期最早' },
      { key: 'recent', label: '最近添加' },
      { key: 'name', label: '名称' }
    ],
    allItems: [],
    list: [],
    hasAny: false,
    filtered: false
  },

  onLoad() {
    const cats = [{ key: 'all', label: '全部分类' }];
    Object.keys(recordUtil.CATEGORIES).forEach(k => {
      cats.push({ key: k, label: recordUtil.CATEGORIES[k].label });
    });
    this.setData({ categoryOptions: cats });
    this._untheme = app.onTheme(dark => this.setData({ dark }));
  },

  onShow() {
    this.setData({ dark: app.isDark() });
    app.applyChrome();
    this.syncTabBar(1);
    this.load();
  },

  // 同步自定义 tabBar 选中态
  syncTabBar(index) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: index });
    }
  },

  onUnload() {
    if (this._untheme) this._untheme();
    if (this._loadTimer) clearTimeout(this._loadTimer);
  },

  // 从本地缓存加载并计算状态（骨架屏短暂展示加载态）
  load() {
    this.setData({ loading: true });
    this._loadTimer = setTimeout(() => {
      const settings = app.globalData.settings || storage.loadSettings();
      const items = recordUtil.withStatus(storage.loadRecords(), settings.warningDays);
      items.forEach(it => {
        it.photoOk = !!it.photoPath && imageUtil.isPhotoValid(it.photoPath);
      });
      this.setData({
        allItems: items,
        hasAny: items.length > 0,
        loading: false
      });
      this.applyView();
    }, 160);
  },

  // 叠加应用搜索、分类、状态筛选与排序
  applyView() {
    const { keyword, category, status, sort, allItems } = this.data;
    const kw = keyword.trim().toLowerCase();

    let list = allItems.filter(it => {
      if (category !== 'all' && it.category !== category) return false;
      if (status !== 'all' && it.status.level !== status) return false;
      if (kw) {
        const hay = (it.name + ' ' + it.categoryLabel + ' ' + (it.notes || '')).toLowerCase();
        if (hay.indexOf(kw) === -1) return false;
      }
      return true;
    });

    if (sort === 'due') {
      list.sort((a, b) => a.status.dueTs - b.status.dueTs);
    } else if (sort === 'recent') {
      list.sort((a, b) => b.createdAt - a.createdAt);
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    }

    this.setData({
      list,
      filtered: !!kw || category !== 'all' || status !== 'all'
    });
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
    this.applyView();
  },

  onKeywordClear() {
    this.setData({ keyword: '' });
    this.applyView();
  },

  onCategoryTap(e) {
    this.setData({ category: e.currentTarget.dataset.key });
    this.applyView();
  },

  onStatusTap(e) {
    this.setData({ status: e.currentTarget.dataset.key });
    this.applyView();
  },

  onSortTap(e) {
    this.setData({ sort: e.currentTarget.dataset.key });
    this.applyView();
  },

  onCardTap(e) {
    wx.navigateTo({ url: '/pages/item-detail/item-detail?id=' + e.detail.id });
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/item-form/item-form' });
  }
});
