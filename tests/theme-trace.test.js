// 只验证诊断模块的观察与透明性，不模拟真机像素或把 setData 回调等同于屏幕已换色。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  let clock = 1000;
  let dark = false;
  const module = { exports: {} };
  class Clock extends Date { static now() { return clock; } }
  const filename = path.resolve(__dirname, '../miniprogram/utils/theme-trace.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Date: Clock,
    setTimeout() { assert.fail('诊断模块不得添加等待或定时任务'); },
    wx: new Proxy({}, { get() { assert.fail('诊断模块不得调用微信存储、网络或导航 API'); } })
  }, { filename });
  const trace = module.exports;
  return {
    trace,
    start() { return trace.start(() => dark); },
    dark(value) { dark = value; },
    tick(ms = 10) { clock += ms; },
    rows() { return JSON.parse(JSON.stringify(trace.read().events)); }
  };
}

function target(extra = {}) {
  const calls = [];
  const pending = [];
  const returnValue = { originalReturn: true };
  const page = {
    data: Object.assign({ dark: false, themeReady: true, contentReady: true }, extra),
    setData(patch, callback) {
      calls.push({ receiver: this, patch, callback, count: arguments.length });
      Object.assign(this.data, patch);
      if (typeof callback === 'function') pending.push(callback);
      return returnValue;
    }
  };
  const original = page.setData;
  return {
    page, original, calls, pending, returnValue,
    ack(index = 0, receiver = page, args = []) { return pending[index].apply(receiver, args); }
  };
}

test('默认关闭时 attach 不包装 setData，不增加回调或采集日志', () => {
  const h = setup(), t = target();
  h.trace.attach(t.page, 'page:items');
  h.trace.lifecycle(t.page, 'hide');
  assert.equal(t.page.setData, t.original);
  const patch = { dark: true };
  assert.equal(t.page.setData(patch), t.returnValue);
  assert.equal(t.calls[0].patch, patch);
  assert.equal(t.calls[0].count, 1);
  assert.equal(t.calls[0].callback, undefined);
  h.trace.navigation('/pages/items/items'); h.trace.themeChanged();
  assert.deepEqual(h.rows(), []);
  assert.equal(h.trace.read().enabled, false);
});

test('开启后区分 send 与 ack，请求保留发出时的 dark 和独立编号', () => {
  const h = setup(), t = target();
  h.trace.attach(t.page, 'page:items'); h.start();
  h.dark(true); h.trace.themeChanged();
  t.page.setData({ dark: true });
  const first = h.rows().find(row => row.event === 'theme-send');
  assert.equal(first.requestedDark, true);
  assert.equal(first.state.dark, false);
  assert.equal(first.effectiveDark, true);
  assert.equal(h.rows().filter(row => row.event === 'theme-ack').length, 0);
  h.tick(); h.dark(false); t.page.setData({ dark: false });
  const sends = h.rows().filter(row => row.event === 'theme-send');
  assert.equal(sends.length, 2);
  assert.notEqual(sends[0].request, sends[1].request);
  h.tick(); t.ack(1); h.tick(); t.ack(0);
  const acks = h.rows().filter(row => row.event === 'theme-ack');
  assert.deepEqual(acks.map(row => [row.request, row.requestedDark]), [
    [sends[1].request, false], [sends[0].request, true]
  ]);
  assert.equal(acks[1].state.dark, false);
  assert.ok(acks[1].ms > acks[0].ms);
});

test('包装保留原 setData 的 this、原 patch 引用、返回值及回调上下文和参数', () => {
  const h = setup(), t = target();
  h.trace.attach(t.page, 'page:items'); h.start();
  const receiver = { data: { dark: false } };
  const callbackThis = { callbackReceiver: true };
  const callbackArgs = [{ delivered: true }, 'second'];
  const patch = { dark: true, themeReady: true, notes: '不得记录的业务值' };
  let callbackCall;
  const result = t.page.setData.call(receiver, patch, function() {
    callbackCall = { receiver: this, args: [...arguments] };
    return 'callback-result';
  });
  assert.equal(result, t.returnValue);
  assert.equal(t.calls[0].receiver, receiver);
  assert.equal(t.calls[0].patch, patch);
  assert.equal(t.calls[0].count, 2);
  assert.equal(t.ack(0, callbackThis, callbackArgs), 'callback-result');
  assert.equal(callbackCall.receiver, callbackThis);
  assert.equal(callbackCall.args[0], callbackArgs[0]);
  assert.equal(callbackCall.args[1], callbackArgs[1]);
});

test('普通业务补丁不包装回调、不改变参数个数，也不记录补丁内容', () => {
  const h = setup(), t = target();
  h.trace.attach(t.page, 'page:items'); h.start();
  const count = h.rows().length;
  const callback = () => 'same-callback';
  const patch = { keyword: '私密搜索词', items: [{ name: '私密物品' }] };
  t.page.setData(patch, callback);
  assert.equal(t.calls[0].patch, patch);
  assert.equal(t.calls[0].callback, callback);
  assert.equal(t.calls[0].count, 2);
  t.page.setData({ themeReady: true });
  assert.equal(t.calls[1].count, 1);
  assert.equal(t.calls[1].callback, undefined);
  t.page.setData({ dark: '不是布尔值' });
  assert.equal(t.calls[2].callback, undefined);
  assert.equal(h.rows().length, count);
  assert.equal(t.ack(), 'same-callback');
});

test('stop 还原原函数；尚未返回的回调仍交给业务，但不再记录 ack', () => {
  const h = setup(), t = target();
  let callbacks = 0;
  h.trace.attach(t.page, 'page:items'); h.start();
  t.page.setData({ dark: true }, () => callbacks++);
  const report = h.trace.stop();
  assert.equal(report.enabled, false);
  assert.equal(t.page.setData, t.original);
  const count = h.rows().length;
  t.ack();
  assert.equal(callbacks, 1);
  assert.equal(h.rows().length, count);
  assert.equal(h.rows().filter(row => row.event === 'theme-ack').length, 0);
  t.page.setData({ dark: false });
  assert.equal(t.calls.at(-1).count, 1);
  assert.equal(t.calls.at(-1).callback, undefined);
});

test('重新开始清空日志并排除旧会话回调，编号复用不混淆新请求', () => {
  const h = setup(), t = target();
  let oldCallback = 0;
  h.trace.attach(t.page, 'page:items'); h.start();
  t.page.setData({ dark: true }, () => oldCallback++);
  h.tick(100); h.start();
  t.page.setData({ dark: false });
  t.ack(0);
  assert.equal(oldCallback, 1);
  assert.equal(h.rows().filter(row => row.event === 'theme-ack').length, 0);
  t.ack(1);
  const rows = h.rows();
  assert.equal(rows[0].event, 'start');
  assert.equal(rows[0].ms, 0);
  assert.equal(rows.filter(row => row.event === 'theme-send').length, 1);
  assert.equal(rows.filter(row => row.event === 'theme-ack').length, 1);
  assert.equal(rows.at(-1).requestedDark, false);
});

test('detach 还原函数并排除迟到 ack，同一对象重挂时分配新实例编号', () => {
  const h = setup(), t = target();
  let callbacks = 0;
  h.start(); h.trace.attach(t.page, 'page:items');
  t.page.setData({ dark: true }, () => callbacks++);
  const oldInstance = h.rows().find(row => row.event === 'attach').instance;
  h.trace.lifecycle(t.page, 'detach');
  assert.equal(t.page.setData, t.original);
  h.trace.attach(t.page, 'page:items');
  const newInstance = h.rows().filter(row => row.event === 'attach').at(-1).instance;
  assert.notEqual(newInstance, oldInstance);
  t.ack(0);
  assert.equal(callbacks, 1);
  assert.equal(h.rows().filter(row => row.event === 'theme-ack').length, 0);
  t.page.setData({ dark: false }); t.ack(1);
  assert.equal(h.rows().at(-1).instance, newInstance);
});

test('每个实例只包装一次，开启期间新增的实例也能跟踪', () => {
  const h = setup(), first = target(), second = target();
  h.trace.attach(first.page, 'page:items');
  assert.equal(h.start().trackedInstances, 1);
  const wrapper = first.page.setData;
  h.trace.attach(first.page, 'page:items');
  assert.equal(first.page.setData, wrapper);
  h.trace.attach(second.page, 'tabbar:items');
  second.page.setData({ dark: true }); second.ack();
  assert.equal(h.rows().filter(row => row.event === 'theme-send').length, 1);
  assert.equal(h.rows().filter(row => row.event === 'theme-ack').length, 1);
  h.trace.stop();
  assert.equal(first.page.setData, first.original);
  assert.equal(second.page.setData, second.original);
});

test('日志最多保留 400 条并统计丢弃数量，read 返回隔离副本', () => {
  const h = setup(), t = target();
  h.trace.attach(t.page, 'page:items'); h.start();
  const baseline = h.rows().length;
  for (let i = 0; i < 450; i++) { h.tick(1); h.trace.lifecycle(t.page, i % 2 ? 'show' : 'hide'); }
  const report = h.trace.read();
  assert.equal(report.events.length, 400);
  assert.equal(report.dropped, baseline + 450 - 400);
  assert.equal(report.events.at(-1).seq, baseline + 450);
  report.events[0].event = '篡改副本';
  report.events[0].state.dark = '篡改副本';
  report.events.pop();
  const actual = h.trace.read();
  assert.equal(actual.events.length, 400);
  assert.notEqual(actual.events[0].event, '篡改副本');
  assert.equal(typeof actual.events[0].state.dark, 'boolean');
});

test('仅记录主题白名单字段与四个固定 Tab，排除业务内容及带参数路径', () => {
  const h = setup(), t = target({
    name: '私密物品名', notes: '私密备注', keyword: '私密搜索', photoPath: '/saved/private.jpg',
    items: [{ id: 'private-record', name: '私人列表' }], selected: 2
  });
  h.trace.attach(t.page, 'page:items'); h.start();
  t.page.setData({ dark: true, name: '替换后的私密名称', notes: '新私密备注' }); t.ack();
  for (const url of [
    '/pages/items/items?id=private-record', '/pages/profile/profile#private',
    '/pages/item-detail/item-detail?id=private-record', '/pages/items/items/extra',
    'https://private.example/path'
  ]) h.trace.navigation(url);
  for (const route of ['dashboard/dashboard', 'items/items', 'history/history', 'profile/profile']) {
    h.trace.navigation('/pages/' + route);
  }
  const rows = h.rows();
  assert.deepEqual(rows.find(row => row.state).state, {
    dark: false, themeReady: true, contentReady: true, selected: 2
  });
  assert.equal(rows.filter(row => row.destination).length, 4);
  const serialized = JSON.stringify(rows);
  assert.doesNotMatch(serialized, /私密|私人|private|photoPath|keyword|notes|name/);
});

for (const when of ['before-show', 'after-show']) {
  test('隐藏页回调 ' + when + ' 时准确记录可见性，导航记录不等待回调', () => {
    const h = setup(), t = target();
    h.trace.attach(t.page, 'page:items'); h.trace.lifecycle(t.page, 'hide'); h.start();
    h.dark(true); h.tick(); t.page.setData({ dark: true });
    if (when === 'before-show') { h.tick(); t.ack(); }
    h.tick();
    const result = h.trace.navigation('/pages/items/items', 'tab-click');
    assert.equal(result, undefined);
    // 诊断调用同步返回，不会等待仍未完成的视图回调，也不负责发起导航。
    let navigationCalls = 0;
    function switchTab() { h.trace.navigation('/pages/items/items'); navigationCalls++; }
    switchTab();
    assert.equal(navigationCalls, 1);
    h.tick(); h.trace.lifecycle(t.page, 'show');
    if (when === 'after-show') { h.tick(); t.ack(); }
    const rows = h.rows();
    const send = rows.find(row => row.event === 'theme-send');
    const ack = rows.find(row => row.event === 'theme-ack');
    const show = rows.find(row => row.event === 'show');
    const nav = rows.find(row => row.event === 'switch-call');
    assert.equal(send.visible, false);
    assert.equal(ack.visible, when === 'after-show');
    assert.equal(ack.request, send.request);
    assert.ok(nav.seq < show.seq);
    assert.equal(ack.seq < show.seq, when === 'before-show');
  });
}

test('诊断解析失败不阻断原 setData 或其原回调', () => {
  const h = setup(), t = target();
  h.trace.attach(t.page, 'page:items');
  h.trace.start(() => { throw new Error('diagnostic resolver failed'); });
  let called = false;
  assert.equal(t.page.setData({ dark: true }, () => { called = true; }), t.returnValue);
  t.ack();
  assert.equal(called, true);
  assert.equal(t.page.data.dark, true);
});

test('原 setData 的同步异常与业务回调异常保持原有传播语义', () => {
  const h = setup();
  const error = new Error('original setData failed');
  const page = { data: { dark: false }, setData() { throw error; } };
  h.trace.attach(page, 'page:items'); h.start();
  assert.throws(() => page.setData({ dark: true }), e => e === error);
  const t = target(), callbackError = new Error('business callback failed');
  h.trace.attach(t.page, 'page:profile');
  t.page.setData({ dark: true }, () => { throw callbackError; });
  assert.throws(() => t.ack(), e => e === callbackError);
});

test('停止诊断不覆盖期间被其它代码替换的 setData', () => {
  const h = setup(), t = target();
  h.trace.attach(t.page, 'page:items'); h.start();
  const replacement = function() {};
  t.page.setData = replacement;
  h.trace.stop();
  assert.equal(t.page.setData, replacement);
});
