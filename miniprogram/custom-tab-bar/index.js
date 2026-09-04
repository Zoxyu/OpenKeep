/**
 * 自定义 tabBar：悬浮胶囊样式。
 * 相比原生 tabBar，布局完全由 flex 控制，可规避部分机型上
 * 原生文字渲染导致的偏移问题；同时支持深浅色主题与安全区适配。
 * 约定：组件路径必须为 custom-tab-bar/index，选中态由各 tab 页
 * 在 onShow 中通过 getTabBar().setActive(index) 同步。
 *
 * ====== 关于 selected 的初值（真机验证过的关键结论）======
 * 微信为「每个 tab 页各创建一个独立的 tabBar 组件实例」，实例之间不共享 data；
 * 而 data 字面量只在「组件模块被求值时」执行一次（本项目无分包，即小程序启动时）。
 * 所以若把初值写成 selected: 0，四个实例的初值全是 0：
 *   首次进入物品 → 0 → 1、首次进入今天 → 0 → 2、首次进入我的 → 0 → 3
 * 这个变化会被 CSS transition 捕捉，于是滑块「从看板位置滑到目标位置」。
 * 它并不是正确的「来源 → 目标」动画，而是目标页自己的实例从默认初值过渡到目标值，
 * 表现就是：每个 Tab 只有第一次进入才滑，四个都访问过之后就再也不滑。
 *
 * 又因为 setData 是逻辑层→视图层的异步调用，无法保证被并入首帧渲染，
 * 所以「先渲染 0、再用 setData 纠正」必然会露出错误的一帧。
 * 唯一可靠的办法是让实例创建时克隆到的初值就已经是它自己的序号。
 *
 * 做法：把 data 提成模块级对象 SHARED_DATA，在 switchTab 发起切换「之前」
 * 就把目标序号写进快照；目标页新建实例时克隆到的 selected 即为它自己的序号，
 * 首帧直接就是正确选中态，不需要任何补间动画，也不需要 initialized / noAnim 之类的开关。
 *
 * 跨实例的滑块平移动画在本架构下无法可靠实现（目标实例本来就停在目标位置），
 * 且本项目当前不要求它，因此 .tab-thumb 不再设置 transition：
 * 任何位置的纠正都是瞬时的，绝不会表现为一段滑动。
 */
const app = getApp();

// 模块级 data：微信为每个实例克隆一份。
// - dark 是「模块加载时（≈启动时）」的主题快照，只在启动后没改过主题时恰好正确；
//   真正的初始化由下面 attached 里的通道 A 负责（组件没有 onLoad，attached 是等价时机）
// - selected 的初值与滑块逻辑保持原样，本次未作任何改动
const SHARED_DATA = {
  dark: app.isDark(),
  selected: 0,
  list: [
    { pagePath: '/pages/dashboard/dashboard', text: '看板', icon: 'board' },
    { pagePath: '/pages/items/items', text: '物品', icon: 'box' },
    { pagePath: '/pages/history/history', text: '今天', icon: 'today' },
    { pagePath: '/pages/profile/profile', text: '我的', icon: 'me' }
  ]
};

// 把快照写入器登记到 app：供页面以编程方式 wx.switchTab 之前预置目标序号
// （例如首页「查看更多」直接跳「今天」）。只登记一个写入口，
// 不引入第二份选中态 —— SHARED_DATA 仍是唯一来源。
app.tabBarSnapshot = index => { SHARED_DATA.selected = index; };

Component({
  data: SHARED_DATA,

  lifetimes: {
    attached() {
      // 通道 A · 首次主题初始化：组件没有 onLoad，attached 是等价的最早时机。
      // data 里的 dark 只是模块加载时的快照，而实例可能在用户改过主题之后才创建，
      // 所以这里必须同步读一次当前 effectiveTheme 并按守卫写入。
      const dark = app.isDark();
      if (this.data.dark !== dark) this.setData({ dark: dark });
      // 通道 B · 运行时主题变化：组件不在页面 DOM 内、无法继承页面变量，必须自行订阅。
      // 这是主题变化到达本组件的唯一通道，因此不需要 pageLifetimes.show 里的重复校准。
      this._untheme = app.onTheme(d => {
        if (this.data.dark !== d) this.setData({ dark: d });
      });
    },
    detached() {
      if (this._untheme) this._untheme();
    }
  },

  methods: {
    // 由所属 tab 页在 onShow 调用：同步选中态（权威来源）。
    // 已经是目标值时直接返回：重复切回同一 Tab 不产生任何 setData / 渲染 / 位移。
    // 同时把序号写回模块级快照，使之后新建的实例首帧即正确。
    setActive(index) {
      SHARED_DATA.selected = index;
      if (this.data.selected === index) return;
      this.setData({ selected: index });
    },

    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      if (!item || index === this.data.selected) return;
      // 关键：在发起切换之前就把目标序号写入模块级快照。
      // 目标页的 tabBar 实例随后被创建时会克隆到该值，首帧就停在正确位置，
      // 不需要「先渲染 0 再纠正」，也就不会出现从看板滑过来的错误动画。
      // 注意这只修改模块级快照，不影响当前（来源）实例自己的 this.data.selected。
      SHARED_DATA.selected = index;
      wx.switchTab({ url: item.pagePath });
    }
  }
});
