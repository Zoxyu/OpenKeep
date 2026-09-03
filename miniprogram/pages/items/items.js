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
    // 创建时即取真实主题：首帧就是正确深浅色，不再靠 onLoad / onShow 的 setData 追平
    dark: app.isDark(),
    keyword: '',
    category: 'all',
    status: 'all',
    sort: 'due',
    categoryOptions: [],
    statusOptions: [
      { key: 'all', label: '全部' },
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
    // 筛选面板按组展示（分类/状态/排序），「全部」文案由组标签补充语义
    const cats = [{ key: 'all', label: '全部' }];
    Object.keys(recordUtil.CATEGORIES).forEach(k => {
      cats.push({ key: k, label: recordUtil.CATEGORIES[k].label });
    });
    this.setData({ categoryOptions: cats });
    // 只处理「主题真的发生变化」；同值不 setData
    this._untheme = app.onTheme(dark => {
      if (this.data.dark !== dark) this.setData({ dark });
    });
  },

  onShow() {
    // 主题：只在真的变化时才 setData / 刷新原生 chrome（见 app.syncPageTheme）
    app.syncPageTheme(this);
    this.syncTabBar(1);
    this.load();
  },

  // 同步自定义 tabBar 选中态
  syncTabBar(index) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setActive(index);
    }
  },

  onUnload() {
    if (this._untheme) this._untheme();
  },

  // 从本地缓存加载并计算状态。
  // 本地读取是同步的，此前却先 setData({loading:true}) 再 setTimeout 160ms 才写真实数据，
  // 等于每次切到本页都人为制造一趟「骨架屏 → 内容」的二次刷新。现改为同步计算，
  // 并与 buildView 的结果合并成一次 setData（不再「先写 allItems、再写 list」两趟渲染）。
  load() {
    const settings = app.globalData.settings || storage.loadSettings();
    const allItems = recordUtil.withStatus(storage.loadRecords(), settings.warningDays);
    allItems.forEach(it => {
      it.photoOk = !!it.photoPath && imageUtil.isPhotoValid(it.photoPath);
    });
    this.setData(Object.assign(
      { allItems: allItems, hasAny: allItems.length > 0 },
      this.buildView(allItems)
    ));
  },

  // 依据当前搜索 / 分类 / 状态 / 排序，从给定 items 算出可见列表（纯计算，不 setData）
  buildView(items) {
    const { keyword, category, status, sort } = this.data;
    const kw = keyword.trim().toLowerCase();

    const list = items.filter(it => {
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

    return { list: list, filtered: !!kw || category !== 'all' || status !== 'all' };
  },

  // 搜索 / 筛选 / 排序变化时只重算视图（数据未变，不必重读缓存）
  applyView() {
    this.setData(this.buildView(this.data.allItems));
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
