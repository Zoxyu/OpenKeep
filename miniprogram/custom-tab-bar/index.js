/**
 * 自定义 tabBar：悬浮胶囊样式。
 * 相比原生 tabBar，布局完全由 flex 控制，可规避部分机型上
 * 原生文字渲染导致的偏移问题；同时支持深浅色主题与安全区适配。
 * 约定：组件路径必须为 custom-tab-bar/index，选中态由各 tab 页
 * 在 onShow 中通过 getTabBar().setActive(index) 同步。
 *
 * ====== 关于 selected 的初值与滑块（真机验证过的结论）======
 * 微信为「每个 tab 页各创建一个独立的 tabBar 组件实例」，实例之间不共享 data；
 * data 字面量只在「组件模块被求值时」执行一次（本项目无分包，即小程序启动时），
 * 所以每个实例克隆到的 selected 初值都是 SHARED_DATA 里的 0，随后由所属页面在 onShow
 * 调用 setActive(index) 纠正为真正的序号。
 *
 * 曾试图「在 switchTab 之前把目标序号写进模块级快照、指望目标页新建实例克隆到正确值」，
 * 该做法已被真机两次证伪：模块级 data 快照无法影响之后新建的实例（data 字面量只求值
 * 一次；setData 又是逻辑层→视图层的异步跨线程调用，无法保证并入首帧）。真正让滑块表现
 * 正确的只有两点：
 *   ① 各 tab 页 onShow 调用 setActive(index) 做选中态纠正；
 *   ② index.wxss 刻意「不设 transition」，使纠正表现为瞬移而非一段滑动。
 * 因此这里不再对模块级 selected 做任何预置写入，选中态完全由 setActive 驱动。
 */
const app = getApp();

// 模块级 data：微信为每个实例克隆一份。
// - dark 是「模块加载时（≈启动时）」的主题快照，只在启动后没改过主题时恰好正确；
//   真正的初始化由下面 attached 里的通道 A 负责（组件没有 onLoad，attached 是等价时机）
// - selected 初值为 0，仅作组件 data 的起始克隆值；真正的选中态由各页 onShow 的 setActive 纠正
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
