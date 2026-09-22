// node --test tests/household.test.js
// 实际加载页面、存储、日期和状态模块；微信存储/弹窗/导航使用可控替身。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KEY = 'openkeep_household_v1';
const sample = (patch = {}) => Object.assign({
  id: 'hh-1', title: '宽带续费', type: 'bill', dueDate: '2026-01-31',
  repeatRule: 'monthly', notes: '营业厅办理', createdAt: 123, updatedAt: 456
}, patch);
const plain = value => JSON.parse(JSON.stringify(value));

function setup() {
  const cache = new Map();
  const writes = [];
  const toasts = [];
  const modals = [];
  const navigation = [];
  const timers = new Map();
  const themes = new Set();
  let definition;
  let failRead = false;
  let failWrite = false;
  let timerId = 0;
  let now = new Date(2026, 0, 31, 12).getTime();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const app = {
    globalData: { settings: { warningDays: 7 } },
    isDark: () => false, syncPageChrome() {},
    onTheme(fn) { themes.add(fn); return () => themes.delete(fn); }
  };
  const context = vm.createContext({
    Date: Clock, console, getApp: () => app, Page: d => { definition = d; },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
    wx: {
      getStorageSync(key) { if (failRead && key === KEY) throw new Error('read failed'); return cache.get(key); },
      setStorageSync(key, value) { if (failWrite) throw new Error('storage full'); cache.set(key, plain(value)); writes.push(key); },
      removeStorageSync: key => cache.delete(key),
      getFileSystemManager: () => ({ unlinkSync() {} }), env: { USER_DATA_PATH: '/saved' },
      showToast: options => toasts.push(options.title), showModal: options => modals.push(options),
      navigateTo: options => navigation.push(options.url), navigateBack: () => navigation.push('back'),
      setNavigationBarTitle() {}, onKeyboardHeightChange() {}, offKeyboardHeightChange() {}
    }
  });
  const modules = new Map();
  const root = path.resolve(__dirname, '../miniprogram');
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const run = vm.runInContext('(function(require,module,exports){\n' + fs.readFileSync(filename, 'utf8') + '\n})', context, { filename });
    run(relative => load(path.resolve(path.dirname(filename), relative.endsWith('.js') ? relative : relative + '.js')), module, module.exports);
    return module.exports;
  }
  const storage = load(path.join(root, 'utils/storage.js'));
  const record = load(path.join(root, 'utils/record.js'));
  const repeat = load(path.join(root, 'utils/repeat.js'));
  function page(name, options = {}) {
    const filename = path.join(root, 'pages', name, name + '.js');
    modules.delete(filename);
    load(filename);
    const p = Object.assign({}, definition, {
      data: plain(definition.data),
      setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); }
    });
    p.onLoad(options);
    p.onShow();
    return p;
  }
  return {
    cache, writes, toasts, modals, navigation, storage, record, repeat, page,
    failRead(value = true) { failRead = value; }, failWrite(value = true) { failWrite = value; },
    nextDay() { now += 86400000; },
    dark() { themes.forEach(fn => fn(true)); },
    runTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    respond(confirm) { const modal = modals.at(-1); modal.success({ confirm }); modal.complete(); }
  };
}

test('家庭事项独立存储；新增编辑删除不改旧物品、设置和引导缓存', () => {
  const h = setup();
  const old = [{ id: 'old', name: '牛奶', openedAt: '2026-01-01', shelfLifeDays: 7 }];
  h.cache.set('openkeep_records_v1', old);
  h.cache.set('openkeep_settings_v1', { warningDays: 14, theme: 'dark' });
  h.cache.set('openkeep_onboarded_v1', true);
  assert.equal(h.storage.loadHousehold().length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.storage.upsertHousehold(sample()), true);
  assert.equal(h.storage.upsertHousehold(sample({ title: '宽带续费修改' }), true), true);
  assert.equal(h.storage.loadHousehold().length, 1);
  assert.equal(h.storage.removeHousehold('hh-1'), true);
  assert.deepEqual(h.cache.get('openkeep_records_v1'), old);
  assert.equal(h.storage.loadRecords()[0].openedDays, 7);
  assert.deepEqual(h.cache.get('openkeep_settings_v1'), { warningDays: 14, theme: 'dark' });
  assert.equal(h.cache.get('openkeep_onboarded_v1'), true);
  assert.deepEqual(h.writes, [KEY, KEY, KEY]);
});

test('读时规范化缺省值，跳过损坏条目且不写回；更新保留其它原始条目', () => {
  const h = setup();
  const partial = { id: 'partial', title: ' 护照 ', dueDate: '2027-01-01', type: 'unknown', repeatRule: 'bad' };
  h.cache.set(KEY, [null, { id: 'bad', title: '坏日期', dueDate: '2026-02-30' }, partial]);
  const first = plain(h.storage.loadHousehold());
  assert.equal(first.length, 1);
  assert.equal(first[0].repeatRule, 'none');
  assert.equal(first[0].type, 'bill');
  assert.equal(first[0].notes, '');
  assert.equal(first[0].createdAt, 0);
  h.nextDay();
  assert.deepEqual(plain(h.storage.loadHousehold()), first);
  assert.equal(h.writes.length, 0);
  assert.equal(h.storage.upsertHousehold(sample()), true);
  assert.deepEqual(h.cache.get(KEY).slice(0, 3), [null, { id: 'bad', title: '坏日期', dueDate: '2026-02-30' }, partial]);
});

test('读取失败或缓存整体损坏时拒绝写入，页面错误态可以重试', () => {
  const h = setup();
  h.cache.set(KEY, [sample()]);
  h.failRead();
  assert.equal(h.storage.upsertHousehold(sample({ id: 'new' })), false);
  assert.equal(h.storage.removeHousehold('hh-1'), false);
  const list = h.page('household');
  const detail = h.page('household-detail', { id: 'hh-1' });
  const edit = h.page('household-form', { id: 'hh-1' });
  for (const p of [list, detail, edit]) assert.equal(p.data.loadError, true);
  assert.equal(h.writes.length, 0);
  h.failRead(false);
  list.refresh(); detail.refresh(); edit.loadForm();
  for (const p of [list, detail, edit]) assert.equal(p.data.loadError, false);
  assert.equal(edit.data.title, '宽带续费');
  h.cache.set(KEY, { corrupted: true });
  assert.equal(h.storage.upsertHousehold(sample()), false);
  assert.deepEqual(h.cache.get(KEY), { corrupted: true });
});

test('三种事项类型录入与重复规则保存，失败保留内容并可重试；连点不重复', () => {
  for (const [type, rule] of [['bill', 'monthly'], ['insurance', 'yearly'], ['document', 'none']]) {
    const h = setup();
    const p = h.page('household-form');
    p.setData({ title: '测试事项', type, repeatRule: rule, notes: '保留备注' });
    h.failWrite(); p.onSave();
    assert.equal(p.data.saving, false);
    assert.equal(p.data.title, '测试事项');
    assert.equal(h.modals.at(-1).title, '保存失败');
    assert.equal(h.toasts.length, 0);
    h.runTimers(); assert.equal(h.navigation.length, 0);
    h.failWrite(false); p.onSave(); p.onSave();
    h.runTimers();
    const saved = h.storage.loadHousehold();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].type, type); assert.equal(saved[0].repeatRule, rule);
    assert.equal(saved[0].notes, '保留备注');
    assert.deepEqual(h.navigation, ['back']);
    const detail = h.page('household-detail', { id: saved[0].id });
    assert.equal(detail.data.item.title, '测试事项');
    assert.equal(!!detail.data.item.followingDate, rule !== 'none');
  }
});

test('必填与非法日期规则阻止保存并定位，编辑保存保留 id 和创建日期', () => {
  const h = setup();
  const p = h.page('household-form');
  p.onSave(); assert.ok(p.data.errors.title); assert.equal(p.data.scrollIntoId, 'hh-title');
  p.setData({ title: '证件', dueDate: '2026-02-30' });
  p.onSave(); assert.ok(p.data.errors.dueDate);
  p.setData({ dueDate: '2026-02-28', repeatRule: 'weekly' });
  p.onSave(); assert.ok(p.data.errors.repeatRule);
  p.setData({ repeatRule: 'none', notes: '字'.repeat(101) });
  p.onSave(); assert.ok(p.data.errors.notes);
  assert.equal(h.writes.length, 0);
  h.cache.set(KEY, [sample()]);
  const edit = h.page('household-form', { id: 'hh-1' });
  edit.setData({ title: '已修改', repeatRule: 'none', notes: '' }); edit.onSave();
  const saved = h.storage.getHousehold('hh-1');
  assert.equal(saved.title, '已修改'); assert.equal(saved.createdAt, 123);
  assert.equal(saved.notes, ''); assert.equal(saved.repeatRule, 'none');
});

test('缺失或编辑期间被删除的事项不可保存复活', () => {
  const h = setup();
  h.cache.set(KEY, [sample()]);
  const edit = h.page('household-form', { id: 'hh-1' });
  h.storage.removeHousehold('hh-1'); edit.onSave();
  assert.equal(edit.data.missing, true);
  assert.equal(h.storage.loadHousehold().length, 0);
  assert.equal(h.storage.upsertHousehold(sample(), true), false);
  const missing = h.page('household-detail', { id: 'missing' });
  assert.equal(missing.data.missing, true);
  missing.onDelete(); assert.equal(h.modals.length, 0);
});

test('删除必须确认；取消不写，失败不返回，成功后列表刷新为空', () => {
  const h = setup();
  h.cache.set(KEY, [sample()]);
  const list = h.page('household');
  const detail = h.page('household-detail', { id: 'hh-1' });
  detail.onDelete(); detail.onDelete(); assert.equal(h.modals.length, 1);
  h.respond(false); assert.equal(h.writes.length, 0); assert.equal(detail.data.deleting, false);
  h.failWrite(); detail.onDelete(); h.respond(true);
  assert.equal(h.storage.loadHousehold().length, 1); assert.equal(h.navigation.length, 0);
  assert.equal(h.toasts.at(-1), '删除失败，请重试');
  h.failWrite(false); detail.onDelete(); h.respond(true);
  assert.equal(h.storage.loadHousehold().length, 0);
  assert.equal(h.toasts.at(-1), '已删除事项');
  list.onShow(); assert.equal(list.data.items.length, 0);
});

test('月末/闰年按原始日期计算，不因读取、重启或跨天自动生成或跳过事项', () => {
  const h = setup();
  assert.equal(h.repeat.occurrenceDate('2026-01-31', 'monthly', 1), '2026-02-28');
  assert.equal(h.repeat.occurrenceDate('2026-01-31', 'monthly', 2), '2026-03-31');
  assert.equal(h.repeat.occurrenceDate('2024-02-29', 'yearly', 1), '2025-02-28');
  assert.equal(h.repeat.occurrenceDate('2024-02-29', 'yearly', 4), '2028-02-29');
  assert.equal(h.repeat.occurrenceDate('2026-01-31', 'none', 1), '');
  assert.equal(h.repeat.occurrenceDate('bad', 'monthly', 1), '');
  h.cache.set(KEY, [sample()]);
  const list = h.page('household');
  assert.equal(list.data.items[0].status.level, 'today');
  h.nextDay(); list.onShow(); list.refresh();
  assert.equal(list.data.items[0].status.level, 'overdue');
  const reopened = h.page('household-detail', { id: 'hh-1' });
  assert.equal(reopened.data.item.dueDate, '2026-01-31');
  assert.equal(h.writes.length, 0); assert.equal(h.cache.get(KEY).length, 1);
});

test('列表按处理日期排序，编辑返回详情更新，主题变化覆盖三个页面', () => {
  const h = setup();
  h.cache.set(KEY, [sample({ id: 'future', dueDate: '2026-05-01' }), sample({ id: 'old', dueDate: '2026-01-01' }), sample()]);
  const list = h.page('household');
  const detail = h.page('household-detail', { id: 'hh-1' });
  const form = h.page('household-form', { id: 'hh-1' });
  assert.deepEqual(plain(list.data.items.map(x => x.id)), ['old', 'hh-1', 'future']);
  form.onDateChange({ detail: { value: '2026-02-28' } });
  assert.equal(form.data.followingDate, '2026-03-28');
  form.onSave(); detail.onShow();
  assert.equal(detail.data.item.dueDate, '2026-02-28');
  h.dark();
  for (const p of [list, detail, form]) { assert.equal(p.data.dark, true); assert.equal(p.data.themeReady, true); }
});

test('清空全部本地数据包含家庭事项键', () => {
  const h = setup();
  h.cache.set(KEY, [sample()]);
  h.cache.set('openkeep_records_v1', []);
  h.cache.set('openkeep_settings_v1', { theme: 'dark' });
  h.cache.set('openkeep_onboarded_v1', true);
  h.storage.clearAllData();
  for (const key of [KEY, 'openkeep_records_v1', 'openkeep_settings_v1', 'openkeep_onboarded_v1']) assert.equal(h.cache.has(key), false);
});

test('看板直接显示已录入的远期事项，事项计数独立于物品统计', () => {
  const h = setup();
  h.cache.set('openkeep_onboarded_v1', true);
  const dashboard = h.page('dashboard');
  assert.equal(dashboard.data.householdOverview.total, 0);
  const form = h.page('household-form');
  form.setData({ title: '护照换证', type: 'document', dueDate: '2027-01-31' });
  form.onSave();
  dashboard.onShow();
  assert.equal(dashboard.data.householdOverview.total, 1);
  assert.equal(dashboard.data.householdOverview.preview[0].title, '护照换证');
  assert.equal(dashboard.data.householdOverview.preview[0].status.level, 'scheduled');
  assert.equal(dashboard.data.total, 0);
  assert.equal(dashboard.data.hasRecords, false);
  assert.equal(dashboard.data.contentReady, true);
});

test('看板统一分组计数互不重复，远期事项可在后续安排展开', () => {
  const h = setup();
  h.cache.set(KEY, [
    sample({ id: 'far', dueDate: '2026-02-08' }),
    sample({ id: 'seven', dueDate: '2026-02-07' }),
    sample({ id: 'tomorrow', dueDate: '2026-02-01' }),
    sample({ id: 'today' }),
    sample({ id: 'old', dueDate: '2026-01-20' })
  ]);
  const dashboard = h.page('dashboard');
  const overview = dashboard.data.householdOverview;
  assert.equal(overview.total, 5);
  assert.equal(overview.overdue, 1); assert.equal(overview.today, 1); assert.equal(overview.upcoming, 2);
  assert.deepEqual(plain(overview.preview.map(item => item.id)), ['old', 'today', 'tomorrow']);
  assert.deepEqual(plain(overview.items.map(item => item.id)), ['old', 'today', 'tomorrow', 'seven', 'far']);
  assert.deepEqual(plain(dashboard.data.reminders.groups.map(group => group.count)), [1, 1, 2]);
  assert.equal(dashboard.data.reminders.later.preview[0].id, 'far');
  dashboard.onToggleLater(); assert.equal(dashboard.data.laterExpanded, true);
  dashboard.onScrollRefresh(); assert.equal(dashboard.data.laterExpanded, true);
  dashboard.onToggleLater(); assert.equal(dashboard.data.laterExpanded, false);
  assert.equal(h.writes.length, 0);
});

test('事项编辑和删除后返回看板立即更新，清空后不残留旧条目', () => {
  const h = setup();
  h.cache.set(KEY, [sample()]);
  const dashboard = h.page('dashboard');
  const form = h.page('household-form', { id: 'hh-1' });
  form.setData({ title: '宽带已续期', dueDate: '2026-02-28' }); form.onSave();
  dashboard.onShow();
  assert.equal(dashboard.data.householdOverview.preview[0].title, '宽带已续期');
  assert.equal(dashboard.data.householdOverview.today, 0);
  h.storage.removeHousehold('hh-1'); dashboard.onShow();
  assert.equal(dashboard.data.householdOverview.total, 0);
  assert.equal(dashboard.data.householdOverview.preview.length, 0);
});

test('事项读取失败不会阻断物品看板，重试恢复；物品筛选不隐藏事项', () => {
  const h = setup();
  h.cache.set(KEY, [sample()]);
  h.cache.set('openkeep_records_v1', [{ id: 'milk', name: '牛奶', category: 'fridge', openedAt: '2026-01-30', shelfLifeValue: 30 }]);
  const dashboard = h.page('dashboard');
  h.failRead(); dashboard.onScrollRefresh();
  assert.equal(dashboard.data.householdError, true);
  assert.equal(dashboard.data.total, 1);
  assert.equal(dashboard.data.list[0].name, '牛奶');
  assert.equal(dashboard.data.stats.safe, 1);
  assert.equal(dashboard.data.refreshing, false);
  h.failRead(false);
  dashboard.setData({ keyword: '不匹配的物品', filter: 'expired' });
  dashboard.onScrollRefresh();
  assert.equal(dashboard.data.householdError, false);
  assert.equal(dashboard.data.householdOverview.total, 1);
  assert.equal(dashboard.data.list.length, 0);
  assert.equal(dashboard.data.keyword, '不匹配的物品');
  assert.equal(dashboard.data.filter, 'expired');
});

test('看板事项可直达详情、新增和管理页；主题切换正常', () => {
  const h = setup();
  const dashboard = h.page('dashboard');
  dashboard.goHouseholdDetail({ currentTarget: { dataset: { id: '家庭&事项' } } });
  dashboard.goAddHousehold(); dashboard.goHousehold();
  assert.deepEqual(h.navigation, [
    '/pages/household-detail/household-detail?id=' + encodeURIComponent('家庭&事项'),
    '/pages/household-form/household-form', '/pages/household/household'
  ]);
  h.dark(); assert.equal(dashboard.data.dark, true);
});

test('看板跨天重新计算今天和超期计数，不推进周期或写入缓存', () => {
  const h = setup();
  h.cache.set(KEY, [sample({ dueDate: '2026-02-01' })]);
  const dashboard = h.page('dashboard');
  assert.equal(dashboard.data.householdOverview.upcoming, 1);
  h.nextDay(); dashboard.onScrollRefresh();
  assert.equal(dashboard.data.householdOverview.today, 1);
  assert.equal(dashboard.data.householdOverview.upcoming, 0);
  h.nextDay(); dashboard.onShow();
  assert.equal(dashboard.data.householdOverview.overdue, 1);
  assert.equal(dashboard.data.householdOverview.today, 0);
  assert.equal(h.storage.getHousehold('hh-1').dueDate, '2026-02-01');
  assert.equal(h.writes.length, 0);
});
