// 主题状态与异步 API 回调的逻辑回归；不模拟微信原生首帧渲染时机。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));
const root = path.resolve(__dirname, '../miniprogram');

function setup(pref = 'system', system = 'light') {
  let app, component, definition, pages = [], onSystemTheme, mode = 'ok';
  const calls = [], renders = [], switches = [], cache = new Map([['openkeep_settings_v1', { theme: pref, warningDays: 7 }]]);
  const complete = (call, ok) => {
    if (ok && call.page) call.page.native[call.kind] = call.options.backgroundColor;
    const callback = ok ? call.options.success : call.options.fail;
    if (callback) callback({});
  };
  const native = (kind, options) => {
    const call = { kind, options, page: pages[pages.length - 1] };
    calls.push(call);
    if (mode !== 'pending') complete(call, mode !== 'fail');
  };
  const context = vm.createContext({ console, Date, setTimeout, clearTimeout,
    App: value => { app = value; }, Page: value => { definition = value; },
    Component: value => { component = value; }, getApp: () => app, getCurrentPages: () => pages,
    wx: {
      getStorageSync: key => cache.get(key), setStorageSync: (key, value) => cache.set(key, clone(value)),
      getSystemInfoSync: () => ({ theme: system }), onThemeChange: callback => { onSystemTheme = callback; },
      setNavigationBarColor: options => native('nav', options), setBackgroundColor: options => native('bg', options),
      canIUse: () => true, getFileSystemManager: () => ({ accessSync() {} }),
      env: { USER_DATA_PATH: '/saved' }, switchTab(options) { switches.push(options); }
    }
  });
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const run = vm.runInContext('(function(require,module,exports){\n' + fs.readFileSync(file, 'utf8') + '\n})', context, { filename: file });
    run(relative => load(path.resolve(path.dirname(file), relative.endsWith('.js') ? relative : relative + '.js')), module, module.exports);
    return module.exports;
  }
  load(path.join(root, 'app.js')); app.onLaunch();
  const instance = (data, methods) => Object.assign({}, methods, { data: clone(data), updates: [],
    setData(patch, callback) {
      this.updates.push(clone(patch)); Object.assign(this.data, patch);
      if (callback) renders.push(() => callback.call(this));
    } });
  return {
    app, calls, cache, complete, switches,
    render() { renders.splice(0).forEach(callback => callback()); },
    mode(value) { mode = value; },
    show(page) { pages = [page]; app.syncPageChrome(page); },
    system(value) { system = value; onSystemTheme({ theme: value }); },
    page(route = 'pages/items/items') { return { route, native: {}, getTabBar() { return this.bar; } }; },
    registerTab() { load(path.join(root, 'custom-tab-bar/index.js')); },
    tab(owner, late = false) {
      const bar = instance(component.data, component.methods);
      if (!late) owner.bar = bar;
      component.lifetimes.attached.call(bar);
      return { bar,
        ready() { owner.bar = bar; component.lifetimes.ready.call(bar); },
        show() { component.pageLifetimes.show.call(bar); },
        detach() { component.lifetimes.detached.call(bar); }
      };
    },
    registerPage(name) { load(path.join(root, 'pages', name, name + '.js')); return definition; },
    instantiatePage(options) {
      const page = Object.assign(instance(options.data, options), { native: {} });
      pages = [page]; page.onLoad(); return page;
    }
  };
}

test('系统主题变化同步当前页面缓存，再返回不会把旧颜色误判为已经应用', () => {
  const h = setup(), a = h.page(), b = h.page('pages/profile/profile');
  h.show(a); assert.equal(a._chromeDark, false);
  h.system('dark'); assert.equal(a._chromeDark, true); assert.equal(a.native.nav, '#141619');
  h.show(b); h.system('light');
  const before = h.calls.length; h.show(a);
  assert.equal(h.calls.length - before, 2); assert.equal(a.native.nav, '#F7F7F4'); assert.equal(a.native.bg, '#F7F7F4');
});

test('手动双向切换、返回旧页面的原生色与内容主题一致，同主题不重复改色', () => {
  const h = setup(), a = h.page(), b = h.page('pages/profile/profile');
  h.show(a); h.show(b); h.app.setThemePref('dark'); h.show(a);
  assert.equal(a.native.nav, '#141619'); assert.equal(a._chromeDark, true);
  let count = h.calls.length; h.show(a); assert.equal(h.calls.length, count);
  h.show(b); h.app.setThemePref('light'); h.show(a); assert.equal(a.native.nav, '#F7F7F4');
  count = h.calls.length; h.show(a); assert.equal(h.calls.length, count);
  assert.equal(h.cache.get('openkeep_settings_v1').theme, 'light');
});

test('原生 API 失败不记成功，再次展示可重试；等待中不重复发送', () => {
  const h = setup(), page = h.page(); h.mode('pending'); h.show(page);
  const requests = h.calls.slice(-2), count = h.calls.length;
  assert.equal(page._chromeDark, undefined); h.show(page); assert.equal(h.calls.length, count);
  h.complete(requests[0], true); h.complete(requests[1], false);
  assert.equal(page._chromeDark, undefined); h.mode('ok'); h.show(page);
  assert.equal(page._chromeDark, false); assert.equal(h.calls.length, count + 2);
});

test('旧主题异步回调不能覆盖新主题缓存，双向快速切换以最新请求为准', () => {
  const h = setup(), page = h.page(); h.mode('pending'); h.show(page);
  const light = h.calls.slice(-2); h.app.setThemePref('dark'); const dark = h.calls.slice(-2);
  dark.forEach(call => h.complete(call, true)); assert.equal(page._chromeDark, true);
  light.forEach(call => h.complete(call, true)); assert.equal(page._chromeDark, true);
  h.app.setThemePref('light'); const latest = h.calls.slice(-2);
  dark.forEach(call => h.complete(call, false)); assert.equal(page._chromeDark, undefined);
  latest.forEach(call => h.complete(call, true)); assert.equal(page._chromeDark, false);
});

test('模块在浅色注册、实例在深色创建，tabBar 在同一批校准主题和所属菜单', () => {
  const h = setup(); h.registerTab(); h.app.setThemePref('dark');
  const page = h.page('pages/history/history'); h.show(page); const t = h.tab(page);
  assert.deepEqual(t.bar.updates[0], { dark: true, selected: 2 });
  const before = t.bar.updates.length; t.ready(); t.show(); t.bar.setActive(2);
  assert.equal(t.bar.updates.length, before);
  h.app.setThemePref('light'); assert.equal(t.bar.data.dark, false); assert.equal(t.bar.data.selected, 2);
  t.detach(); const count = t.bar.updates.length; h.app.setThemePref('dark'); assert.equal(t.bar.updates.length, count);
});

test('getTabBar 晚于页面 onShow 可用时，ready 补同步且不误用来源页面选中项', () => {
  const h = setup(); h.registerTab(); const page = h.page('pages/profile/profile'); h.show(page);
  const t = h.tab(page, true); assert.equal(t.bar.data.selected, 0);
  t.ready(); assert.equal(t.bar.data.selected, 3);
  const other = h.page(); h.show(other); t.show(); assert.equal(t.bar.data.selected, 3);
});

test('未创建页面不依赖模块旧快照，已创建 Tab 在主题变化时即时更新且不重置内容', () => {
  const h = setup(), options = h.registerPage('items');
  h.app.setThemePref('dark'); const page = h.instantiatePage(options);
  assert.equal(options.data.dark, false); assert.equal(page.data.dark, true); assert.equal(page.data.themeReady, true);
  assert.equal(page.native.nav, '#141619'); page.data.keyword = '保留搜索'; page.data.contentReady = true;
  h.app.setThemePref('light'); assert.equal(page.data.dark, false);
  assert.equal(page.data.keyword, '保留搜索'); assert.equal(page.data.contentReady, true);
  page.onUnload();
});

test('四个 Tab 的页面元信息绑定现有主题且排在首个节点，不新增导航栏或主题快照', () => {
  for (const name of ['dashboard', 'items', 'history', 'profile']) {
    const source = fs.readFileSync(path.join(root, 'pages', name, name + '.wxml'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').trimStart();
    assert.match(source, /^<page-meta\s+wx:if="\{\{themeReady\}\}"/);
    assert.match(source, /page-style="background-color: \{\{dark \?/);
    assert.match(source, /<navigation-bar background-color="\{\{dark \?/);
    assert.match(source, /color-animation-duration="\{\{0\}\}"/);
    assert.match(source, /<view wx:if="\{\{themeReady\}\}" class="page-root/);
    assert.doesNotMatch(source, /<navigation-bar[^>]*title=/);
  }
});

test('真机诊断接入四个页面和底栏，切页照常发生并记录其后才返回的主题回调', () => {
  const h = setup(), names = ['dashboard', 'items', 'history', 'profile'];
  const pages = names.map(name => {
    const page = h.instantiatePage(h.registerPage(name));
    page.route = 'pages/' + name + '/' + name;
    return page;
  });
  pages.slice(0, 3).forEach(page => page.onHide());
  pages[3].onShow();
  h.registerTab(); const tab = h.tab(pages[3]); tab.show();
  h.app.startThemeTrace(); h.app.setThemePref('dark');
  const sent = h.app.readThemeTrace().events.filter(row => row.event === 'theme-send');
  assert.deepEqual(clone(sent.map(row => row.target).sort()), [...names, 'tabBar'].sort());
  assert.equal(h.app.readThemeTrace().events.some(row => row.event === 'theme-ack'), false);
  tab.bar.switchTab({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(h.switches[0].url, '/pages/items/items');
  h.render();
  const trace = h.app.stopThemeTrace(), called = trace.events.find(row => row.event === 'switch-call');
  const acks = trace.events.filter(row => row.event === 'theme-ack');
  assert.equal(acks.length, 5);
  assert.ok(acks.every(row => row.seq > called.seq && row.requestedDark && row.requestRevision === 1));
  assert.equal(acks.find(row => row.target === 'items').visible, false);
  pages.forEach(page => page.onUnload()); tab.detach();
});
