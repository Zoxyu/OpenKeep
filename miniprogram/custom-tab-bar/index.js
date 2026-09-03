/**
 * 自定义 tabBar：悬浮胶囊样式。
 * 相比原生 tabBar，布局完全由 flex 控制，可规避部分机型上
 * 原生文字渲染导致的偏移问题；同时支持深浅色主题与安全区适配。
 * 约定：组件路径必须为 custom-tab-bar/index，选中态由各 tab 页
 * 在 onShow 中通过 getTabBar().setData({ selected }) 同步。
 */
const app = getApp();

Component({
  data: {
    selected: 0,
    thumbPos: 0,             // 滑块位置：可与 selected 短暂不同，用于「从来源平移到目标」的动画
    noAnim: true,            // 滑块禁用过渡：页面同步/首帧瞬移；仅用户点击切 tab 时才平移
    dark: false,
    list: [
      { pagePath: '/pages/dashboard/dashboard', text: '看板', icon: 'board' },
      { pagePath: '/pages/items/items', text: '物品', icon: 'box' },
      { pagePath: '/pages/history/history', text: '今天', icon: 'today' },
      { pagePath: '/pages/profile/profile', text: '我的', icon: 'me' }
    ]
  },

  lifetimes: {
    attached() {
      this.setData({ dark: app.isDark() });
      // 跟随全局主题变化（组件不在页面 DOM 内，需自行订阅）
      this._untheme = app.onTheme(dark => this.setData({ dark }));
    },
    detached() {
      if (this._untheme) this._untheme();
    }
  },

  pageLifetimes: {
    show() {
      // 页面切换时校准主题（应用启动瞬间主题可能尚未就绪）
      if (this.data.dark !== app.isDark()) {
        this.setData({ dark: app.isDark() });
      }
    }
  },

  methods: {
    // 由所属 tab 页在 onShow 调用：把滑块定位到当前页序号。
    // 若来自其它 tab 的切换（tabFrom≠目标），先瞬移到来源位置，再动画滑到目标，
    // 形成方向正确的平移（如 物品→我的 直接向右滑），避免从默认 0 位「乱跳 / 左到右」。
    setActive(index) {
      const from = app.globalData.tabFrom;
      // 选中高亮（文字/图标）立即到位；滑块 thumbPos 从来源平移到目标，方向正确不乱跳
      if (from !== undefined && from !== index) {
        this.setData({ selected: index, thumbPos: from, noAnim: true }, () => {
          this.setData({ noAnim: false }, () => {
            this.setData({ thumbPos: index });
          });
        });
      } else {
        this.setData({ selected: index, thumbPos: index, noAnim: true });
      }
      app.globalData.tabFrom = index;
    },

    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      if (!item || index === this.data.selected) return;
      // 记录来源 tab，供目标页滑块从此处平移进入；不在本页 setData，避免与目标页动画叠加
      app.globalData.tabFrom = this.data.selected;
      wx.switchTab({ url: item.pagePath });
    }
  }
});
