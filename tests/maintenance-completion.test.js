// 无第三方依赖：node --test tests/maintenance-completion.test.js
// 隔离微信 API，实际加载详情页、storage、record、maintenance、date 模块。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(overrides = {}, now = new Date(2026, 0, 31, 12)) {
  let definition;
  let modal;
  let failSave = false;
  let writes = 0;
  let modalCount = 0;
  let clock = now.getTime();
  const cache = new Map();
  const toasts = [];
  const app = { isDark: () => false, globalData: { settings: { warningDays: 7 } } };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const context = vm.createContext({
    Date: FixedDate,
    console,
    getApp: () => app,
    Page: value => { definition = value; },
    wx: {
      getStorageSync: key => cache.get(key),
      setStorageSync: (key, value) => {
        if (failSave) throw new Error('storage full');
        writes++;
        cache.set(key, JSON.parse(JSON.stringify(value)));
      },
      getFileSystemManager: () => ({ accessSync() {} }),
      showModal: options => { modal = options; modalCount++; },
      showToast: options => toasts.push(options.title),
      addPhoneCalendar: () => assert.fail('完成维护不得写入系统日历'),
      authorize: () => assert.fail('完成维护不得申请日历权限')
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
  const record = storage.normalizeRecord(Object.assign({
    id: 'maintenance-test', name: '净水器', location: '厨房', category: 'other',
    openedAt: '2025-01-01', photoPath: '/saved/photo.jpg', notes: '保留备注',
    maintenanceLast: '2025-12-01', maintenanceCycle: 'monthly',
    calendarImported: true, calendarImportedAt: 12345, calendarReminderDays: 3,
    createdAt: 100, updatedAt: 200
  }, overrides));
  storage.upsertRecord(record);
  writes = 0;
  load(path.join(root, 'pages/item-detail/item-detail.js'));
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value); }
  });
  page.data.id = record.id;
  page.refresh();
  return {
    page, storage, toasts,
    get record() { return storage.getRecord(record.id); },
    get writes() { return writes; },
    get modalCount() { return modalCount; },
    get modal() { return modal; },
    failSave() { failSave = true; },
    nextDay() { clock += 86400000; },
    respond(confirm) { modal.success({ confirm }); modal.complete(); }
  };
}

test('确认后从实际完成日重算，月末收敛；保留照片、其他记录字段及日历标记', () => {
  const h = setup();
  const before = JSON.parse(JSON.stringify(h.record));
  h.page.onCompleteMaintenance();
  assert.match(h.modal.content, /2026-02-28/);
  assert.equal(h.writes, 0);
  h.respond(true);
  assert.equal(h.record.maintenanceLast, '2026-01-31');
  assert.equal(h.page.data.maintenance.nextDate, '2026-02-28');
  assert.equal(h.page.data.maintenance.overdue, false);
  assert.equal(h.page.data.maintenanceDoneToday, true);
  assert.equal(h.page.data.completingMaintenance, false);
  assert.equal(h.writes, 1);
  const expected = Object.assign({}, before, { maintenanceLast: '2026-01-31', updatedAt: new Date(2026, 0, 31, 12).getTime() });
  assert.deepEqual(JSON.parse(JSON.stringify(h.record)), expected);
  assert.equal(h.toasts.at(-1), '已完成维护');
});

test('取消不写入，连点只开一个弹窗，当天重复操作不推进第二个周期', () => {
  const h = setup();
  h.page.onCompleteMaintenance();
  h.page.onCompleteMaintenance();
  assert.equal(h.modalCount, 1);
  h.respond(false);
  assert.equal(h.writes, 0);
  assert.equal(h.record.maintenanceLast, '2025-12-01');
  assert.equal(h.page.data.completingMaintenance, false);
  h.page.onCompleteMaintenance();
  h.respond(true);
  h.page.onCompleteMaintenance();
  assert.equal(h.modalCount, 2);
  assert.equal(h.writes, 1);
  assert.equal(h.toasts.at(-1), '今天已记录维护');
});

test('存储失败保留原日期和页面状态，可重试；不显示成功', () => {
  const h = setup();
  const nextBefore = h.page.data.maintenance.nextDate;
  h.failSave();
  h.page.onCompleteMaintenance();
  h.respond(true);
  assert.equal(h.record.maintenanceLast, '2025-12-01');
  assert.equal(h.page.data.maintenance.nextDate, nextBefore);
  assert.equal(h.page.data.maintenanceDoneToday, false);
  assert.equal(h.page.data.completingMaintenance, false);
  assert.equal(h.toasts.at(-1), '保存失败，请重试');
  assert.equal(h.writes, 0);
});

test('闰日按年维护收敛为下一年的二月末', () => {
  const h = setup({ maintenanceCycle: 'yearly', maintenanceLast: '2023-02-28' }, new Date(2024, 1, 29, 12));
  h.page.onCompleteMaintenance();
  h.respond(true);
  assert.equal(h.page.data.maintenance.nextDate, '2025-02-28');
});

test('提前完成、自定义天数均从今天起算；到期与保修状态保持不变', () => {
  const h = setup({ maintenanceCycle: 'custom', maintenanceCycleDays: 10, maintenanceLast: '2026-01-30', shelfLifeValue: 2, shelfLifeUnit: 'year', warrantyEnd: '2027-12-31' });
  const status = JSON.stringify(h.page.data.status);
  const warranty = JSON.stringify(h.page.data.warranty);
  h.page.onCompleteMaintenance();
  h.respond(true);
  assert.equal(h.page.data.maintenance.nextDate, '2026-02-10');
  assert.equal(JSON.stringify(h.page.data.status), status);
  assert.equal(JSON.stringify(h.page.data.warranty), warranty);
});

test('未设置维护的旧记录和日历写入中均不能完成维护', () => {
  const legacy = setup({ maintenanceLast: undefined, maintenanceCycle: undefined });
  legacy.page.onCompleteMaintenance();
  assert.equal(legacy.modalCount, 0);
  assert.equal(legacy.writes, 0);
  const busy = setup();
  busy.page.data.writing = true;
  busy.page.onCompleteMaintenance();
  assert.equal(busy.modalCount, 0);
});

test('确认期间更新其他字段，完成时保留最新数据', () => {
  const h = setup();
  h.page.onCompleteMaintenance();
  h.storage.upsertRecord(Object.assign({}, h.record, { notes: '最新备注' }));
  h.respond(true);
  assert.equal(h.record.notes, '最新备注');
  assert.equal(h.record.maintenanceLast, '2026-01-31');
});

test('确认期间删除记录或修改周期，不复活记录、不覆盖新周期', () => {
  const deleted = setup();
  deleted.page.onCompleteMaintenance();
  deleted.storage.removeRecord(deleted.record.id);
  deleted.respond(true);
  assert.equal(deleted.record, null);
  assert.equal(deleted.page.data.missing, true);
  const changed = setup();
  changed.page.onCompleteMaintenance();
  changed.storage.upsertRecord(Object.assign({}, changed.record, { maintenanceCycle: 'yearly' }));
  changed.respond(true);
  assert.equal(changed.record.maintenanceCycle, 'yearly');
  assert.equal(changed.record.maintenanceLast, '2025-12-01');
  assert.equal(changed.toasts.at(-1), '记录或日期已变化，请重试');
});

test('确认期间跨零点要求重新确认，隔天进入页面允许新一次完成', () => {
  const h = setup();
  h.page.onCompleteMaintenance();
  h.nextDay();
  h.respond(true);
  assert.equal(h.writes, 0);
  h.page.onCompleteMaintenance();
  h.respond(true);
  assert.equal(h.record.maintenanceLast, '2026-02-01');
  assert.equal(h.page.data.maintenance.nextDate, '2026-03-01');
  h.nextDay();
  h.page.refresh();
  assert.equal(h.page.data.maintenanceDoneToday, false);
});

test('弹窗失败解除处理中状态并提示重试', () => {
  const h = setup();
  h.page.onCompleteMaintenance();
  h.modal.fail();
  h.modal.complete();
  assert.equal(h.page.data.completingMaintenance, false);
  assert.equal(h.writes, 0);
  assert.equal(h.toasts.at(-1), '暂时无法确认，请重试');
});
