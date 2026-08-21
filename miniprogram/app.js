/**
 * 到期那天 In Time · 应用入口
 * 纯本地数据小程序：不使用云开发、不发起任何网络请求。
 * 全局职责：读取设置、解析主题（浅色 / 深色 / 跟随系统）、向页面广播主题变化。
 */
const storage = require('./utils/storage');

App({
  globalData: {
    settings: null,          // { warningDays: 3|7|14, theme: 'system'|'light'|'dark' }
    effectiveTheme: 'light'  // 解析后的实际生效主题
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

  // 注册主题变化监听，返回解绑函数
  onTheme(cb) {
    this.themeListeners.push(cb);
    return () => {
      const i = this.themeListeners.indexOf(cb);
      if (i > -1) this.themeListeners.splice(i, 1);
    };
  },

  notifyTheme() {
    const dark = this.isDark();
    this.themeListeners.forEach(cb => cb(dark));
  },

  // 让导航栏与 tabBar 颜色跟随主题
  applyChrome() {
    const dark = this.isDark();
    wx.setNavigationBarColor({
      frontColor: dark ? '#ffffff' : '#000000',
      backgroundColor: dark ? '#141619' : '#F7F7F4'
    });
    wx.setTabBarStyle({
      backgroundColor: dark ? '#1B1E22' : '#FFFFFF',
      color: dark ? '#7E8580' : '#8A8F8B',
      selectedColor: dark ? '#E8EAE6' : '#202421',
      borderStyle: dark ? 'black' : 'white'
    });
  }
});
