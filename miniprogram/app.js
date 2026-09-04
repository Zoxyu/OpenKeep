/**
 * 到期那天 In Time · 应用入口
 * 纯本地数据小程序：不使用云开发、不发起任何网络请求。
 * 全局职责：读取设置、解析主题（浅色 / 深色 / 跟随系统）、向页面广播主题变化。
 *
 * ====== 主题的唯一事实来源与优先级 ======
 *   settings.theme（用户选择：system | light | dark）
 *        ↓ resolveTheme()
 *   globalData.effectiveTheme（真正生效：light | dark）
 *        ↑ 唯一事实来源，一律通过 app.isDark() 读取
 *        ↓
 *   ├─ 页面 / 自定义 tabBar 的 DOM 深浅色：data.dark（由 withTheme 注入并持续同步）
 *   └─ 原生标题栏 / 窗口背景：applyChrome()
 *
 * CSS 层的 @media (prefers-color-scheme: dark)（app.wxss 里的 page 元素）与
 * app.json + theme.json 的 @navBg / @bg，都只是「JS 尚未执行时的首帧兜底」，
 * 它们只能跟随「系统」主题；一旦 JS 生效，一律以 effectiveTheme 为准。
 * 默认的「跟随系统」下两者天然一致；用户手动锁定主题时由 effectiveTheme 覆盖。
 * 任何新代码都不得再引入第五个主题判断来源。
 */
const storage = require('./utils/storage');

App({
  globalData: {
    settings: null,          // { warningDays: 3|7|14, theme: 'system'|'light'|'dark' }
    effectiveTheme: 'light'  // 解析后的实际生效主题（主题状态的唯一来源）
  },

  themeListeners: [],

  // 自定义 tabBar 模块加载时会把「快照写入器」登记到这里（见 custom-tab-bar/index.js）。
  // 它不保存任何状态，只是一个写入口：选中态的唯一来源仍是 tabBar 模块里的 SHARED_DATA。
  // 用途：页面以编程方式 wx.switchTab 之前先把目标序号写进快照，
  // 使目标页新建的 tabBar 实例首帧就停在正确位置（与用户点击 tabBar 等效）。
  tabBarSnapshot: null,

  prepareTabSwitch(index) {
    if (this.tabBarSnapshot) this.tabBarSnapshot(index);
  },

  onLaunch() {
    this.globalData.settings = storage.loadSettings();
    this.resolveTheme(this.globalData.settings.theme);
    this.applyChrome();

    // 「跟随系统」模式下响应系统深浅色切换（低版本无此 API 时静默降级）
    if (wx.onThemeChange) {
      wx.onThemeChange(res => {
        const s = this.globalData.settings;
        if (s && s.theme === 'system') {
          this.globalData.effectiveTheme = res.theme === 'dark' ? 'dark' : 'light';
          this.applyChrome();
          this.notifyTheme();
        }
      });
    }
  },

  // 根据用户偏好解析实际生效主题
  resolveTheme(pref) {
    if (pref === 'light' || pref === 'dark') {
      this.globalData.effectiveTheme = pref;
      return;
    }
    let sys = 'light';
    try {
      sys = wx.getSystemInfoSync().theme === 'dark' ? 'dark' : 'light';
    } catch (e) {
      // 低版本兜底为浅色
    }
    this.globalData.effectiveTheme = sys;
  },

  isDark() {
    return this.globalData.effectiveTheme === 'dark';
  },

  // 设置页更新主题偏好
  setThemePref(pref) {
    const s = this.globalData.settings || storage.loadSettings();
    s.theme = pref;
    storage.saveSettings(s);
    this.globalData.settings = s;
    this.resolveTheme(pref);
    this.applyChrome();
    this.notifyTheme();
  },

  // 设置页更新临期阈值（天）
  updateWarningDays(days) {
    const s = this.globalData.settings || storage.loadSettings();
    s.warningDays = days;
    storage.saveSettings(s);
    this.globalData.settings = s;
  },

  // 注册主题变化监听，返回解绑函数。
  // 注意：注册时「不」立即回调。页面 / 组件的 data.dark 已在创建时直接取 app.isDark()，
  // 首帧就是正确主题；再立即回调一次只会多一次同值 setData。本监听只负责
  // 「主题真的发生变化」这一条通道，回调内也应先比对再 setData（见各页 / 组件）。
  onTheme(cb) {
    this.themeListeners.push(cb);
    return () => {
      const i = this.themeListeners.indexOf(cb);
      if (i > -1) this.themeListeners.splice(i, 1);
    };
  },

  // 把页面 / 组件的「模块级 data 快照」与当前生效主题绑定，并返回该对象供 Page()/Component() 使用。
  //
  // 为什么不能写 data: { dark: app.isDark() }：
  // 该表达式只在「页面脚本模块被求值时」执行一次，而不是每次页面实例创建时。
  // 本项目无分包，所有页面 JS 在小程序启动时就已求值，所以它只是「启动那一刻」的主题快照。
  // 用户之后改了主题，尚未创建的页面实例仍会克隆到旧值，于是首次进入该页时
  // 先按旧主题渲染一帧、再靠 onShow 的 setData 纠正 —— 这就是真机看到的旧主题闪烁。
  //（已访问过的页不闪，是因为实例常驻、主题监听已把它的 data.dark 同步过了。）
  //
  // 微信为每个页面 / 组件实例克隆一份 config.data，因此就地持有并更新这个对象，
  // 就能保证之后新建的实例克隆到的初值即当前主题，首帧无需任何纠正。
  // 注：本监听是模块级的、故意不解绑（模块与小程序同生命周期），
  // 回调只修改一个普通对象，不触发任何渲染。
  withTheme(data) {
    data.dark = this.isDark();
    this.onTheme(dark => { data.dark = dark; });
    return data;
  },

  // 页面在 onShow 调用：把该页的主题相关状态一次性对齐到当前生效主题。
  // 它只承担「兜底纠正」：首帧正确性由 withTheme 保证，这里负责两件事：
  // - 实例已存在、但快照未能及时同步时的兜底纠正（dark 只在真的不同时才 setData）；
  // - 原生 chrome：导航栏 / 窗口背景是「每页一份」的，所以「已应用的主题」必须记在
  //   页面实例上（page._chromeDark），不能记在 app 上，否则新页面会被误判为已应用而漏设。
  //   同一主题下每个实例只调一次，因此单纯切 Tab 不会重复发原生调用。
  syncPageTheme(page) {
    const dark = this.isDark();
    if (page.data.dark !== dark) page.setData({ dark: dark });
    if (page._chromeDark !== dark) {
      page._chromeDark = dark;
      this.applyChrome();
    }
  },

  notifyTheme() {
    const dark = this.isDark();
    this.themeListeners.forEach(cb => cb(dark));
  },

  // 按 effectiveTheme 显式写入原生导航栏与窗口背景色。
  //
  // 为什么「跟随系统」时也必须显式写、不能因为 theme.json 已声明式给出就跳过：
  // setNavigationBarColor / setBackgroundColor 是「每页一份」的运行时覆盖，
  // 一旦某页被显式设置过，theme.json 的声明值对该页就不再生效。
  // 若用户先手动锁定深色、再切回「跟随系统」，跳过设置会让那些页面的标题栏
  // 永久停在深色（这正是真机反馈的「标题栏一直保持深色」）。
  // 因此这里无条件按 effectiveTheme 写入，保证四个层面同源：
  //   page 内容 / 原生标题栏 / 原生窗口背景 / 自定义 tabBar
  // 调用频率由 syncPageTheme 的 page._chromeDark 守卫控制，不在本函数内再做主题偏好判断。
  applyChrome() {
    const dark = this.isDark();
    const bg = dark ? '#141619' : '#F7F7F4';
    wx.setNavigationBarColor({
      frontColor: dark ? '#ffffff' : '#000000',
      backgroundColor: bg,
      fail: () => {}
    });
    // 同步原生窗口背景：避免深色模式下页面切换 / 下拉回弹时露出浅色底（白闪）
    if (wx.setBackgroundColor) {
      wx.setBackgroundColor({
        backgroundColor: bg,
        backgroundColorTop: bg,
        backgroundColorBottom: bg,
        fail: () => {}
      });
    }
    // 说明：本项目使用自定义 tabBar（app.json custom:true），原生 wx.setTabBarStyle
    // 对自定义 tabBar 无效，且每次 onShow 调用可能触发底部原生重绘闪烁，故移除。
    // tabBar 的深浅色由组件自身 dark 类驱动（见 custom-tab-bar/index.wxss）。
  }
});
