const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plain = v => JSON.parse(JSON.stringify(v));
const HH = 'openkeep_household_v1', RR = 'openkeep_records_v1';
function setup() {
  const cache = new Map(), modals = [], toasts = [], navigation = [], events = [], writes = [], themes = [], timers = [], actionSheets = [];
  let platform = 'android';
  let definition, failRead = '', failWrite = false, supported = true, auth = true, grant = true;
  let now = new Date(2026, 0, 31, 12).getTime();
  class Clock extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  const context = vm.createContext({ Date: Clock, console, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    getApp: () => ({ isDark: () => false, globalData: { settings: { warningDays: 7 } }, syncPageChrome() {}, onTheme(fn) { themes.push(fn); return () => {}; } }),
    Page: p => { definition = p; }, wx: {
      getStorageSync(k) { if (k === failRead) throw Error('read failure'); return cache.get(k); },
      setStorageSync(k,v) { if (failWrite) throw Error('full'); cache.set(k,plain(v)); writes.push(k); },
      removeStorageSync: k => cache.delete(k), canIUse: () => supported,
      getSetting: o => o.success({ authSetting: { 'scope.addPhoneCalendar': auth } }),
      authorize: o => grant ? o.success() : o.fail(), getSystemInfoSync: () => ({ platform }),
      showActionSheet: o => actionSheets.push(o),
      showModal: o => modals.push(o), showToast: o => toasts.push(o.title),
      addPhoneCalendar: o => events.push(o), navigateTo: o => navigation.push(o.url), navigateBack: () => navigation.push('back'),
      getFileSystemManager: () => ({ accessSync() {}, unlinkSync() {} }), env: { USER_DATA_PATH: '/saved' },
      onKeyboardHeightChange() {}, offKeyboardHeightChange() {}, setNavigationBarTitle() {}
    }
  });
  const root = path.resolve(__dirname, '../miniprogram'), modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file,module);
    const fn = vm.runInContext('(function(require,module,exports){\n'+fs.readFileSync(file,'utf8')+'\n})',context,{filename:file});
    fn(p => load(path.resolve(path.dirname(file),p.endsWith('.js') ? p : p+'.js')),module,module.exports); return module.exports;
  }
  const storage = load(path.join(root,'utils/storage.js')), processing = load(path.join(root,'utils/processing.js')), calendar = load(path.join(root,'utils/calendar.js'));
  const record = load(path.join(root,'utils/record.js')), summary = load(path.join(root,'utils/summary.js'));
  function page(name, query={}) {
    const file=path.join(root,'pages',name,name+'.js');modules.delete(file);load(file);
    const p=Object.assign({},definition,{data:plain(definition.data),setData(v,cb){for(const [key,value] of Object.entries(v)) {
      const match = key.match(/^items\[(\d+)\]\.checked$/);
      if (match) this.data.items[Number(match[1])].checked=value; else this.data[key]=value;
    }if(cb)cb();}});
    p.onLoad(query);p.onShow();return p;
  }
  return { platform(v){platform=v;}, cache, modals, toasts, navigation, events, writes, actionSheets, storage, processing, calendar, record, summary, page,
    hh(p={}) { const v=Object.assign({id:'hh',title:'宽带续费',type:'bill',dueDate:'2026-01-31',repeatRule:'monthly',notes:''},p);storage.upsertHousehold(v);return storage.getHousehold(v.id); },
    rec(p={}) { const v=Object.assign({id:'rec',name:'测试物品',openedAt:'2026-01-01',photoPath:'/saved/a.jpg',notes:'保留备注'},p);storage.upsertRecord(v);return storage.getRecord(v.id); },
    finish(source,id,kind,next) { const v=processing.get(source,id);return processing.complete(source,id,processing.revision(v,source),kind,next); },
    runTimers() { timers.splice(0).forEach(fn => fn()); },
    respond(value) { const o=modals.at(-1);o.success({confirm:value});if(o.complete)o.complete(); },
    failRead(k) {failRead=k;}, failWrite(v=true) {failWrite=v;}, unsupported(){supported=false;}, auth(v,g=true){auth=v;grant=g;},
    nextDay(){now+=86400000;}, dark(){themes.forEach(f=>f(true));}
  };
}
const flush = async () => { for(let n=0;n<12;n++) await Promise.resolve(); };
const mixed = { openedDays: 40, warrantyEnd: '2026-02-10', maintenanceLast: '2026-01-01', maintenanceCycle: 'monthly' };
function mark(h, kind) {
  const record = h.storage.getRecord('rec');
  const entry = h.record.calendarEntries(record).find(e => e.kind === kind);
  h.storage.updateExisting('record', 'rec', latest => h.calendar.markItemImported(latest, entry, 3));
  return entry;
}
function change(h, patch) { h.storage.upsertRecord(Object.assign({}, h.storage.getRecord('rec'), patch), true); }
function choose(page, kind) {
  const index = page.data.calendarEntries.findIndex(e => e.kind === kind);
  assert.notEqual(index, -1);
  page.onCalendarKindChange({ detail: { value: index } });
}

test('日历回执按类别/规范日期去重；非法回执不生效；旧布尔值仅作为待核对', () => {
  const h=setup();
  h.cache.set(RR,[{id:'rec',name:'旧物品',openedAt:'2026-01-01',...mixed,calendarImported:true}]);
  let r=h.storage.getRecord('rec');
  assert.equal(r.calendarLegacyUnknown,true);
  assert.equal(h.record.calendarEntries(r).every(e=>!e.imported&&e.legacyUnknown),true);
  change(h,{calendarEntries:[
    {kind:'due',dueDate:'2026-2-10',importedAt:1,reminderDays:3},
    {kind:'due',dueDate:'2026-02-10',importedAt:2,reminderDays:99},
    {kind:'other',dueDate:'2026-02-10',importedAt:3},
    {kind:'warranty',dueDate:'2026-02-31',importedAt:3},
    {kind:'maintenance',dueDate:'2026-02-01',importedAt:'bad'}
  ]});
  r=h.storage.getRecord('rec');
  assert.deepEqual(plain(r.calendarEntries),[{kind:'due',dueDate:'2026-02-10',importedAt:2,reminderDays:1}]);
  const entries=h.record.calendarEntries(r);
  assert.equal(entries.find(e=>e.kind==='due').imported,true);
  assert.equal(entries.find(e=>e.kind==='warranty').legacyUnknown,true);
});

test('混合物品列出三类提醒，同日不同类别 key 唯一；只跳过对应本期回执', () => {
  const h=setup();h.rec(mixed);mark(h,'due');
  const p=h.page('calendar-import');
  assert.equal(p.data.items.length,3);
  assert.equal(new Set(p.data.items.map(e=>e.key)).size,3);
  assert.equal(p.data.items.find(e=>e.kind==='due').disabled,true);
  assert.equal(p.data.items.filter(e=>e.checked).length,2);
  assert.equal(h.record.withStatus([h.storage.getRecord('rec')],7)[0].calendarLabel,'部分已入日历');
  p.onSkipChange({detail:{value:false}});
  assert.equal(p.data.items.some(e=>e.disabled),false);
  p.onToggleAll();assert.equal(p.data.checkedCount,3);
  p.onSkipChange({detail:{value:true}});assert.equal(p.data.checkedCount,2);
});

test('维保推进下一期可默认选中，旧回执保留；撤销维护恢复旧期已添加状态', () => {
  const h=setup();h.rec({maintenanceLast:'2025-12-31',maintenanceCycle:'monthly'});mark(h,'maintenance');
  assert.equal(h.finish('record','rec','maintenance'),true);
  let p=h.page('calendar-import'),r=h.storage.getRecord('rec');
  assert.equal(p.data.items[0].dueDate,'2026-02-28');
  assert.equal(p.data.items[0].disabled,false);assert.equal(p.data.items[0].checked,true);
  assert.equal(r.calendarEntries[0].dueDate,'2026-01-31');
  assert.equal(h.record.withStatus([r],7)[0].calendarLabel,'');
  const a=h.page('archive');a.onUndo({currentTarget:{dataset:{key:a.data.items[0].key}}});h.respond(true);
  p=h.page('calendar-import');assert.equal(p.data.items[0].disabled,true);
});

test('修改业务日期只改变相应提醒的本期状态；保修处理与整件归档不再列候选', () => {
  const h=setup();h.rec(mixed);['due','warranty','maintenance'].forEach(k=>mark(h,k));
  change(h,{warrantyEnd:'2026-02-11'});
  let p=h.page('calendar-import');assert.equal(p.data.checkedCount,1);
  assert.equal(p.data.items.find(e=>e.checked).kind,'warranty');
  h.finish('record','rec','warranty');p.buildList();assert.equal(p.data.items.length,2);
  h.finish('record','rec','consumed');p.buildList();assert.equal(p.data.items.length,0);
});

test('单条详情切换类别写入对应日期，连续添加不会覆盖其他类别回执', async () => {
  const h=setup();h.rec(mixed);const p=h.page('item-detail',{id:'rec'});
  for(const kind of ['warranty','maintenance']) {
    choose(p,kind);const entry=p.data.calendarEntry;
    const job=p.onAddCalendar();p.onAddCalendar();await flush();
    const evt=h.events.at(-1);assert.match(evt.description,new RegExp(entry.dueDate));
    assert.match(evt.title,kind==='warranty'?/保修/:/维护/);
    evt.success();await job;assert.equal(p.data.calendarEntry.imported,true);
  }
  assert.equal(h.events.length,2);assert.equal(h.storage.getRecord('rec').calendarEntries.length,2);
  choose(p,'due');assert.equal(p.data.calendarEntry.imported,false);
});

test('新回执的重复添加先确认，取消不写入；旧数据默认不选并且仍可核对后添加', async () => {
  const h=setup();h.rec(mixed);mark(h,'due');
  let p=h.page('item-detail',{id:'rec'}),job=p.onAddCalendar();
  assert.equal(h.modals.at(-1).title,'重新添加');h.respond(false);await job;assert.equal(h.events.length,0);
  h.cache.set(RR,[{id:'rec',name:'旧物品',openedAt:'2026-01-01',...mixed,calendarImported:true}]);
  const batch=h.page('calendar-import');assert.equal(batch.data.checkedCount,0);
  assert.equal(batch.data.items.every(i=>!i.disabled&&i.legacyUnknown),true);
  p=h.page('item-detail',{id:'rec'});job=p.onAddCalendar();
  assert.equal(h.modals.at(-1).title,'旧提醒待核对');h.respond(true);await flush();h.events[0].success();await job;
  assert.equal(h.storage.getRecord('rec').calendarEntries[0].kind,'due');
  change(h,{openedAt:'2026-01-02'});
  const entry=h.record.calendarEntries(h.storage.getRecord('rec')).find(e=>e.kind==='due');
  assert.equal(entry.imported,false);assert.equal(entry.legacyUnknown,false);
});

test('首次授权后必须再次点击；取消、拒绝权限、连点和离开不产生额外写入', async () => {
  for(const batch of [false,true]) {
    const h=setup();h.rec(mixed);h.auth(undefined);
    const p=h.page(batch?'calendar-import':'item-detail',{id:'rec'});
    const run=()=>batch?p.onImport():p.onAddCalendar();
    const job=run();run();
    if(batch)h.respond(true);
    await flush();assert.equal(h.events.length,0);assert.equal(h.modals.at(-1).title,'日历权限已开启');
    h.respond(false);await job;assert.equal(h.events.length,0);
    h.auth(undefined,false);const denied=run();if(batch)h.respond(true);await denied;assert.equal(h.events.length,0);
    h.auth(undefined);const leaving=run();if(batch)h.respond(true);await flush();p.onUnload();h.respond(true);await leaving;
    assert.equal(h.events.length,0);
  }
});

test('单条日历 API 失败可重试，成功后本地回写失败明确提示已提交并防止直接重复', async () => {
  const h=setup();h.rec(mixed);const p=h.page('item-detail',{id:'rec'});
  let job=p.onAddCalendar();await flush();h.events[0].fail({errMsg:'cancel'});await job;
  assert.equal(h.storage.getRecord('rec').calendarEntries.length,0);assert.equal(p.data.writing,false);
  job=p.onAddCalendar();await flush();h.failWrite();h.events[1].success();await job;
  assert.equal(h.modals.at(-1).title,'提醒已提交');assert.equal(p.data.calendarEntry.imported,true);
  assert.equal(h.storage.getRecord('rec').calendarEntries.length,0);
  job=p.onAddCalendar();assert.equal(h.modals.at(-1).title,'重新添加');h.respond(false);await job;
  assert.equal(h.events.length,2);
});

test('提交前读取失败或日期变化时，单条与批量均不会调用手机日历', () => {
  for(const batch of [false,true])for(const mode of ['read','date','deleted','archived']) {
    const h=setup();h.rec(mixed);const p=h.page(batch?'calendar-import':'item-detail',{id:'rec'});
    const selected=batch?p.data.items:[p.data.calendarEntry];
    if(mode==='read')h.failRead(RR);
    else if(mode==='deleted')h.storage.removeRecord('rec');
    else if(mode==='archived')change(h,{archived:true});
    else change(h,{openedAt:'2026-02-01',warrantyEnd:'2026-02-12',maintenanceLast:'2026-01-02'});
    if(batch)p.startImport(selected);else p.writeCalendar();
    assert.equal(h.events.length,0,mode);
    if(batch)assert.equal(p.data.resultFail,3);
  }
});

test('日历返回时物品已删除、归档或日期已变，不能复活记录或误标新期', async () => {
  for(const batch of [false,true])for(const mode of ['deleted','archived','date']) {
    const h=setup();h.rec({openedDays:40});const p=h.page(batch?'calendar-import':'item-detail',{id:'rec'});
    if(batch)p.startImport(p.data.items);else p.writeCalendar();
    if(mode==='deleted')h.storage.removeRecord('rec');
    else if(mode==='archived')h.finish('record','rec','consumed');
    else change(h,{openedAt:'2026-01-02'});
    h.events[0].success();await flush();h.runTimers();
    const r=h.storage.getRecord('rec');
    if(mode==='deleted')assert.equal(r,null);
    else {assert.equal(r.calendarEntries.length,0);if(mode==='archived')assert.equal(r.processingHistory.length,1);}
    if(batch)assert.equal(p.data.markerWarning,true);else assert.equal(h.modals.at(-1).title,'提醒已提交');
  }
});

test('维保写入途中完成本期，成功回调不能把下一期标为已添加', async () => {
  for(const batch of [false,true]) {
    const h=setup();h.rec({maintenanceLast:'2025-12-31',maintenanceCycle:'monthly'});
    const p=h.page(batch?'calendar-import':'item-detail',{id:'rec'});
    if(batch)p.startImport(p.data.items);else p.writeCalendar();
    h.finish('record','rec','maintenance');h.events[0].success();await flush();h.runTimers();
    const r=h.storage.getRecord('rec');assert.equal(r.calendarEntries.length,0);assert.equal(r.processingHistory.length,1);
    const entries=h.page('calendar-import').data.items;assert.equal(entries[0].dueDate,'2026-02-28');assert.equal(entries[0].checked,true);
  }
});

test('批量同一物品三类逐条成功，回执互不覆盖；安卓下一条需点击继续', async () => {
  const h=setup();h.rec(mixed);const p=h.page('calendar-import');const selected=p.data.items.slice();
  p.startImport(selected);p.onShow();assert.equal(h.events.length,1);
  for(let i=0;i<3;i++) {
    assert.equal(h.events.length,i+1);h.events[i].success();await flush();
    if(i<2) {assert.equal(h.events.length,i+1);assert.match(h.modals.at(-1).content,new RegExp(selected[i+1].label));h.respond(true);}
  }
  h.runTimers();assert.equal(p.data.resultSuccess,3);assert.equal(p.data.resultFail,0);
  assert.equal(h.storage.getRecord('rec').calendarEntries.length,3);assert.equal(p.data.items.every(i=>i.disabled),true);
  assert.equal(h.record.withStatus([h.storage.getRecord('rec')],7)[0].calendarLabel,'本期已入日历');
});

test('非安卓串行等待后续写；取消只停止尚未提交的提醒', async () => {
  for(const cancel of [false,true]) {
    const h=setup();h.platform('ios');h.rec(mixed);const p=h.page('calendar-import');p.startImport(p.data.items);
    if(cancel)p.onCancelImport();h.events[0].success();await flush();assert.equal(h.events.length,1);h.runTimers();
    if(cancel) {assert.equal(h.events.length,1);assert.equal(p.data.resultCancelled,true);}
    else {assert.equal(h.events.length,2);h.events[1].success();await flush();h.runTimers();assert.equal(h.events.length,3);h.events[2].success();await flush();h.runTimers();assert.equal(p.data.resultSuccess,3);}
  }
});

test('批量写入失败继续后续类别，不产生失败回执；本地标记失败不会自动重选', async () => {
  const h=setup();h.rec(mixed);const p=h.page('calendar-import');p.startImport(p.data.items);
  h.events[0].fail({errMsg:'cancel'});await flush();h.respond(true);h.failWrite();
  h.events[1].success();await flush();h.respond(false);
  assert.equal(p.data.resultSuccess,1);assert.equal(p.data.resultFail,1);assert.equal(p.data.markerWarning,true);
  assert.equal(p.data.items.find(e=>e.key===p.data.items[1].key).disabled,true);
  assert.equal(h.storage.getRecord('rec').calendarEntries.length,0);
});

test('离开页面后只回写已提交事件的本期回执，不再继续弹窗或写后续提醒', async () => {
  for(const batch of [false,true]) {
    const h=setup();h.rec(mixed);const p=h.page(batch?'calendar-import':'item-detail',{id:'rec'});
    if(batch)p.startImport(p.data.items);else p.writeCalendar();
    const ui=plain(p.data),count=h.modals.length;p.onUnload();h.events[0].success();await flush();h.runTimers();
    assert.equal(h.storage.getRecord('rec').calendarEntries.length,1);assert.equal(h.events.length,1);
    assert.equal(h.modals.length,count);assert.deepEqual(plain(p.data),ui);
  }
});

test('缓存读取失败显示可重试错误，恢复读取后列表和详情正常；不伪装为空记录', () => {
  const h=setup();h.rec(mixed);const batch=h.page('calendar-import'),detail=h.page('item-detail',{id:'rec'});
  h.failRead(RR);batch.buildList();detail.refresh();
  assert.equal(batch.data.loadError,true);assert.equal(batch.data.items.length,0);assert.equal(batch.data.checkedCount,0);
  assert.equal(detail.data.loadError,true);assert.equal(detail.data.missing,false);
  h.failRead('');batch.buildList();detail.refresh();assert.equal(batch.data.items.length,3);assert.equal(detail.data.record.id,'rec');
});

test('候选窗口按类别独立，超期默认不勾选，远期保修开关不影响保质期与维保', () => {
  const h=setup();h.rec({openedDays:1,warrantyEnd:'2026-12-01',maintenanceLast:'2025-12-01',maintenanceCycle:'monthly'});
  const p=h.page('calendar-import');assert.equal(p.data.items.length,2);assert.equal(p.data.checkedCount,0);
  p.onWarrantyBeyondChange({detail:{value:true}});assert.equal(p.data.items.length,3);assert.equal(p.data.checkedCount,1);
  assert.equal(p.data.items.find(e=>e.checked).kind,'warranty');
});

test('示例数据写入失败保留引导状态且不提示载入成功', () => {
  const h=setup();const p=h.page('dashboard');h.failRead(RR);p.onUseDemo();
  assert.equal(h.toasts.at(-1),'载入失败，请重试');assert.notEqual(h.cache.get('openkeep_onboarded_v1'),true);
});

test('三类物品提醒的提前时间已过时改为日程开始时提醒，未来提醒保留提前量', () => {
  const h=setup();const r=h.rec({openedDays:30,warrantyEnd:'2026-01-31',maintenanceLast:'2025-12-31',maintenanceCycle:'monthly'});
  for(const kind of ['due','warranty','maintenance']) {
    const event=h.calendar.buildEvent(r,h.record.computeStatus(r,7),1,kind);
    assert.equal(event.startTime,new Date(2026,1,1,9).getTime()/1000);
    assert.equal(event.alarmOffset,0);assert.match(event.description,/提前提醒时间已过/);
    assert.equal(event.endTime-event.startTime,3600);
  }
  const future=Object.assign({},r,{openedDays:40});
  assert.equal(h.calendar.buildEvent(future,h.record.computeStatus(future,7),3,'due').alarmOffset,3*86400);
});

test('首次授权确认后可以写入，确认期间类别和提前量保持用户原先选择', async () => {
  for(const batch of [false,true]) {
    const h=setup();h.rec(mixed);h.auth(undefined);const p=h.page(batch?'calendar-import':'item-detail',{id:'rec'});
    if(!batch)choose(p,'warranty');
    const job=batch?p.onImport():p.onAddCalendar();if(batch)h.respond(true);await flush();
    p.onReminderChange({detail:{value:6}});
    if(batch) {p.onToggleAll();assert.equal(p.data.checkedCount,3);}
    else {choose(p,'maintenance');assert.equal(p.data.calendarEntry.kind,'warranty');}
    h.respond(true);await flush();assert.equal(h.events.length,1);
    const evt=h.events[0];
    if(!batch) {assert.match(evt.title,/保修/);assert.equal(evt.alarmOffset,86400);}
    if(batch)p.onCancelImport();evt.success();await job;await flush();h.runTimers();
    assert.equal(h.storage.getRecord('rec').calendarEntries.length,1);
  }
});
