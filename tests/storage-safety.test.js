// 在隔离内存中制造微信缓存读取/写入异常；不访问真实用户数据。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KEY = 'openkeep_records_v1';
const clone = value => JSON.parse(JSON.stringify(value));
const item = (id, fields = {}) => Object.assign({
  id, name: '物品 ' + id, openedAt: '2026-09-01', shelfLifeValue: 30,
  photoPath: '/saved/' + id + '.jpg', createdAt: 1, updatedAt: 2
}, fields);

function setup(initial = [item('a'), item('b')]) {
  let definition;
  let readFailure = false;
  let writeFailure = false;
  let readHook;
  let reads = 0;
  let writes = 0;
  let backs = 0;
  let copies = 0;
  let timerId = 0;
  const cache = new Map();
  if (initial !== undefined) cache.set(KEY, clone(initial));
  const removed = [];
  const modals = [];
  const toasts = [];
  const timers = new Map();
  const context = vm.createContext({
    console,
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
    getApp: () => ({
      isDark: () => false, onTheme: () => () => {}, syncPageChrome() {},
      globalData: { settings: { warningDays: 7 } }
    }),
    Page: value => { definition = value; },
    wx: {
      getStorageSync(key) {
        if (key === KEY) {
          reads++;
          if (readHook) readHook(reads);
          if (readFailure) throw new Error('temporary read failure');
        }
        return cache.get(key);
      },
      setStorageSync(key, value) {
        if (writeFailure) throw new Error('storage full');
        writes++;
        cache.set(key, clone(value));
      },
      onKeyboardHeightChange() {}, offKeyboardHeightChange() {}, setNavigationBarTitle() {},
      showModal: options => modals.push(options),
      showToast: options => toasts.push(options.title),
      navigateBack() { backs++; },
      canIUse: () => true,
      env: { USER_DATA_PATH: '/saved' },
      getFileSystemManager: () => ({
        accessSync() {},
        unlinkSync(file) { removed.push(file); },
        copyFile(options) { copies++; options.success(); }
      })
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
  return {
    storage, cache, removed, modals, toasts,
    get rows() { return clone(cache.get(KEY)); },
    get writes() { return writes; }, get backs() { return backs; }, get copies() { return copies; },
    failReads(value = true) { readFailure = value; },
    failWrites(value = true) { writeFailure = value; },
    onRead(hook) { reads = 0; readHook = hook; },
    runTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
    respond(confirm, modal = modals.at(-1)) {
      modal.success({ confirm });
      if (modal.complete) modal.complete();
    },
    page(name, id = 'a') {
      load(path.join(root, 'pages', name, name + '.js'));
      const page = Object.assign({}, definition, {
        data: clone(definition.data),
        setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); }
      });
      page.onLoad(id ? { id } : {});
      if (name === 'item-detail') page.refresh();
      return page;
    }
  };
}

test('物品三个写入口均拒绝读取异常，原有 A/B 不被空列表覆盖', () => {
  const h = setup();
  const before = h.rows;
  h.failReads();
  assert.equal(h.storage.upsertRecord(item('c')), false);
  assert.equal(h.storage.removeRecord('a'), false);
  assert.equal(h.storage.saveRecords([item('c')]), false);
  assert.equal(h.writes, 0);
  assert.deepEqual(h.rows, before);
});

test('非数组缓存拒绝写入，包括 null；缺失键仍可新增', () => {
  for (const invalid of [null, {}, 'broken', 123, false]) {
    const h = setup(invalid);
    assert.equal(h.storage.upsertRecord(item('c')), false);
    assert.equal(h.storage.removeRecord('a'), false);
    assert.equal(h.storage.saveRecords([item('c')]), false);
    assert.equal(h.writes, 0);
    assert.deepEqual(h.rows, invalid);
  }
  for (const missing of ['', undefined]) {
    const h = setup([]);
    h.cache.set(KEY, missing);
    assert.equal(h.storage.upsertRecord(item('new')), true);
    assert.equal(h.rows[0].id, 'new');
  }
  const h = setup();
  assert.equal(h.storage.saveRecords(null), false);
  assert.equal(h.writes, 0);
});

test('增删改只改变目标原始行，其余无效条目及未知字段原样保留', () => {
  const others = [null, 'legacy', 9, { id: 'bad', name: '', unknown: ['keep'] }, item('b', { futureField: { nested: true } })];
  const h = setup([item('a', { futureField: 'target keep' }), ...others]);
  assert.equal(h.storage.upsertRecord(item('a', { name: '改名' }), true), true);
  assert.equal(h.rows[0].futureField, 'target keep');
  assert.deepEqual(h.rows.slice(1), others);
  assert.equal(h.storage.upsertRecord(item('c')), true);
  assert.deepEqual(h.rows.slice(1, -1), others);
  assert.equal(h.storage.removeRecord('a'), true);
  assert.deepEqual(h.rows.slice(0, -1), others);
  assert.equal(h.rows.at(-1).id, 'c');
});

test('编辑 mustExist 与删除目标不存在时不写入，写入失败保留原数据可重试', () => {
  const h = setup();
  const before = h.rows;
  assert.equal(h.storage.upsertRecord(item('gone'), true), false);
  assert.equal(h.storage.removeRecord('gone'), false);
  assert.equal(h.storage.removeRecord(''), false);
  h.failWrites();
  assert.equal(h.storage.upsertRecord(item('a', { name: '修改' }), true), false);
  assert.equal(h.storage.removeRecord('a'), false);
  assert.equal(h.writes, 0);
  assert.deepEqual(h.rows, before);
  h.failWrites(false);
  assert.equal(h.storage.removeRecord('a'), true);
  assert.deepEqual(h.rows, [before[1]]);
});

test('新建最终读取失败保留表单、照片草稿与其他记录，重试不重复复制', async () => {
  const h = setup();
  const page = h.page('item-form', '');
  const before = h.rows;
  page.setData({ name: '新物品', shelfLifeValue: '30', tempPhoto: '/temp/new.jpg' });
  h.failReads();
  await page.onSave();
  const draft = page.data.photoPath;
  assert.equal(page.data.saving, false);
  assert.equal(page.data.name, '新物品');
  assert.equal(h.modals.at(-1).title, '保存失败');
  assert.deepEqual(h.rows, before);
  assert.deepEqual(h.removed, []);
  assert.deepEqual(h.toasts, []);
  h.runTimers();
  assert.equal(h.backs, 0);
  h.failReads(false);
  await page.onSave();
  assert.equal(h.copies, 1);
  assert.equal(h.rows.length, 3);
  assert.deepEqual(h.rows.slice(0, 2), before);
  assert.equal(h.rows[2].photoPath, draft);
  page.onUnload();
  assert.deepEqual(h.removed, []);
});

test('编辑前置读取成功、最终读取失败仍拒绝写入；目标被删除也不会复活', () => {
  for (const mode of ['read-failure', 'deleted']) {
    const h = setup();
    const page = h.page('item-form');
    const before = h.rows;
    page.setData({ name: '修改后的名称' });
    h.onRead(read => {
      if (read !== 2) return;
      if (mode === 'read-failure') h.failReads();
      else h.cache.set(KEY, [before[1]]);
    });
    page.onSave();
    assert.equal(h.writes, 0);
    assert.equal(page.data.saving, false);
    assert.equal(h.modals.at(-1).title, '保存失败');
    assert.deepEqual(h.rows, mode === 'deleted' ? [before[1]] : before);
    assert.deepEqual(h.removed, []);
    assert.deepEqual(h.toasts, []);
  }
});

test('编辑保存从最新记录合并，保留打开表单后更新的日历元数据', () => {
  const h = setup();
  const page = h.page('item-form');
  const rows = h.rows;
  Object.assign(rows[0], {
    calendarImported: true, calendarImportedAt: 456, calendarReminderDays: 7,
    calendarEntries: [{ kind: 'due', dueDate: '2026-10-01', importedAt: 456, reminderDays: 7 }],
    calendarLegacyUnknown: false
  });
  h.cache.set(KEY, rows);
  page.setData({ name: '新名称' });
  page.onSave();
  const saved = h.rows[0];
  assert.equal(saved.name, '新名称');
  assert.equal(saved.calendarImported, true);
  assert.equal(saved.calendarImportedAt, 456);
  assert.equal(saved.calendarReminderDays, 7);
  assert.deepEqual(saved.calendarEntries, rows[0].calendarEntries);
  assert.deepEqual(h.rows[1], rows[1]);
});

for (const name of ['item-form', 'item-detail']) {
  test(name + ' 删除读写失败不提示成功、不删照片、不退出，重试成功才清理', () => {
    for (const mode of ['read', 'write', 'final-read']) {
      const h = setup();
      const page = h.page(name);
      const before = h.rows;
      page.onDelete();
      if (mode === 'read') h.failReads();
      else if (mode === 'write') h.failWrites();
      else h.onRead(read => { if (read === 2) h.failReads(); });
      h.respond(true);
      assert.equal(h.writes, 0);
      assert.deepEqual(h.rows, before);
      assert.deepEqual(h.removed, []);
      assert.ok(!h.toasts.includes('已删除'));
      h.runTimers();
      assert.equal(h.backs, 0);
      h.failReads(false); h.failWrites(false); h.onRead(null);
      page.onDelete();
      h.respond(true);
      assert.equal(h.writes, 1);
      assert.deepEqual(h.rows, [before[1]]);
      assert.deepEqual(h.removed, ['/saved/a.jpg']);
      assert.ok(h.toasts.includes('已删除'));
      h.runTimers();
      assert.equal(h.backs, 1);
    }
  });

  test(name + ' 删除使用确认时最新照片；目标已消失时不误删旧照片', () => {
    for (const missing of [false, true]) {
      const h = setup();
      const page = h.page(name);
      page.onDelete();
      const rows = h.rows;
      rows[0].photoPath = '/saved/latest.jpg';
      h.cache.set(KEY, missing ? [rows[1]] : rows);
      h.respond(true);
      assert.deepEqual(h.removed, missing ? [] : ['/saved/latest.jpg']);
      assert.equal(h.writes, missing ? 0 : 1);
      assert.equal(h.toasts.includes('已删除'), !missing);
    }
  });

  test(name + ' 删除确认防连点、取消可重试，退出后回调和导航均失效', () => {
    const h = setup();
    const page = h.page(name);
    page.onDelete(); page.onDelete();
    assert.equal(h.modals.length, 1);
    h.respond(false);
    assert.equal(h.writes, 0);
    assert.deepEqual(h.removed, []);
    page.onDelete();
    assert.equal(h.modals.length, 2);
    const pending = h.modals.at(-1);
    page.onUnload();
    h.respond(true, pending);
    page.onDelete();
    h.runTimers();
    assert.equal(h.writes, 0);
    assert.deepEqual(h.removed, []);
    assert.equal(h.backs, 0);
    assert.ok(!h.toasts.includes('已删除'));

    const success = setup();
    const successfulPage = success.page(name);
    successfulPage.onDelete(); success.respond(true);
    successfulPage.onUnload(); success.runTimers();
    assert.equal(success.backs, 0);
  });
}

test('编辑表单删除确认与保存互斥，保存期间也不能触发删除', () => {
  const h = setup();
  const page = h.page('item-form');
  page.onDelete(); page.onSave();
  assert.equal(h.writes, 0);
  assert.equal(h.modals.length, 1);
  h.respond(false);
  page.setData({ saving: true });
  page.onDelete();
  assert.equal(h.modals.length, 1);
});
