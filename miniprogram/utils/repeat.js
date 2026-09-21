// 周期日期从原始日期按日历计算；查询不会推进周期或生成记录。
const date = require('./date');
const RULES = { none: '一次性', monthly: '每月', yearly: '每年' };

function occurrenceDate(anchorDate, rule, index) {
  const anchor = date.parseDate(anchorDate);
  if (!anchor || !Object.prototype.hasOwnProperty.call(RULES, rule) ||
      !Number.isInteger(index) || index < 0) return '';
  if (rule === 'none' && index > 0) return '';
  const result = rule === 'monthly' ? date.addMonths(anchor, index)
    : rule === 'yearly' ? date.addYears(anchor, index) : anchor;
  return date.formatDate(result);
}

module.exports = { RULES, occurrenceDate };
