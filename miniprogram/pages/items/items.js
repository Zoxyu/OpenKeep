/**
 * 物品页 · 全部记录
 * 搜索（名称 / 分类 / 备注模糊匹配）+ 分类筛选 + 状态筛选 + 三种排序，可叠加。
 * 包含下拉刷新、空状态、无搜索结果状态。
 */
const app = getApp();
const themeTrace = require('../../utils/theme-trace');
const storage = require('../../utils/storage');
const recordUtil = require('../../utils/record');
const imageUtil = require('../../utils/image');

Page({
  data: {
    // 模块加载时（≈小程序启动时）的主题快照：只在「启动后没改过主题」时恰好正确，
    // 能让绝大多数首次进入直接首帧正确、无需任何纠正。
    // 它不是保证 —— 用户改过主题后这个值就偏旧，真正的初始化由下面 onLoad 的通道 A 负责。
    dark: app.isDark(),
    // themeReady 门控：onLoad 的通道 A setData 就绪前，wxml 根节点 wx:if 挡住整个 .page-root，
    // 确保改主题后首次进入本页时旧主题内容绝不进入视觉（门控期间仅显示 page 元素背景色）。
    themeReady: false,
    // contentReady：守卫空状态 UI，避免中间帧闪「暂无物品」。
    // 不变量：必须与它所守卫的列表数据在同一次 setData 里原子翻转——本页由 onShow 的 load()
    // 与 allItems/hasAny/list 同批置真，绝不在 onLoad 提前置真。
    contentReady: false,
    // scroll-view 下拉刷新指示器状态（页面已 disableScroll，故用 refresher 而非页面级下拉）。
    // 同样遵守原子翻转：由 load() 与内容同批翻回 false，异常路径也翻，指示器不会卡住不收。
    refreshing: false,
    // 自定义下拉刷新区域文案（refresher-default-style="none" + slot="refresher"）
    refresherText: '下拉刷新',
    keyword: '',
    category: 'all',
    status: 'all',
    sort: 'due',
    categoryOptions: [],
    statusOptions: [
      { key: 'all', label: '全部' },
      { key: 'expired', label: '已过期' },
      { key: 'warning', label: '临期' },
      { key: 'safe', label: '安全' },
      { key: 'warranty', label: '保修' },
      { key: 'memo', label: '备忘' }
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
    themeTrace.attach(this, 'items');
    // 开门 setData：onLoad 第一条 setData、无条件执行（其前只允许纯非抛异常计算）。themeReady 尽早翻起缩短系统色空帧；
    // categoryOptions 由 Object.keys(...).map 纯计算（不读存储、不抛异常），一并写入
    // 使门开瞬间筛选面板即完整；contentReady 交由 onShow load() 与列表数据原子置真。
    const cats = [{ key: 'all', label: '全部' }];
    Object.keys(recordUtil.CATEGORIES).forEach(k => {
      cats.push({ key: k, label: recordUtil.CATEGORIES[k].label });
    });
    this.setData({ dark: app.isDark(), themeReady: true, categoryOptions: cats });
    app.syncPageChrome(this);

    // 通道 B · 运行时主题变化：只负责已存在实例的后续变化；同值不 setData（不碰 themeReady/contentReady）
    this._untheme = app.onTheme(dark => {
      if (this.data.dark !== dark) this.setData({ dark });
    });
  },

  // ====== 分享：发送给朋友 / 分享到朋友圈（数据纯本地，落地页不携带记录 id，见 dashboard 同段注释）======
  onShareAppMessage() {
    return { title: '到期那天：全部物品与保修、维护，一个页面看清', path: '/pages/items/items' };
  },
  onShareTimeline() {
    return { title: '到期那天：全部物品与保修、维护，一个页面看清' };
  },

  onShow() {
    themeTrace.lifecycle(this, 'show');
    // onShow 只管原生 chrome（每页一份的标题栏 / 窗口背景），不再负责 DOM 主题纠正
    app.syncPageChrome(this);
    this.syncTabBar(1);
    this.load();
  },

  // 同步自定义 tabBar 选中态
  syncTabBar(index) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setActive(index);
    }
  },

  onHide() { themeTrace.lifecycle(this, 'hide'); },

  onUnload() {
    themeTrace.lifecycle(this, 'detach');
    if (this._untheme) this._untheme();
  },

  // 从本地缓存加载并计算状态。
  // 本地读取是同步的，此前却先 setData({loading:true}) 再 setTimeout 160ms 才写真实数据，
  // 等于每次切到本页都人为制造一趟「骨架屏 → 内容」的二次刷新。现改为同步计算，
  // 并与 buildView 的结果合并成一次 setData（不再「先写 allItems、再写 list」两趟渲染）。
  load() {
    // try/catch 兜底：本函数承载 contentReady:true，若计算意外抛异常则 contentReady 永不置真、
    // 列表整块缺失且不自愈；catch 里置 contentReady 保证门开后可自愈。
    // refreshing 也在这里一并翻回 false（成功与异常两条路径都要），与内容同批原子翻转，
    // 避免下拉指示器因异常而卡住不收。
    try {
      const settings = app.globalData.settings || storage.loadSettings();
      const allItems = recordUtil.withStatus(storage.loadRecords(), settings.warningDays);
      allItems.forEach(it => {
        it.photoOk = !!it.photoPath && imageUtil.isPhotoValid(it.photoPath);
      });
      this.setData(Object.assign(
        { allItems: allItems, hasAny: allItems.length > 0, contentReady: true, refreshing: false, refresherText: '下拉刷新' },
        this.buildView(allItems)
      ));
    } catch (e) {
      console.error('[items] load failed', e);
      this.setData({ contentReady: true, refreshing: false, refresherText: '下拉刷新' });
    }
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

  // 下拉刷新（scroll-view refresher）：仅重读本地缓存并按「今天」重算红黄绿状态，不发任何网络请求。
  // 日常路径（增删改后返回、切 Tab、改临期阈值）onShow 的 load() 已全覆盖，此处内容通常不变；
  // 真实收益是「小程序长时间停在前台跨过零点」——这种场景不会触发 onShow，列表里的到期状态
  // 仍是昨天的，用户可手动重算自救（与首页下拉刷新同一性质）。
  // 只发两次 setData：先起指示器，再由 load() 与内容同批收回。
  onScrollRefresh() {
    this.setData({ refreshing: true, refresherText: '正在刷新…' });
    this.load();
    wx.showToast({ title: '已刷新本地状态', icon: 'none' });
  },

  // 自定义下拉刷新文案（slot="refresher"）：下拉达阈值（45px）提示「松开立即刷新」
  onRefresherPulling(e) {
    const dy = (e && e.detail && Math.abs(e.detail.dy)) || 0;
    const t = dy >= 45 ? '松开立即刷新' : '下拉刷新';
    if (this.data.refresherText !== t) this.setData({ refresherText: t });
  },
  // 复位（刷新完成收起后）/ 中止（未达阈值松手）：文案回到初始
  onRefresherRestore() {
    if (this.data.refresherText !== '下拉刷新') this.setData({ refresherText: '下拉刷新' });
  },
  onRefresherAbort() {
    if (this.data.refresherText !== '下拉刷新') this.setData({ refresherText: '下拉刷新' });
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
