const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plain = v => JSON.parse(JSON.stringify(v));
const HH = 'openkeep_household_v1', RR = 'openkeep_records_v1';
function setup() {
  const cache = new Map(), modals = [], toasts = [], navigation = [], events = [], writes = [], themes = [], timers = [], actionSheets = [];
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
      authorize: o => grant ? o.success() : o.fail(), getSystemInfoSync: () => ({ platform: 'android' }),
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
    const p=Object.assign({},definition,{data:plain(definition.data),setData(v,cb){Object.assign(this.data,v);if(cb)cb();}});
    p.onLoad(query);p.onShow();return p;
  }
  return { cache, modals, toasts, navigation, events, writes, actionSheets, storage, processing, calendar, record, summary, page,
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

test('一次性事项原子归档、退出统计；撤销恢复，处理记录保留',()=>{
 const h=setup();h.hh({repeatRule:'none'});const before=h.writes.length;
 assert.equal(h.finish('household','hh','household'),true);assert.equal(h.writes.length,before+1);
 let v=h.storage.getHousehold('hh');assert.equal(v.archived,true);assert.equal(v.processingHistory.length,1);
 assert.equal(h.summary.householdOverview([v]).total,0);assert.equal(h.page('household').data.items.length,0);
 const a=h.page('archive');assert.equal(a.data.items[0].canUndo,true);
 a.onUndo({currentTarget:{dataset:{key:a.data.items[0].key}}});h.respond(false);assert.equal(h.storage.getHousehold('hh').archived,true);
 a.onUndo({currentTarget:{dataset:{key:a.data.items[0].key}}});h.respond(true);
 v=h.storage.getHousehold('hh');assert.equal(v.archived,false);assert.equal(a.data.items[0].undone,true);assert.equal(a.data.items[0].canUndo,false);
});
test('周期完成确认下一期；月末不漂移，闰年保持原始锚点',()=>{
 const h=setup();h.hh();h.finish('household','hh','household','2026-02-28');
 let v=h.storage.getHousehold('hh');assert.equal(h.processing.followingDate(v),'2026-03-31');
 assert.equal(v.archived,false);h.finish('household','hh','household','2026-03-31');v=h.storage.getHousehold('hh');assert.equal(v.processingHistory.length,2);
 h.hh({id:'leap',dueDate:'2024-02-29',repeatRule:'yearly'});
 for(const d of ['2025-02-28','2026-02-28','2027-02-28']) h.finish('household','leap','household',d);
 assert.equal(h.processing.followingDate(h.storage.getHousehold('leap')),'2028-02-29');
});
test('自选下一期重新设定锚点；无效和倒退日期不写入',()=>{
 const h=setup();h.hh();for(const d of ['','2026-02-30','2026-01-31','2025-12-01']) assert.throws(()=>h.finish('household','hh','household',d));
 assert.equal(h.storage.getHousehold('hh').processingHistory.length,0);
 h.finish('household','hh','household','2026-02-15');assert.equal(h.processing.followingDate(h.storage.getHousehold('hh')),'2026-03-15');
});
test('处理页需确认才写；校验、失败重试、重复点击与跨天保护',()=>{
 const h=setup();h.hh();const p=h.page('process',{source:'household',id:'hh'});const count=h.writes.length;
 assert.equal(h.writes.length,count);assert.equal(p.data.nextDate,'2026-02-28');
 p.onDate({detail:{value:'2026-01-31'}});p.onSave();assert.match(p.data.error,/晚于/);
 p.onDate({detail:{value:'2026-02-28'}});h.failWrite();p.onSave();assert.equal(h.storage.getHousehold('hh').processingHistory.length,0);assert.equal(p.data.saving,false);
 h.failWrite(false);p.onSave();p.onSave();assert.equal(h.storage.getHousehold('hh').processingHistory.length,1);assert.deepEqual(h.navigation,['back']);
 const again=h.page('process',{source:'household',id:'hh'});h.nextDay();again.onSave();assert.match(again.data.error,/日期已变化/);assert.equal(h.storage.getHousehold('hh').processingHistory.length,1);
});
test('过期编辑或重复提交不覆盖处理结果；删除、损坏缓存及读写失败不复活',()=>{
 const h=setup();const item=h.hh();const edit=h.page('household-form',{id:'hh'});const rev=h.processing.revision(item,'household');
 h.finish('household','hh','household','2026-02-28');edit.onSave();assert.equal(h.storage.getHousehold('hh').dueDate,'2026-02-28');
 assert.throws(()=>h.processing.complete('household','hh',rev,'household','2026-03-31'));
 h.failRead(HH);assert.throws(()=>h.finish('household','hh','household','2026-03-31'));h.failRead('');
 h.storage.removeHousehold('hh');assert.throws(()=>h.processing.complete('household','hh',rev,'household','2026-03-31'));assert.equal(h.storage.loadHousehold().length,0);
 h.cache.set(HH,{bad:true});assert.throws(()=>h.processing.complete('household','hh',rev,'household','2026-03-31'));assert.deepEqual(h.cache.get(HH),{bad:true});
});
test('保质期整件归档后保留照片与数据，退出物品/看板/日历候选；可恢复',()=>{
 const h=setup();h.rec({openedDays:7});h.finish('record','rec','consumed');let v=h.storage.getRecord('rec');
 assert.equal(v.archived,true);assert.equal(v.photoPath,'/saved/a.jpg');assert.equal(v.notes,'保留备注');
 assert.equal(h.record.withStatus([v],7).length,0);assert.equal(h.page('dashboard').data.total,0);assert.equal(h.page('calendar-import').data.items.length,0);
 h.processing.undo('record','rec',v.processingHistory[0].id);assert.equal(h.storage.getRecord('rec').archived,false);assert.equal(h.page('dashboard').data.total,1);
});
test('保修只处理当前提醒，维保记录历史并推进；互不归档整件物品',()=>{
 const h=setup();h.rec({warrantyEnd:'2026-02-02',maintenanceLast:'2025-12-31',maintenanceCycle:'monthly'});
 h.finish('record','rec','warranty');let v=h.storage.getRecord('rec');assert.equal(v.archived,false);assert.equal(v.warrantyHandledDate,'2026-02-02');assert.equal(h.page('dashboard').data.warrantySoon.length,0);
 h.finish('record','rec','maintenance');v=h.storage.getRecord('rec');assert.equal(v.archived,false);assert.equal(v.maintenanceLast,'2026-01-31');assert.equal(v.processingHistory[1].nextDate,'2026-02-28');
 assert.equal(v.processingHistory.length,2);assert.equal(h.page('dashboard').data.total,1);assert.throws(()=>h.finish('record','rec','maintenance'));
 assert.throws(()=>h.processing.undo('record','rec',v.processingHistory[0].id));
 h.processing.undo('record','rec',v.processingHistory[1].id);h.processing.undo('record','rec',v.processingHistory[0].id);
 assert.equal(h.page('dashboard').data.warrantySoon.length,1);
});
test('归档撤销失败保留原状态；业务日期变更后拒绝撤销，普通备注保留',()=>{
 const h=setup();h.hh();h.finish('household','hh','household','2026-02-28');let v=h.storage.getHousehold('hh');const id=v.processingHistory[0].id;
 h.failWrite();assert.equal(h.processing.undo('household','hh',id),false);assert.equal(h.storage.getHousehold('hh').dueDate,'2026-02-28');h.failWrite(false);
 h.storage.upsertHousehold(Object.assign({},v,{notes:'新备注'}),true);h.processing.undo('household','hh',id);assert.equal(h.storage.getHousehold('hh').notes,'新备注');
 h.finish('household','hh','household','2026-02-28');v=h.storage.getHousehold('hh');h.storage.upsertHousehold(Object.assign({},v,{dueDate:'2026-03-15'}),true);
 assert.throws(()=>h.processing.undo('household','hh',v.processingHistory.at(-1).id));
});
test('归档页筛选和深色主题；清空数据也清除内嵌历史',()=>{
 const h=setup();h.hh({repeatRule:'none'});h.rec({openedDays:7});h.finish('household','hh','household');h.finish('record','rec','discarded');
 const a=h.page('archive');assert.equal(a.data.items.length,2);a.onFilter({currentTarget:{dataset:{filter:'record'}}});assert.equal(a.data.items.length,1);
 h.dark();assert.equal(a.data.dark,true);h.failRead(HH);a.refresh();assert.equal(a.data.loadError,true);h.failRead('');
 h.storage.clearAllData();a.refresh();assert.equal(a.data.items.length,0);
});
test('家庭日历事件三类通用，秒级时间戳、提前量、过去日期顺延及归档拦截',()=>{
 const h=setup();for(const type of ['bill','insurance','document']) {
   const v=h.hh({type,dueDate:'2026-02-10'});const e=h.calendar.buildHouseholdEvent(v,3);
   assert.equal(e.startTime,new Date(2026,1,10,9).getTime()/1000);assert.equal(e.endTime-e.startTime,3600);assert.equal(e.alarmOffset,3*86400);assert.match(e.description,/2026-02-10/);
 }
 const v=h.hh();assert.equal(h.calendar.buildHouseholdEvent(v,7).alarmOffset,0);assert.equal(h.calendar.buildHouseholdEvent(v,0).startTime,new Date(2026,1,1,9).getTime()/1000);
 assert.equal(h.calendar.buildHouseholdEvent({...v,archived:true},1),null);assert.equal(h.calendar.buildHouseholdEvent({...v,dueDate:'bad'},1),null);
});
test('日历单次写入成功才标记，本期防重复且下一期可重新添加',async()=>{
 const h=setup();h.hh();const p=h.page('household-detail',{id:'hh'});
 const job=p.onAddCalendar();p.onAddCalendar();await flush();assert.equal(h.events.length,1);assert.equal(p.data.calendarAdded,false);
 h.events[0].success();await job;assert.equal(p.data.writing,false);assert.equal(p.data.calendarAdded,true);
 const again=p.onAddCalendar();h.respond(false);await again;assert.equal(h.events.length,1);
 h.finish('household','hh','household','2026-02-28');p.refresh();assert.equal(p.data.calendarAdded,false);
});
test('首次日历授权需二次点击；拒绝或取消不写入；不支持时降级',async()=>{
 const h=setup();h.hh();h.auth(undefined);const p=h.page('household-detail',{id:'hh'});const job=p.onAddCalendar();await flush();assert.equal(h.events.length,0);assert.equal(h.modals.at(-1).title,'日历权限已开启');h.respond(false);await job;assert.equal(h.events.length,0);assert.equal(p.data.writing,false);
 h.auth(undefined,false);await p.onAddCalendar();assert.equal(h.events.length,0);assert.equal(p.data.writing,false);
 h.unsupported();await p.onAddCalendar();assert.equal(h.modals.at(-1).title,'暂不支持写入日历');
});
test('日历授权等待期间记录变化或页面退出时不继续写入',async()=>{
 for(const action of ['edit','delete','unload']) {
   const h=setup();h.hh();h.auth(undefined);const p=h.page('household-detail',{id:'hh'});const job=p.onAddCalendar();await flush();
   if(action==='edit')h.storage.upsertHousehold({...h.storage.getHousehold('hh'),dueDate:'2026-02-03'},true);
   if(action==='delete')h.storage.removeHousehold('hh');if(action==='unload')p.onUnload();
   h.respond(true);await job;assert.equal(h.events.length,0);
 }
});
test('系统日历失败不设置标记；外部成功但本地保存失败需提示先检查日历',async()=>{
 const h=setup();h.hh();const p=h.page('household-detail',{id:'hh'});
 let job=p.onAddCalendar();await flush();h.events[0].fail({errMsg:'cancel'});await job;assert.equal(p.data.calendarAdded,false);assert.equal(h.storage.getHousehold('hh').calendarImportedFor,'');
 job=p.onAddCalendar();await flush();h.failWrite();h.events[1].success();await job;assert.equal(h.modals.at(-1).title,'提醒已提交');assert.equal(p.data.calendarAdded,true);assert.equal(p.data.writing,false);
});
test('日历返回期间处理或删除记录，不覆盖新状态、不复活记录',async()=>{
 for(const action of ['process','delete']) {
   const h=setup();h.hh();const p=h.page('household-detail',{id:'hh'});const job=p.onAddCalendar();await flush();
   if(action==='process')h.finish('household','hh','household','2026-02-28');else h.storage.removeHousehold('hh');
   h.events[0].success();await job;const v=h.storage.getHousehold('hh');
   if(action==='process'){assert.equal(v.dueDate,'2026-02-28');assert.equal(v.processingHistory.length,1);assert.equal(v.calendarImportedFor,'');}else assert.equal(v,null);
   assert.equal(h.modals.at(-1).title,'提醒已提交');
 }
});

test('旧物品到期/保修/维保日历构造仍沿用原日期和秒级参数',()=>{
 const h=setup();const v=h.rec({openedDays:40,warrantyEnd:'2026-03-01',maintenanceLast:'2026-01-15',maintenanceCycle:'monthly'});
 const status=h.record.computeStatus(v,7);
 for(const [kind,day] of [['due',new Date(2026,1,10,9)],['warranty',new Date(2026,2,1,9)],['maintenance',new Date(2026,1,15,9)]]) {
  const e=h.calendar.buildEvent(v,status,2,kind);assert.equal(e.startTime,day.getTime()/1000);assert.equal(e.alarmOffset,2*86400);assert.equal(e.endTime-e.startTime,3600);
 }
});
test('旧物品单条/批量日历回写保留处理历史，不能撤销归档',async()=>{
 for(const batch of [false,true]) {
  const h=setup();h.rec({openedDays:40});const p=h.page(batch?'calendar-import':'item-detail',{id:'rec'});
  if(batch)p.startImport([p.data.items[0]]);else p.writeCalendar();
  assert.equal(h.events.length,1);h.finish('record','rec','consumed');h.events[0].success();await flush();h.runTimers();
  const v=h.storage.getRecord('rec');assert.equal(v.archived,true);assert.equal(v.processingHistory.length,1);
  if(batch){assert.equal(p.data.markerWarning,true);assert.equal(p.data.resultSuccess,1);}else assert.equal(h.modals.at(-1).title,'提醒已提交');
 }
});
test('已打开的物品编辑页不能覆盖之后的归档与处理历史',()=>{
 const h=setup();h.rec({openedDays:7});const p=h.page('item-form',{id:'rec'});h.finish('record','rec','consumed');
 p.onSave();assert.equal(h.modals.at(-1).title,'记录已变化');assert.equal(h.storage.getRecord('rec').archived,true);assert.equal(h.storage.getRecord('rec').processingHistory.length,1);
});
test('周期续期后编辑页与详情页参考日期一致，修改备注不改变锚点',()=>{
 const h=setup();h.hh();h.finish('household','hh','household','2026-02-28');const p=h.page('household-form',{id:'hh'});
 assert.equal(p.data.followingDate,'2026-03-31');p.onDateChange({detail:{value:'2026-02-28'}});assert.equal(p.data.followingDate,'2026-03-31');
 p.setData({notes:'修改备注'});p.onSave();assert.equal(h.processing.followingDate(h.storage.getHousehold('hh')),'2026-03-31');
});

test('看板物品菜单取消不跳转，防重复打开，两项操作导航到正确物品',()=>{
 const h=setup();const id='物品&1';h.rec({id,openedDays:7});const p=h.page('dashboard');const e={detail:{id}};
 p.onItemMore(e);p.onItemMore(e);assert.equal(h.actionSheets.length,1);
 assert.deepEqual(plain(h.actionSheets[0].itemList),['记录处理结果','编辑物品']);
 h.actionSheets[0].fail({errMsg:'showActionSheet:fail cancel'});h.actionSheets[0].complete();assert.equal(h.navigation.length,0);assert.equal(h.toasts.length,0);
 p.onItemMore(e);h.actionSheets[1].success({tapIndex:0});h.actionSheets[1].complete();
 assert.equal(h.navigation.at(-1),'/pages/process/process?source=record&id='+encodeURIComponent(id));
 p.onItemMore(e);h.actionSheets[2].success({tapIndex:1});h.actionSheets[2].complete();
 assert.equal(h.navigation.at(-1),'/pages/item-form/item-form?id='+encodeURIComponent(id));
});
test('菜单等待期间物品归档、删除、读取失败或页面销毁时不继续导航',()=>{
 for(const action of ['archive','delete','read-error','unload','menu-error']){
  const h=setup();h.rec({openedDays:7});const p=h.page('dashboard');p.onItemMore({detail:{id:'rec'}});
  if(action==='archive')h.finish('record','rec','consumed');
  if(action==='delete')h.storage.removeRecord('rec');
  if(action==='read-error')h.failRead(RR);
  if(action==='unload')p.onUnload();
  if(action==='menu-error')h.actionSheets[0].fail({errMsg:'showActionSheet:fail busy'});
  else h.actionSheets[0].success({tapIndex:0});
  h.actionSheets[0].complete();assert.equal(h.navigation.length,0);assert.equal(p._itemMenuOpen,false);
 }
});
test('物品卡片菜单只发出 more 事件，主体仍发出 tapitem，其他列表默认不启用菜单',()=>{
 let definition;const events=[];
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../miniprogram/components/item-card/item-card.js'),'utf8'),{Component(value){definition=value;}});
 assert.equal(definition.properties.showMenu.value,false);
 const card={data:{item:{id:'rec'},showMenu:true},triggerEvent(name,detail){events.push({name,id:detail.id});}};
 definition.methods.onMore.call(card);assert.deepEqual(events,[{name:'more',id:'rec'}]);
 definition.methods.onTap.call(card);assert.deepEqual(events.at(-1),{name:'tapitem',id:'rec'});
 card.data.showMenu=false;definition.methods.onMore.call(card);assert.equal(events.length,2);
});
