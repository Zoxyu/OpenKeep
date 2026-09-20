// 隔离微信 API，实际加载表单、存储规范化及日期/维护计算。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(origin) {
  let definition;
  let writes = 0;
  let hides = 0;
  const cache = new Map();
  const context = vm.createContext({
    console, setTimeout: () => 1, clearTimeout() {},
    getApp: () => ({ isDark: () => false, onTheme: () => () => {}, syncPageChrome() {} }),
    Page: value => { definition = value; },
    wx: {
      getStorageSync: key => cache.get(key),
      setStorageSync: (key, value) => { cache.set(key, JSON.parse(JSON.stringify(value))); writes++; },
      onKeyboardHeightChange() {}, offKeyboardHeightChange() {},
      hideKeyboard() { hides++; }, setNavigationBarTitle() {}, showToast() {}, navigateBack() {},
      getFileSystemManager: () => ({ accessSync() {} })
    }
  });
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const run = vm.runInContext('(function(require, module, exports) {\n' + fs.readFileSync(filename, 'utf8') + '\n})', context, { filename });
    run(relative => load(path.resolve(path.dirname(filename), relative + '.js')), module, module.exports);
    return module.exports;
  }
  const root = path.resolve(__dirname, '../miniprogram');
  const storage = load(path.join(root, 'utils/storage.js'));
  const recordUtil = load(path.join(root, 'utils/record.js'));
  if (origin) storage.upsertRecord(Object.assign({ id: 'existing', name: '已有物品', openedAt: '2026-09-01' }, origin));
  writes = 0;
  load(path.join(root, 'pages/item-form/item-form.js'));
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); }
  });
  page.onLoad(origin ? { id: 'existing' } : {});
  if (!origin) page.setData({ name: '测试物品' });
  return { page, storage, recordUtil, get writes() { return writes; }, get hides() { return hides; } };
}
const switchTo = (page, tab) => page.onEntryTabTap({ currentTarget: { dataset: { tab } } });

test('新建不能仅填位置、购买信息或未设置周期的维护日期', () => {
  for (const fields of [{}, { location: '厨房' }, { purchaseDate: '2026-09-01', purchasePrice: '99' }, { maintenanceLast: '2026-09-01' }]) {
    const h = setup();
    h.page.setData(fields);
    h.page.onSave();
    assert.ok(h.page.data.errors.recordType);
    assert.equal(h.page.data.scrollIntoId, 'f-entry');
    assert.equal(h.writes, 0);
  }
});

test('保质期、使用后可用天数、保修、三种维护周期均能独立保存，位置可留空', () => {
  for (const fields of [
    { shelfLifeValue: '12', shelfLifeUnit: 'month' }, { openedDays: '30' },
    { warrantyEnd: '2027-09-01' },
    ...['monthly', 'yearly', 'custom'].map(cycle => ({ maintenanceLast: '2026-09-01', maintenanceCycle: cycle, maintenanceCycleDays: '180' }))
  ]) {
    const h = setup();
    h.page.setData(fields);
    h.page.onSave();
    assert.deepEqual(Object.keys(h.page.data.errors), []);
    assert.equal(h.writes, 1);
    const saved = h.storage.loadRecords()[0];
    assert.equal(saved.location, '');
    assert.equal(saved.category, fields.shelfLifeValue || fields.openedDays ? 'fridge' : 'other');
    if (fields.maintenanceCycle) assert.equal(h.recordUtil.getMaintenanceInfo(saved).active, true);
  }
});

test('不完整或非法维保不能保存，即使其他栏有效；错误自动展开维保栏', () => {
  for (const fields of [
    { maintenanceCycle: 'monthly' },
    { maintenanceCycle: 'yearly', maintenanceLast: '2026-02-30' },
    { maintenanceCycle: 'invalid', maintenanceLast: '2026-09-01' },
    ...['', '0', '1.5', '3651'].map(days => ({ maintenanceCycle: 'custom', maintenanceLast: '2026-09-01', maintenanceCycleDays: days }))
  ]) {
    const h = setup();
    h.page.setData(Object.assign({ shelfLifeValue: '30' }, fields));
    h.page.onSave();
    assert.equal(h.writes, 0);
    assert.equal(h.page.data.entryTab, 'maintenance');
    assert.match(h.page.data.scrollIntoId, /^f-(mlast|cycle|mdays)$/);
  }
});

test('切栏保留三类及通用信息，保存持久化所有栏且不新增类型字段', () => {
  const h = setup();
  h.page.setData({ shelfLifeValue: '12', shelfLifeUnit: 'month', openedDays: '30', photoPath: '/saved/photo.jpg', location: '储物柜', notes: '保留备注' });
  switchTo(h.page, 'warranty');
  h.page.setData({ warrantyEnd: '2027-09-01', purchaseDate: '2026-09-01', purchasePrice: '2999.50' });
  switchTo(h.page, 'maintenance');
  h.page.setData({ maintenanceLast: '2026-09-01', maintenanceCycle: 'custom', maintenanceCycleDays: '180' });
  switchTo(h.page, 'shelf');
  h.page.onSave();
  assert.equal(h.writes, 1);
  const saved = h.storage.loadRecords()[0];
  for (const [key, value] of Object.entries({ shelfLifeValue: 12, shelfLifeUnit: 'month', openedDays: 30,
    photoPath: '/saved/photo.jpg', location: '储物柜', notes: '保留备注', warrantyEnd: '2027-09-01',
    purchaseDate: '2026-09-01', purchasePrice: 2999.5, maintenanceLast: '2026-09-01', maintenanceCycle: 'custom', maintenanceCycleDays: 180 })) {
    assert.equal(saved[key], value, key);
  }
  assert.equal(saved.entryTab, undefined);
});

test('编辑按已有信息展开对应栏，切到空栏保存也保留日期和日历标记', () => {
  for (const [fields, tab] of [
    [{ shelfLifeValue: 30, warrantyEnd: '2027-09-01' }, 'shelf'],
    [{ shelfLifeDays: 20 }, 'shelf'],
    [{ warrantyEnd: '2027-09-01', category: 'cosmetics' }, 'warranty'],
    [{ maintenanceLast: '2026-09-01', maintenanceCycle: 'monthly' }, 'maintenance']
  ]) {
    const h = setup(Object.assign({ calendarImported: true, calendarImportedAt: 123, photoPath: '/saved/photo.jpg' }, fields));
    const before = JSON.parse(JSON.stringify(h.storage.getRecord('existing')));
    assert.equal(h.page.data.entryTab, tab);
    switchTo(h.page, tab === 'shelf' ? 'warranty' : 'shelf');
    h.page.onSave();
    assert.equal(h.writes, 1);
    const saved = JSON.parse(JSON.stringify(h.storage.getRecord('existing')));
    delete before.updatedAt; delete saved.updatedAt;
    assert.deepEqual(saved, before);
  }
});

test('旧位置备忘可编辑保存；普通记录清空三类后不能降为纯位置记录', () => {
  const old = setup({ location: '抽屉' });
  assert.equal(old.page.data.legacyMemo, true);
  old.page.setData({ notes: '新备注' });
  old.page.onSave();
  assert.equal(old.writes, 1);
  assert.equal(old.storage.getRecord('existing').notes, '新备注');
  const typed = setup({ location: '抽屉', warrantyEnd: '2027-09-01' });
  typed.page.setData({ warrantyEnd: '' });
  typed.page.onSave();
  assert.equal(typed.writes, 0);
  assert.ok(typed.page.data.errors.recordType);
});

test('隐藏栏内的保质期、保修、购买价格错误定位到可见字段', () => {
  for (const [fields, tab, id] of [
    [{ shelfLifeValue: '0', entryTab: 'warranty' }, 'shelf', 'f-shelf'],
    [{ shelfLifeValue: '30', openedAt: '2026-02-30', entryTab: 'maintenance' }, 'shelf', 'f-start'],
    [{ warrantyEnd: '2026-02-30' }, 'warranty', 'f-warranty'],
    [{ shelfLifeValue: '30', purchasePrice: '-1' }, 'warranty', 'f-price']
  ]) {
    const h = setup();
    h.page.setData(fields);
    h.page.onSave();
    assert.equal(h.writes, 0);
    assert.equal(h.page.data.entryTab, tab);
    assert.equal(h.page.data.scrollIntoId, id);
  }
});

test('切栏收起键盘并清除滚动目标，非法切栏或保存中不响应', () => {
  const h = setup();
  h.page.setData({ kbHeight: 300, scrollIntoId: 'f-shelf' });
  switchTo(h.page, 'warranty');
  assert.equal(h.page.data.kbHeight, 0);
  assert.equal(h.page.data.scrollIntoId, '');
  assert.equal(h.hides, 1);
  switchTo(h.page, 'invalid');
  assert.equal(h.page.data.entryTab, 'warranty');
  h.page.setData({ saving: true });
  switchTo(h.page, 'maintenance');
  assert.equal(h.page.data.entryTab, 'warranty');
});
