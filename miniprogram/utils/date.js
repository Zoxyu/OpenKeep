/**
 * 日期工具：统一处理「今天 00:00」、自然日差、闰年与跨月。
 * 重要约定：绝不使用 new Date('YYYY-MM-DD') 解析日期（会按 UTC 解析，
 * 在东八区以外的时区或跨日临界点会产生一天偏差），
 * 一律使用 new Date(year, month-1, day) 构造本地时间。
 */

// 获取本地「今天 00:00」
function todayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

// Date -> 'YYYY-MM-DD'（本地时区）
function formatDate(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

// 今天的 'YYYY-MM-DD'
function todayStr() {
  return formatDate(todayStart());
}

// 解析 'YYYY-MM-DD' 为本地 00:00 的 Date；非法输入返回 null
function parseDate(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!isFinite(y) || !isFinite(m) || !isFinite(d)) return null;
  const date = new Date(y, m - 1, d);
  // 校验是否发生进位（例如 2023-02-31 会被 Date 进位成 3 月 3 日，视为非法）
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

// 是否闰年
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// 某年某月的天数（处理闰年与跨月）
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// 日期加 N 天（入参可为 Date 或 'YYYY-MM-DD'），返回新的 00:00 Date。
// Date 构造器会自动处理跨月、跨年的进位，无需手工处理。
function addDays(input, days) {
  const base = input instanceof Date ? input : parseDate(input);
  if (!base) return null;
  const n = Number(days) || 0;
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
}

// 日期加 N 个月（按日历计算，月末日期自动收敛：如 1/31 加 1 个月 = 2/28 或 2/29）
function addMonths(input, months) {
  const base = input instanceof Date ? input : parseDate(input);
  if (!base) return null;
  const n = Number(months) || 0;
  const total = base.getMonth() + n;
  const year = base.getFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const maxDay = daysInMonth(year, month + 1);
  return new Date(year, month, Math.min(base.getDate(), maxDay));
}

// 日期加 N 年（闰年 2/29 加一年后收敛为 2/28）
function addYears(input, years) {
  return addMonths(input, (Number(years) || 0) * 12);
}

// 自然日差：a - b（两个日期都取 00:00，差值除以一天毫秒数后四舍五入，规避夏令时误差）
function diffDays(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

// 中文星期
function weekdayCN(date) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
}

module.exports = {
  todayStart,
  todayStr,
  formatDate,
  parseDate,
  isLeapYear,
  daysInMonth,
  addDays,
  addMonths,
  addYears,
  diffDays,
  weekdayCN
};
