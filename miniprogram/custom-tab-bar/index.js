/**
 * 自定义 tabBar：悬浮胶囊样式。
 * 相比原生 tabBar，布局完全由 flex 控制，可规避部分机型上
 * 原生文字渲染导致的偏移问题；同时支持深浅色主题与安全区适配。
 * 约定：组件路径必须为 custom-tab-bar/index，选中态由各 tab 页
 * 在 onShow 中通过 getTabBar().setActive(index) 同步。
 *
 * 关于滑块动画的重要事实：微信为「每个 tab 页各创建一个独立的 tabBar 组件实例」，
 * 实例之间不共享 data。因此本实例的 selected 只会等于它所属页面的序号，并且在该页
 * 首次展示时（onLoad → onShow → 首帧渲染）就已写入，之后不再变化。
 * 这意味着「滑块从来源 tab 平移到目标 tab」在技术上无法成立：目标页的滑块本来就
 * 已经停在目标位置，若强行先把它挪回来源位置再滑过来，用户看到的就是
 * 「先倒退一次、再前进一次」的二次移动（这正是此前实现的缺陷）。
 * 所以这里只保留 selected 一个状态，滑块位置由它直接推导，不做任何预置位移。
 */
const app = getApp();

Component({
  data: {
    selected: 0,             // 唯一可信的选中状态；滑块位置由它推导
    // 创建时即取真实主题，保证首帧就是正确深浅色，不依赖 attached 的 setData 追平
    dark: app.isDark(),
    list: [
      { pagePath: '/pages/dashboard/dashboard', text: '看板', icon: 'board' },
      { pagePath: '/pages/items/items', text: '物品', icon: 'box' },
      { pagePath: '/pages/history/history', text: '今天', icon: 'today' },
      { pagePath: '/pages/profile/profile', text: '我的', icon: 'me' }
    ]
  },

  lifetimes: {
    attached() {
      // 组件模块只加载一次，而实例可能在主题变化之后才创建（data 字面量会偏旧），
      // 故这里补一次守卫式同步：值相同就不 setData。
      const dark = app.isDark();
      if (this.data.dark !== dark) this.setData({ dark: dark });
      // 跟随全局主题变化（组件不在页面 DOM 内，需自行订阅）。
      // 这是主题到达本组件的唯一通道，因此不再需要 pageLifetimes.show 里的重复校准。
      this._untheme = app.onTheme(d => {
        if (this.data.dark !== d) this.setData({ dark: d });
      });
    },
    detached() {
      if (this._untheme) this._untheme();
    }
  },

  methods: {
    // 由所属 tab 页在 onShow 调用：同步选中态。
    // selected 是唯一状态来源，滑块位置在 wxml 中由它直接算出，不再单独维护 thumbPos。
    // 已经是目标值时直接返回：重复切回同一 Tab 不产生任何 setData / 渲染 / 位移，
    // 这正是消除「二次移动」的关键。首次进入本页时 onShow 早于首帧渲染，
    // 该 setData 会被并入初次渲染，因此滑块首帧就停在正确位置，也不会出现补间滑动。
    setActive(index) {
      if (this.data.selected === index) return;
      this.setData({ selected: index });
    },

    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      if (!item || index === this.data.selected) return;
      wx.switchTab({ url: item.pagePath });
    }
  }
});
