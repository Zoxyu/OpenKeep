/**
 * 到期那天 In Time · 应用入口
 * 纯本地数据小程序：不使用云开发、不发起任何网络请求。
 * 全局职责：读取设置、解析主题（浅色 / 深色 / 跟随系统）、向页面广播主题变化。
 */
const storage = require('./utils/storage');

App({
  globalData: {
    settings: null,          // { warningDays: 3|7|14, theme: 'system'|'light'|'dark' }
    effectiveTheme: 'light'  // 解析后的实际生效主题（主题状态的唯一来源）
  },

  themeListeners: [],

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

  // 页面在 onShow 调用：把该页的主题相关状态一次性对齐到当前生效主题。
  // - dark 只在真的不同时才 setData：避免每次切 Tab 都为了同一个值重渲染整页；
  // - 原生导航栏 / 窗口背景是「每页一份」的，所以「已应用的主题」必须记在页面实例上
  //   （page._chromeDark），不能记在 app 上，否则新页面会被误判为已应用而漏设。
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

  // 覆盖原生导航栏与窗口背景色（统一由 effectiveTheme 驱动，单一来源）。
  // 「跟随系统」时这两个值已由 app.json 的 window.* = @navBg / @bg 配合 theme.json
  // 声明式给出，首帧即正确、无需任何 JS 调用；只有用户手动锁定浅色 / 深色、
  // 与系统不一致时才需要运行时覆盖。因此默认配置下本函数是空操作，
  // 切换 Tab 不再产生 setNavigationBarColor / setBackgroundColor 跨线程调用。
  applyChrome() {
    const s = this.globalData.settings;
    if (!s || s.theme === 'system') return;
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
