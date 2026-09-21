// 家庭事项类型与录入规则。持久化/规范化走 storage，状态走 record。
const date = require('./date');
const repeat = require('./repeat');
const TYPES = {
  bill: { label: '缴费 / 续费', example: '例如：宽带续费、视频会员' },
  insurance: { label: '保险续期', example: '例如：汽车保险续期' },
  document: { label: '证件到期', example: '例如：驾驶证换证、护照到期' }
};

function validate(item) {
  const errors = {};
  if (!item.title || !item.title.trim()) errors.title = '请输入事项名称';
  else if (item.title.trim().length > 30) errors.title = '名称最多 30 个字';
  if (!Object.prototype.hasOwnProperty.call(TYPES, item.type)) errors.type = '请选择事项类型';
  if (!date.parseDate(item.dueDate)) errors.dueDate = '请选择有效的处理日期';
  if (!Object.prototype.hasOwnProperty.call(repeat.RULES, item.repeatRule)) errors.repeatRule = '请选择重复方式';
  if (item.notes && item.notes.length > 100) errors.notes = '备注最多 100 个字';
  return errors;
}

function describe(item) {
  return Object.assign({}, item, {
    typeText: (TYPES[item.type] || TYPES.bill).label,
    repeatText: repeat.RULES[item.repeatRule] || repeat.RULES.none,
    followingDate: repeat.occurrenceDate(item.dueDate, item.repeatRule, 1)
  });
}

module.exports = { TYPES, validate, describe };
