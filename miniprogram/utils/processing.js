// 处理与撤销的唯一入口；日期与状态仍由 date / record / repeat 计算。
const storage = require('./storage');
const date = require('./date');
const record = require('./record');
const repeat = require('./repeat');
const LABELS = { household: '已处理', consumed: '已用完', discarded: '已丢弃', warranty: '保修提醒已处理', maintenance: '已完成维护', archive: '已归档' };

function state(item, source) {
  const keys = source === 'household'
    ? ['archived', 'dueDate', 'repeatRule', 'repeatAnchor', 'repeatIndex']
    : ['archived', 'openedAt', 'openedDays', 'shelfLifeValue', 'shelfLifeUnit', 'warrantyEnd', 'warrantyHandledDate', 'maintenanceLast', 'maintenanceCycle', 'maintenanceCycleDays'];
  return JSON.stringify(keys.map(k => item[k]));
}
function revision(item, source) {
  return state(item, source) + JSON.stringify((item.processingHistory || []).map(e => [e.id, e.undoneAt]));
}
function followingDate(item) { return repeat.followingDate(item); }
function options(item, source) {
  if (!item || item.archived) return [];
  if (source === 'household') return [{ key: 'household', label: '标记已处理' }];
  const out = [];
  if (item.openedDays > 0 || item.shelfLifeValue > 0) out.push({ key: 'consumed', label: '已用完' }, { key: 'discarded', label: '已丢弃' });
  if (item.warrantyEnd && item.warrantyHandledDate !== item.warrantyEnd) out.push({ key: 'warranty', label: '保修提醒已处理' });
  if (record.getMaintenanceInfo(item).active && item.maintenanceLast !== date.todayStr()) out.push({ key: 'maintenance', label: '已完成维护' });
  if (!out.length && !item.warrantyEnd && !record.getMaintenanceInfo(item).active) out.push({ key: 'archive', label: '归档物品' });
  return out;
}
function get(source, id) { return storage.loadEntriesStrict(source).find(i => i.id === id) || null; }

function complete(source, id, expected, kind, nextDate) {
  return storage.updateExisting(source, id, item => {
    if (revision(item, source) !== expected) throw new Error('记录已变化，请返回后重试');
    if (!options(item, source).some(o => o.key === kind)) throw new Error('这项操作已完成或不再适用');
    let after = {}, dueDate = '', following = '';
    if (kind === 'household') {
      dueDate = item.dueDate;
      if (item.repeatRule === 'none') after = { archived: true };
      else {
        if (!date.parseDate(nextDate) || nextDate <= item.dueDate) throw new Error('下一期日期需晚于本期日期');
        const anchorValid = repeat.occurrenceDate(item.repeatAnchor, item.repeatRule, item.repeatIndex) === item.dueDate;
        const isExpected = anchorValid && nextDate === followingDate(item);
        after = { dueDate: nextDate, repeatAnchor: isExpected ? item.repeatAnchor : nextDate, repeatIndex: isExpected ? item.repeatIndex + 1 : 0 };
        following = nextDate;
      }
    } else if (kind === 'maintenance') {
      dueDate = record.getMaintenanceInfo(item).nextDate;
      after = { maintenanceLast: date.todayStr() };
      following = record.getMaintenanceInfo(Object.assign({}, item, after)).nextDate;
    } else if (kind === 'warranty') {
      dueDate = item.warrantyEnd;
      after = { warrantyHandledDate: item.warrantyEnd };
    } else {
      dueDate = record.computeStatus(item, 7).dueDate;
      after = { archived: true };
    }
    const before = {};
    Object.keys(after).forEach(key => { before[key] = item[key]; });
    const updated = Object.assign({}, item, after, { updatedAt: Date.now() });
    const entry = { id: storage.genId(), kind, title: item.title || item.name, dueDate, nextDate: following,
      processedAt: Date.now(), undoneAt: null, before, after, guard: state(updated, source) };
    updated.processingHistory = (item.processingHistory || []).concat(entry);
    return updated;
  });
}

function canUndo(item, source, entry) {
  const active = (item.processingHistory || []).filter(e => e.undoneAt === null);
  return !!entry && entry.undoneAt === null && active.length > 0 && active[active.length - 1].id === entry.id &&
    !!entry.guard && state(item, source) === entry.guard && Object.keys(entry.before).length > 0;
}
function undo(source, id, entryId) {
  return storage.updateExisting(source, id, item => {
    const entry = (item.processingHistory || []).find(e => e.id === entryId);
    if (!canUndo(item, source, entry)) throw new Error('仅可撤销最近一次处理；记录发生修改后无法直接撤销');
    return Object.assign({}, item, entry.before, {
      updatedAt: Date.now(),
      processingHistory: item.processingHistory.map(e => e.id === entryId ? Object.assign({}, e, { undoneAt: Date.now() }) : e)
    });
  });
}
function history(source, items) {
  return items.reduce((all, item) => all.concat((item.processingHistory || []).map(e => ({
    key: source + ':' + item.id + ':' + e.id, source, recordId: item.id, entryId: e.id,
    title: e.title, label: LABELS[e.kind], dueDate: e.dueDate, nextDate: e.nextDate,
    processedAt: e.processedAt, processedDate: date.formatDate(new Date(e.processedAt)),
    undone: e.undoneAt !== null, canUndo: canUndo(item, source, e)
  }))), []);
}
module.exports = { LABELS, get, revision, followingDate, options, complete, undo, history };
