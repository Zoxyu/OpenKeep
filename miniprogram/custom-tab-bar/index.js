/**
 * 自定义 tabBar：悬浮胶囊样式。
 * 相比原生 tabBar，布局完全由 flex 控制，可规避部分机型上
 * 原生文字渲染导致的偏移问题；同时支持深浅色主题与安全区适配。
 * 约定：组件路径必须为 custom-tab-bar/index，选中态由页面 setActive(index) 同步；
 * 若 onShow 时组件尚未可用，组件就绪后通过 getTabBar 实例身份确认所属路由再补位。
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
const themeTrace = require('../utils/theme-trace');

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
      themeTrace.attach(this, 'tabBar');
      // 通道 A · 首次主题初始化：组件没有 onLoad，attached 是等价的最早时机。
      // data 里的 dark 只是模块加载时的快照，而实例可能在用户改过主题之后才创建，
      // 所以这里必须同步读一次当前 effectiveTheme 并按守卫写入。
      this.syncAppearance();
      // 通道 B · 运行时主题变化：组件不在页面 DOM 内、无法继承页面变量，必须自行订阅。
      // show / ready 只作初始化时序补位，syncAppearance 有同值守卫，不重复渲染。
      this._untheme = app.onTheme(d => {
        if (this.data.dark !== d) this.setData({ dark: d });
      });
    },
    ready() {
      // 页面 onShow 可能早于 getTabBar 可用，在组件就绪后补齐所属路由。
      this.syncAppearance();
    },
    detached() {
      themeTrace.lifecycle(this, 'detach');
      if (this._untheme) this._untheme();
    }
  },

  pageLifetimes: {
    show() { themeTrace.lifecycle(this, 'show'); this.syncAppearance(); },
    hide() { themeTrace.lifecycle(this, 'hide'); }
  },

  methods: {
    syncAppearance(index) {
      if (Number.isInteger(index) && index >= 0 && index < this.data.list.length) this._ownerIndex = index;
      if (this._ownerIndex === undefined && typeof getCurrentPages === 'function') {
        const pages = getCurrentPages();
        const owner = pages.find(page => typeof page.getTabBar === 'function' && page.getTabBar() === this);
        // 未找到所属实例就等 ready / setActive；不把来源页路由当作新页选中项。
        if (owner) {
          const route = '/' + String(owner.route || '').replace(/^\//, '');
          const found = this.data.list.findIndex(item => item.pagePath === route);
          if (found >= 0) this._ownerIndex = found;
        }
      }
      const patch = {};
      const dark = app.isDark();
      if (this.data.dark !== dark) patch.dark = dark;
      if (this._ownerIndex !== undefined && this.data.selected !== this._ownerIndex) patch.selected = this._ownerIndex;
      // 新实例把主题与选中项放在同一批，重复展示不再发送无变化的渲染。
      if (Object.keys(patch).length) this.setData(patch);
    },

    // 由所属 tab 页在 onShow 调用：同步选中态（权威来源）。
    // 已经是目标值时直接返回：重复切回同一 Tab 不产生任何 setData / 渲染 / 位移。
    setActive(index) {
      this.syncAppearance(index);
    },

    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      if (!item || index === this.data.selected) return;
      themeTrace.navigation(item.pagePath);
      wx.switchTab({ url: item.pagePath,
        success: () => themeTrace.navigation(item.pagePath, 'switch-success'),
        fail: () => themeTrace.navigation(item.pagePath, 'switch-fail')
      });
    }
  }
});
