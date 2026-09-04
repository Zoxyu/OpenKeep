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
 *   ├─ 页面 / 自定义 tabBar 的 DOM 深浅色：data.dark，走两条互不混淆的通道
 *   │     通道 A（首次初始化）：页面 onLoad / 组件 attached 内同步读 app.isDark() 后 setData
 *   │     通道 B（运行时变化）：app.onTheme 监听，只负责「已存在实例」的后续变化
 *   └─ 原生标题栏 / 窗口背景：applyChrome()（由 syncPageChrome 按页面实例守卫调用）
 *
 * 严禁依赖「修改模块级 data 对象去影响未来创建的实例」：Page() / Component() 注册时的
 * data 与之后各实例的 this.data 不是同一份，就地改模块级对象无法保证新实例首帧拿到新值
 * （本项目已在真机上证伪）。首帧正确性只能由通道 A 承担，onTheme 不承担首次初始化。
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

  // 通道 B：注册「主题发生变化」的监听，返回解绑函数。
  // 职责严格限定为「已存在实例的运行时主题变化」，不承担首次初始化 ——
  // 首次初始化由页面 onLoad / 组件 attached 同步完成（通道 A）。因此注册时「不」立即回调，
  // 回调内也应先比对再 setData，避免为同一个值重复渲染。
  onTheme(cb) {
    this.themeListeners.push(cb);
    return () => {
      const i = this.themeListeners.indexOf(cb);
      if (i > -1) this.themeListeners.splice(i, 1);
    };
  },

  // 页面在 onShow 调用：只负责原生 chrome（标题栏 / 窗口背景），不负责 DOM 主题。
  // DOM 主题走通道 A（onLoad 初始化）与通道 B（onTheme 变化），onShow 不参与，
  // 避免「页面显示以后再纠正」造成肉眼可见的旧主题残留。
  //
  // 导航栏 / 窗口背景是「每页一份」的运行时覆盖，所以「已应用的主题」必须记在页面实例上
  // （page._chromeDark），不能记在 app 上，否则新页面会被误判为已应用而漏设。
  // 同一主题下每个实例只调一次，因此单纯切 Tab 不会重复发原生调用。
  syncPageChrome(page) {
    const dark = this.isDark();
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
  // 调用频率由 syncPageChrome 的 page._chromeDark 守卫控制，不在本函数内再做主题偏好判断。
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
