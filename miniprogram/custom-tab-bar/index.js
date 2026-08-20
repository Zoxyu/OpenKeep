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
    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      if (!item || index === this.data.selected) return;
      wx.switchTab({ url: item.pagePath });
    }
  }
});
