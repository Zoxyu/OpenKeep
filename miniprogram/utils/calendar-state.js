// 物品日历回执：类别与日期共同标识一期，不把整件物品的旧标记当成本期回执。
const dateUtil = require('./date');
const KINDS = ['due', 'warranty', 'maintenance'];
const DAYS = [0, 1, 2, 3, 5, 7, 14];

function normalize(value) {
  if (!Array.isArray(value)) return [];
  const entries = [];
  value.forEach(raw => {
    if (!raw || KINDS.indexOf(raw.kind) < 0) return;
    const due = dateUtil.parseDate(raw.dueDate);
    if (!due || !Number.isFinite(raw.importedAt) || raw.importedAt < 0) return;
    const entry = { kind: raw.kind, dueDate: dateUtil.formatDate(due), importedAt: raw.importedAt,
      reminderDays: DAYS.indexOf(raw.reminderDays) >= 0 ? raw.reminderDays : 1 };
    const index = entries.findIndex(e => e.kind === entry.kind && e.dueDate === entry.dueDate);
    if (index < 0) entries.push(entry);
    else if (entries[index].importedAt <= entry.importedAt) entries[index] = entry;
  });
  return entries;
}

function legacyUnknown(record) {
  return typeof record.calendarLegacyUnknown === 'boolean' ? record.calendarLegacyUnknown
    : !!record.calendarImported && !Array.isArray(record.calendarEntries);
}

function state(record, kind, dueDate) {
  const entries = normalize(record.calendarEntries);
  const receipt = entries.find(e => e.kind === kind && e.dueDate === dueDate);
  return {
    imported: !!receipt,
    // 旧版没有类别、日期，保守提示核对；该类别开始使用新回执后，新一期正常待添加。
    legacyUnknown: !receipt && legacyUnknown(record) && !entries.some(e => e.kind === kind),
    reminderDays: receipt ? receipt.reminderDays : record.calendarReminderDays
  };
}

function mark(record, entry, reminderDays) {
  const now = Date.now();
  const entries = normalize(record.calendarEntries).filter(e => e.kind !== entry.kind || e.dueDate !== entry.dueDate);
  entries.push({ kind: entry.kind, dueDate: entry.dueDate, importedAt: now, reminderDays });
  return Object.assign({}, record, { calendarEntries: entries, calendarLegacyUnknown: legacyUnknown(record),
    calendarImported: true, calendarImportedAt: now, calendarReminderDays: reminderDays, updatedAt: now });
}

module.exports = { normalize, legacyUnknown, state, mark };
