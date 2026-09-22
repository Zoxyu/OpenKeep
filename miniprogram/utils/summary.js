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

// 提醒按日期类型计数；一件物品可同时有保质期、保修和维保提醒。
// 只派生展示数据，不写缓存、不推进周期、不依赖物品列表筛选。
function reminderOverview(records, households, settings, today) {
  const base = today || date.todayStart();
  const config = settings || {};
  const warningDays = config.warningDays || 7;
  const groups = [
    { key: 'overdue', label: '已超期', items: [] },
    { key: 'today', label: '今天', items: [] },
    { key: 'upcoming', label: '未来 7 天', items: [] }
  ];
  const later = { key: 'later', label: '后续安排', items: [] };
  function add(item, source, kind, typeText, dueDate, daysLeft, label, laterWindow) {
    if (!dueDate || !Number.isFinite(daysLeft)) return;
    if (daysLeft > 7 && daysLeft > laterWindow) return;
    const group = daysLeft < 0 ? groups[0] : daysLeft === 0 ? groups[1] : daysLeft <= 7 ? groups[2] : later;
    group.items.push({
      key: JSON.stringify([source, item.id, kind, dueDate]),
      source, id: item.id, kind, typeText, dueDate, daysLeft, label,
      title: source === 'household' ? item.title : item.name,
      period: group.key
    });
  }
  (records || []).filter(item => !item.archived).forEach(item => {
    const shelf = record.computeStatus(item, warningDays, base);
    add(item, 'record', 'due', '保质期', shelf.dueDate, shelf.daysLeft, shelf.label, warningDays);
    const warranty = record.getWarrantyStatus(item, base);
    if (warranty.hasWarranty && item.warrantyHandledDate !== item.warrantyEnd) {
      const left = warranty.daysLeft;
      const label = left < 0 ? '已过保 ' + (-left) + ' 天' : left === 0 ? '今天过保' : '还有 ' + left + ' 天过保';
      add(item, 'record', 'warranty', '保修', warranty.endDate, left, label, config.warrantyBeyond30 ? Infinity : 30);
    }
    const maintenance = record.getMaintenanceInfo(item, base);
    if (maintenance.active) add(item, 'record', 'maintenance', '维保', maintenance.nextDate, maintenance.daysLeft, maintenance.label, 30);
  });
  (households || []).filter(item => !item.archived).forEach(item => {
    const status = record.computeHouseholdStatus(item, base);
    const described = household.describe(item);
    add(item, 'household', 'household', described.typeText, item.dueDate, status.daysLeft, status.label, Infinity);
  });
  groups.concat(later).forEach(group => {
    group.items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
    group.count = group.items.length;
    group.preview = group.items.slice(0, 3);
  });
  return { groups, later, total: groups.reduce((sum, group) => sum + group.count, 0) };
}

module.exports = { householdOverview, reminderOverview };
