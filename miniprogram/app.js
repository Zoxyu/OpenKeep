/**
 * 到期那天 In Time · 应用入口
 * 纯本地数据小程序：不使用云开发、不发起任何网络请求。
 * 全局职责：读取设置、解析主题（浅色 / 深色 / 跟随系统）、向页面广播主题变化。
 */
const storage = require('./utils/storage');

App({
  globalData: {
    settings: null,          // { warningDays: 3|7|14, theme: 'system'|'light'|'dark' }
    effectiveTheme: 'light', // 解析后的实际生效主题
    tabFrom: 0               // 自定义 tabBar：最近离开的 tab 序号，供目标页滑块从此处平移进入
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
  // 注册时立即用当前主题回调一次：让页面 / 组件在 onLoad / attached 阶段（首帧渲染前）
  // 就拿到正确的 dark，避免默认 dark:false 造成的切换页面「一闪白」。
  onTheme(cb) {
    this.themeListeners.push(cb);
    try { cb(this.isDark()); } catch (e) {}
    return () => {
      const i = this.themeListeners.indexOf(cb);
      if (i > -1) this.themeListeners.splice(i, 1);
    };
  },

  notifyTheme() {
    const dark = this.isDark();
    this.themeListeners.forEach(cb => cb(dark));
  },

  // 让导航栏、原生窗口背景与 tabBar 颜色跟随主题（统一由 effectiveTheme 驱动，单一来源）
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
