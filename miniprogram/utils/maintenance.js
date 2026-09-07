/**
 * 维护周期工具（M1 第二批次）：「上次维护日 + 周期 → 下次维护日」的唯一计算来源。
 * 按 PROJECT_PLAN 8.6 要求，周期逻辑独立在本文件，页面只消费结果、不散落计算。
 * 与红黄绿到期状态、保修状态完全正交：不参与状态级别、排序权重与统计维度。
 * 下次维护日为派生值（上次 + 1 个周期），不落库存储，避免数据过期不一致；
 * 月末/闰年收敛复用 date.js 的 addMonths/addYears（如 1/31 每月 → 2/28）。
 * 过保语义：下次维护日早于今天时如实报「已超期 N 天」（不向后滚动到未来周期），
 * 诚实提醒欠账的维护；日历导入候选据此把超期维护与已过期物品同等对待（默认不勾选）。
 */
const dateUtil = require('./date');

const CYCLES = { none: '不设', monthly: '每月', yearly: '每年', custom: '自定义天数' };
const CYCLE_KEYS = ['none', 'monthly', 'yearly', 'custom'];

// 上次维护日 + 1 个周期 = 下次维护日；custom 按 customDays 天（storage 已规范化为 1–3650）
function nextMaintenanceDate(lastDate, cycle, customDays) {
  const last = dateUtil.parseDate(lastDate);
  if (!last) return null;
  if (cycle === 'monthly') return dateUtil.addMonths(last, 1);
  if (cycle === 'yearly') return dateUtil.addYears(last, 1);
  if (cycle === 'custom') return dateUtil.addDays(last, customDays);
  return null;
}

const INACTIVE = {
  active: false, lastDate: '', cycle: 'none', cycleText: '',
  nextDate: '', daysLeft: null, overdue: false, label: ''
};

/**
 * 维护信息计算（纯函数，不修改 record）。
 * @returns {{active:boolean, lastDate:string, cycle:string, cycleText:string,
 *   nextDate:string, daysLeft:number|null, overdue:boolean, label:string}}
 *   active＝设了合法周期且上次维护日合法；daysLeft＝下次维护日相对今天 00:00 的自然日差（<0 已超期）；
 *   cycleText＝「每月 / 每年 / 每 N 天」展示串；label＝「已超期 N 天 / 今天维护 / 还剩 N 天维护」。
 */
function getMaintenanceInfo(record, today) {
  const cycle = record && CYCLE_KEYS.indexOf(record.maintenanceCycle) > -1 ? record.maintenanceCycle : 'none';
  const lastStr = record && typeof record.maintenanceLast === 'string' ? record.maintenanceLast : '';
  if (cycle === 'none' || !dateUtil.parseDate(lastStr)) return INACTIVE;
  const next = nextMaintenanceDate(lastStr, cycle, record.maintenanceCycleDays);
  if (!next) return INACTIVE;
  const base = today || dateUtil.todayStart();
  const daysLeft = dateUtil.diffDays(next, base);
  return {
    active: true,
    lastDate: dateUtil.formatDate(dateUtil.parseDate(lastStr)),
    cycle: cycle,
    cycleText: cycle === 'custom' ? '每 ' + record.maintenanceCycleDays + ' 天' : CYCLES[cycle],
    nextDate: dateUtil.formatDate(next),
    daysLeft: daysLeft,
    overdue: daysLeft < 0,
    label: daysLeft < 0 ? '已超期 ' + (-daysLeft) + ' 天' : (daysLeft === 0 ? '今天维护' : '还剩 ' + daysLeft + ' 天维护')
  };
}

module.exports = { CYCLES, CYCLE_KEYS, nextMaintenanceDate, getMaintenanceInfo };
