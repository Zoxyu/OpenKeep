/**
 * 首页 · 看板
 * 打开即看：统一待处理提醒、三色统计、快捷筛选、物品卡片列表。
 * 状态每次 onShow 实时重算，绝不读取写死的旧状态；下拉刷新仅本地重算。
 */
const app = getApp();
const storage = require('../../utils/storage');
const recordUtil = require('../../utils/record');
const imageUtil = require('../../utils/image');
const dateUtil = require('../../utils/date');
const historyUtil = require('../../utils/history');
const summaryUtil = require('../../utils/summary');

Page({
  data: {
    // 模块加载时（≈小程序启动时）的主题快照：只在「启动后没改过主题」时恰好正确，
    // 能让绝大多数首次进入直接首帧正确、无需任何纠正。
    // 它不是保证 —— 用户改过主题后这个值就偏旧，真正的初始化由下面 onLoad 的通道 A 负责。
    dark: app.isDark(),
    // themeReady 门控：onLoad 的通道 A setData 就绪前，wxml 根节点 wx:if 挡住整个 .page-root，
    // 确保改主题后首次进入本页时旧主题内容绝不进入视觉（门控期间仅显示 page 元素背景色）。
    themeReady: false,
    // contentReady：守卫空状态 UI，避免中间帧闪「暂无数据 / 共 0 件」误导文案（见 wxml）。
    // 不变量：必须与它所守卫的列表数据在同一次 setData 里原子翻转——本页由 onShow 的 refresh()
    // 与 stats/list/hasRecords/total 同批置真，绝不在 onLoad 提前置真（否则守卫失效、仍闪空状态）。
    contentReady: false,
    showOnboarding: false,   // 首次启动：选择「体验示例数据 / 从空白开始」
    todayText: '',
    stats: { expired: 0, warning: 0, safe: 0 },
    hasRecords: false,
    householdOverview: { total: 0, overdue: 0, today: 0, upcoming: 0, items: [], preview: [] },
    householdError: false,
    recordError: false,
    reminders: summaryUtil.reminderOverview([], []),
    reminderGroup: '',
    reminderItems: [],
    reminderCount: 0,
    reminderExpanded: false,
    laterExpanded: false,
    filter: 'all',
    filterOptions: [],
    list: [],
    total: 0,
    // 「历史上的今天」首页预览（本地数据，不触发网络请求）
    historyPreview: null,
    // scroll-view 下拉刷新状态（页面已 disableScroll，改用 refresher）
    refreshing: false,
    // 自定义下拉刷新区域文案（refresher-default-style="none" + slot="refresher"）
    refresherText: '下拉刷新',
    // 关键词搜索（fab 旁圆形入口展开）：模糊匹配名称/分类/位置/备注
    keyword: '',
    searchOpen: false
  },

  onLoad() {
    // 开门 setData：onLoad 第一条 setData、无条件执行（其前只允许纯非抛异常计算）。themeReady 尽早翻起打开门控，缩短
    // 「手动锁定主题≠系统」时新建页首帧的系统色空帧；todayText（纯日期计算）与 historyPreview
    // （getLocalPreview 查已缓存模块、纯且廉价、内部 try/catch 保证不抛异常）一并写入，使门开瞬间即为完整正确主题的
    // 静态壳。二者均为纯计算，故置于 themeReady 同批不引入白屏风险；contentReady 交由 onShow
    // refresh() 与列表数据原子置真（本页 onLoad 无第二段，避免多一趟渲染）。
    const now = dateUtil.todayStart();
    const preview = historyUtil.getLocalPreview();
    this.setData({
      dark: app.isDark(),
      themeReady: true,
      todayText: (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 · ' + dateUtil.weekdayCN(now),
      historyPreview: {
        month: preview.month,
        day: preview.day,
        text: preview.first || preview.second || ''
      }
    });

    // 通道 B · 运行时主题变化：只负责已存在实例的后续变化；同值不 setData（不碰 themeReady/contentReady）
    this._untheme = app.onTheme(dark => {
      if (this.data.dark !== dark) this.setData({ dark });
    });
  },

  // ====== 分享：发送给朋友 / 分享到朋友圈（朋友圈需基础库 2.11.3+，项目最低 2.15.0 满足）======
  // 数据纯本地存储：朋友收到的是「产品名片」而非我的数据，故落地页不携带任何记录 id，
  // 避免朋友设备无对应记录时看到「记录不存在」；表单/设置页不开分享。
  onShareAppMessage() {
    return { title: '到期那天：全家物品的保质期看板，红黄绿一眼看清', path: '/pages/dashboard/dashboard' };
  },
  onShareTimeline() {
    return { title: '到期那天：全家物品的保质期看板，红黄绿一眼看清' };
  },

  onShow() {
    // onShow 只管原生 chrome（每页一份的标题栏 / 窗口背景），不再负责 DOM 主题纠正
    app.syncPageChrome(this);
    this.syncTabBar(0);
    this.refresh();
  },

  // 同步自定义 tabBar 选中态
  syncTabBar(index) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setActive(index);
    }
  },

  onUnload() {
    this._unloaded = true;
    if (this._untheme) this._untheme();
  },

  // 从本地缓存读取记录，实时计算状态并刷新整个看板
  refresh() {
    try {
    // 两个来源分别读取；失败明确提示且清除该来源旧展示，另一来源仍可使用。
    const today = dateUtil.todayStart();
    const settings = app.globalData.settings || storage.loadSettings();
    let households = [], records = [], items = [];
    let householdError = false;
    let recordError = false;
    let householdOverview = summaryUtil.householdOverview([], today);
    try {
      households = storage.loadEntriesStrict('household');
      householdOverview = summaryUtil.householdOverview(households, today);
    } catch (e) { households = []; householdError = true; }
    try {
      records = storage.loadEntriesStrict('record');
      items = recordUtil.sortUrgent(recordUtil.withStatus(records, settings.warningDays));
      items.forEach(it => { it.photoOk = !!it.photoPath && imageUtil.isPhotoValid(it.photoPath); });
    } catch (e) { records = []; items = []; recordError = true; }

    const stats = { expired: 0, warning: 0, safe: 0, warranty: 0, memo: 0 };
    items.forEach(it => { stats[it.status.level] += 1; });
    const reminders = summaryUtil.reminderOverview(records, households, settings, today);
    const selected = reminders.groups.find(group => group.key === this.data.reminderGroup && group.count);
    const group = selected || reminders.groups.find(group => group.count) || reminders.groups[1];
    const reminderExpanded = group.key === this.data.reminderGroup && this.data.reminderExpanded;

    const filter = this.data.filter;
    const kw = this.data.keyword.trim().toLowerCase();
    let list = filter === 'all' ? items : items.filter(it => it.status.level === filter);
    if (kw) {
      list = list.filter(it => {
        const hay = (it.name + ' ' + it.categoryLabel + ' ' + (it.location || '') + ' ' + (it.notes || '')).toLowerCase();
        return hay.indexOf(kw) > -1;
      });
    }

    this.setData({
      // contentReady 与它守卫的列表数据同批原子翻转：门开帧不显示误导性的 0/0/0、共 0 件
      contentReady: true,
      householdOverview,
      householdError,
      recordError,
      reminders,
      reminderGroup: group.key,
      reminderItems: reminderExpanded ? group.items : group.preview,
      reminderCount: group.count,
      reminderExpanded,
      todayText: (today.getMonth() + 1) + ' 月 ' + today.getDate() + ' 日 · ' + dateUtil.weekdayCN(today),
      // 读取失败也在本批收起指示器，与内容同批更新，避免闪现旧提醒或误报空缓存。
      refreshing: false,
      refresherText: '下拉刷新',
      showOnboarding: !storage.isOnboarded(),
      stats,
      list,
      hasRecords: items.length > 0,
      total: items.length,
      filterOptions: [
        { key: 'all', label: '全部', count: items.length },
        { key: 'expired', label: '已过期', count: stats.expired },
        { key: 'warning', label: '临期', count: stats.warning },
        { key: 'safe', label: '安全', count: stats.safe },
        { key: 'warranty', label: '保修', count: stats.warranty },
        { key: 'memo', label: '备忘', count: stats.memo }
      ]
    });
    } catch (e) {
      console.error('[dashboard] refresh failed', e);
      this.setData({
        contentReady: true, recordError: true, householdError: true,
        reminders: summaryUtil.reminderOverview([], []), householdOverview: summaryUtil.householdOverview([]),
        reminderItems: [], reminderCount: 0, reminderExpanded: false,
        stats: { expired: 0, warning: 0, safe: 0, warranty: 0, memo: 0 },
        list: [], total: 0, hasRecords: false, filterOptions: [],
        refreshing: false, refresherText: '下拉刷新'
      });
    }
  },

  onReminderGroup(e) {
    const group = this.data.reminders.groups.find(g => g.key === e.currentTarget.dataset.key);
    if (!group) return;
    this.setData({ reminderGroup: group.key, reminderCount: group.count, reminderItems: group.preview, reminderExpanded: false });
  },
  onToggleReminders() {
    const group = this.data.reminders.groups.find(g => g.key === this.data.reminderGroup);
    if (!group) return;
    const expanded = !this.data.reminderExpanded;
    this.setData({ reminderExpanded: expanded, reminderItems: expanded ? group.items : group.preview });
  },
  onToggleLater() { this.setData({ laterExpanded: !this.data.laterExpanded }); },

  findReminder(key) {
    const overview = this.data.reminders;
    return overview.groups.concat(overview.later).reduce((items, group) => items.concat(group.items), []).find(item => item.key === key);
  },
  onReminderTap(e) {
    const item = this.findReminder(e.currentTarget.dataset.key);
    if (!item) return;
    const page = item.source === 'household' ? 'household-detail' : 'item-detail';
    wx.navigateTo({ url: '/pages/' + page + '/' + page + '?id=' + encodeURIComponent(item.id) });
  },
  onReminderMore(e) {
    const item = this.findReminder(e.currentTarget.dataset.key);
    if (item) this.openItemMenu(item.source, item.id, item);
  },

  onFilterChange(e) {
    this.setData({ filter: e.detail.key });
    this.refresh();
  },

  // 点击统计卡片 = 快捷筛选到对应状态
  onStatTap(e) {
    this.setData({ filter: e.currentTarget.dataset.level });
    this.refresh();
  },

  // ====== 关键词搜索（fab 旁圆形入口展开/收起） ======
  onToggleSearch() {
    if (this.data.searchOpen) {
      this.setData({ searchOpen: false, keyword: '' });
      this.refresh();
    } else {
      this.setData({ searchOpen: true });
    }
  },
  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    this.refresh();
  },
  onSearchClear() {
    this.setData({ keyword: '' });
    this.refresh();
  },

  onItemMore(e) {
    this.openItemMenu('record', e.detail && e.detail.id);
  },

  openItemMenu(source, id, reminder) {
    if (!id || this._itemMenuOpen || this._unloaded) return;
    this._itemMenuOpen = true;
    wx.showActionSheet({
      itemList: [source === 'household' ? '标记已处理' : '记录处理结果', source === 'household' ? '编辑事项' : '编辑物品'],
      success: res => {
        if (this._unloaded || (res.tapIndex !== 0 && res.tapIndex !== 1)) return;
        // 菜单等待期间记录可能被处理或删除，确认后重读，避免跳入过期记录。
        try {
          const item = storage.loadEntriesStrict(source).find(record => record.id === id);
          if (!item || item.archived) {
            wx.showToast({ title: '记录已归档或不存在', icon: 'none' });
            this.refresh(); return;
          }
          if (res.tapIndex === 0 && reminder) {
            const overview = summaryUtil.reminderOverview(source === 'record' ? [item] : [], source === 'household' ? [item] : [], app.globalData.settings);
            const exists = overview.groups.concat(overview.later).some(group => group.items.some(entry => entry.key === reminder.key));
            if (!exists) { wx.showToast({ title: '提醒已变化，请重新查看', icon: 'none' }); this.refresh(); return; }
          }
          const page = source === 'household' ? 'household-form' : 'item-form';
          const url = res.tapIndex === 0 ? '/pages/process/process?source=' + source + '&id=' : '/pages/' + page + '/' + page + '?id=';
          const target = reminder && res.tapIndex === 0 ? '&kind=' + reminder.kind + '&dueDate=' + reminder.dueDate : '';
          wx.navigateTo({ url: url + encodeURIComponent(id) + target });
        } catch (err) { wx.showToast({ title: '暂时无法读取记录，请重试', icon: 'none' }); }
      },
      fail: err => {
        if (!this._unloaded && !/cancel/i.test(err.errMsg || '')) wx.showToast({ title: '菜单未能打开，请重试', icon: 'none' });
      },
      complete: () => { this._itemMenuOpen = false; }
    });
  },

  onCardTap(e) {
    wx.navigateTo({ url: '/pages/item-detail/item-detail?id=' + e.detail.id });
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/item-detail/item-detail?id=' + e.currentTarget.dataset.id });
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/item-form/item-form' });
  },

  goHousehold() {
    wx.navigateTo({ url: '/pages/household/household' });
  },

  goHouseholdDetail(e) {
    wx.navigateTo({ url: '/pages/household-detail/household-detail?id=' + encodeURIComponent(e.currentTarget.dataset.id) });
  },

  goProcess(e) {
    const ds = e.currentTarget.dataset;
    wx.navigateTo({ url: '/pages/process/process?source=' + ds.source + '&id=' + encodeURIComponent(ds.id) });
  },
  goArchive() { wx.navigateTo({ url: '/pages/archive/archive' }); },
  goAddHousehold() {
    wx.navigateTo({ url: '/pages/household-form/household-form' });
  },

  // 跳转「历史上的今天」tab 页
  goHistory() {
    wx.switchTab({ url: '/pages/history/history' });
  },

  // 首次启动引导：写入示例数据（相对今天生成，保证红黄绿都有）
  onUseDemo() {
    if (!storage.saveRecords(recordUtil.demoRecords())) {
      wx.showToast({ title: '载入失败，请重试', icon: 'none' });
      return;
    }
    storage.setOnboarded();
    this.refresh();
    wx.showToast({ title: '已载入示例数据', icon: 'none' });
  },

  // 首次启动引导：空白开始，不写入任何演示数据
  onStartBlank() {
    storage.setOnboarded();
    this.refresh();
  },

  // 下拉刷新（scroll-view refresher）：仅重新计算本地状态，不发起任何网络请求。
  // 只发两次 setData：先起指示器，再由 refresh() 与内容同批收回（成功 / 异常两条路径都翻回 false）。
  onScrollRefresh() {
    this.setData({ refreshing: true, refresherText: '正在刷新…' });
    this.refresh();
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
  }
});
