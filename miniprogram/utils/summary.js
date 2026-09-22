// 看板聚合只读本地数据；状态和日期语义继续由对应工具提供。
const household = require('./household');
const record = require('./record');
const date = require('./date');

function householdOverview(records, today) {
  const base = today || date.todayStart();
  const items = records.filter(item => !item.archived).map(item => Object.assign(household.describe(item), {
    status: record.computeHouseholdStatus(item, base)
  })).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
  return {
    total: items.length,
    overdue: items.filter(item => item.status.level === 'overdue').length,
    today: items.filter(item => item.status.level === 'today').length,
    upcoming: items.filter(item => item.status.level === 'upcoming').length,
    items,
    preview: items.slice(0, 3)
  };
}

module.exports = { householdOverview };
