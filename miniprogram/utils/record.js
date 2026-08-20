/**
 * 记录与状态工具：红黄绿状态的唯一计算来源。
 * 所有页面（首页、列表、详情、批量导入）都通过这里生成状态，
 * 保证颜色、文字、统计数与筛选结果全局一致；状态绝不落库写死。
 */
const dateUtil = require('./date');

// 分类定义：文案 + 占位图形色值（浅色 / 深色模式分别给出一套）
// refOpenedDays：该分类「开封后可保存天数」的保守参考值（宁少勿多，提醒更安全）
const CATEGORIES = {
  fridge: {
    key: 'fridge', label: '冷藏', char: '鲜', refOpenedDays: 7,
    tone: '#3E8F72', toneDark: '#6CC0A1',
    toneAlpha: 'rgba(62,143,114,0.13)', toneDarkAlpha: 'rgba(108,192,161,0.18)'
  },
  freezer: {
    key: 'freezer', label: '冷冻', char: '冻', refOpenedDays: 30,
    tone: '#5B7C99', toneDark: '#8FB3D1',
    toneAlpha: 'rgba(91,124,153,0.13)', toneDarkAlpha: 'rgba(143,179,209,0.18)'
  },
  medicine: {
    key: 'medicine', label: '药品', char: '药', refOpenedDays: 30,
    tone: '#C65B55', toneDark: '#E08D87',
    toneAlpha: 'rgba(198,91,85,0.12)', toneDarkAlpha: 'rgba(224,141,135,0.18)'
  },
  cosmetics: {
    key: 'cosmetics', label: '化妆品', char: '妆', refOpenedDays: 60,
    tone: '#A9718F', toneDark: '#C99AB5',
    toneAlpha: 'rgba(169,113,143,0.12)', toneDarkAlpha: 'rgba(201,154,181,0.18)'
  },
  other: {
    key: 'other', label: '其他', char: '其', refOpenedDays: 30,
    tone: '#8A8F8B', toneDark: '#A7ADA8',
    toneAlpha: 'rgba(138,143,139,0.13)', toneDarkAlpha: 'rgba(167,173,168,0.18)'
  }
};

const SHELF_UNITS = { day: '天', month: '个月', year: '年' };

function categoryOf(key) {
  return CATEGORIES[key] || CATEGORIES.other;
}

/**
 * 到期日计算：
 *   已填「开封后可保存天数」 → 到期日 = 开封日期 + 该天数（更精确，优先）
 *   未填              → 到期日 = 开封日期 + 保质期（按天/月/年日历计算）
 */
function dueDateOf(record, openedDate) {
  if (record.openedDays > 0) {
    return dateUtil.addDays(openedDate, record.openedDays);
  }
  const v = record.shelfLifeValue;
  if (!v) return null; // 两种依据都没填时（理论上表单已拦截）
  if (record.shelfLifeUnit === 'month') return dateUtil.addMonths(openedDate, v);
  if (record.shelfLifeUnit === 'year') return dateUtil.addYears(openedDate, v);
  return dateUtil.addDays(openedDate, v);
}

// 保质期的展示文案，如「30 天」「6 个月」「2 年」
function shelfLifeText(record) {
  if (!record.shelfLifeValue) return '';
  return record.shelfLifeValue + ' ' + (SHELF_UNITS[record.shelfLifeUnit] || '天');
}

/**
 * 核心状态计算：
 *   daysLeft = 到期日相对「今天 00:00」的自然日差
 *   daysLeft < 0            -> 红色「已过期」
 *   0 <= daysLeft <= 阈值    -> 黄色「临期」
 *   daysLeft > 阈值          -> 绿色「安全」
 */
function computeStatus(record, warningDays, today) {
  const base = today || dateUtil.todayStart();
  const opened = dateUtil.parseDate(record.openedAt) || base;
  const due = dueDateOf(record, opened);
  const daysOpened = dateUtil.diffDays(base, opened);

  // 无到期依据（不应出现，表单已校验）：按长期安全处理，排在最后
  if (!due) {
    return {
      dueDate: '', dueTs: Number.MAX_SAFE_INTEGER, daysLeft: Number.MAX_SAFE_INTEGER,
      daysOpened: daysOpened, level: 'safe', levelText: '安全',
      label: '未设置到期日', progress: 0
    };
  }

  const daysLeft = dateUtil.diffDays(due, base);

  let level;
  if (daysLeft < 0) level = 'expired';
  else if (daysLeft <= warningDays) level = 'warning';
  else level = 'safe';

  let label;
  if (daysLeft < 0) label = '已过期 ' + (-daysLeft) + ' 天';
  else if (daysLeft === 0) label = '今天到期';
  else if (daysLeft === 1) label = '明天到期';
  else label = '还剩 ' + daysLeft + ' 天';

  const levelText = level === 'expired' ? '已过期' : (level === 'warning' ? '临期' : '安全');

  // 保质期消耗进度（用于卡片进度条），0 ~ 100
  const totalDays = Math.max(1, dateUtil.diffDays(due, opened));
  const progress = Math.max(0, Math.min(100, Math.round(Math.max(0, daysOpened) / totalDays * 100)));

  return {
    dueDate: dateUtil.formatDate(due),
    dueTs: due.getTime(),
    daysLeft: daysLeft,
    daysOpened: daysOpened,
    level: level,
    levelText: levelText,
    label: label,
    progress: progress
  };
}

// 批量给记录附加状态与展示字段（分类文案、占位色）
function withStatus(records, warningDays) {
  const today = dateUtil.todayStart();
  return (records || []).map(r => {
    const cat = categoryOf(r.category);
    return Object.assign({}, r, {
      categoryLabel: cat.label,
      categoryChar: cat.char,
      tone: cat.tone,
      toneDark: cat.toneDark,
      toneAlpha: cat.toneAlpha,
      toneDarkAlpha: cat.toneDarkAlpha,
      status: computeStatus(r, warningDays, today)
    });
  });
}

// 首页排序：已过期优先，其次临期，最后按到期日由近到远
function sortUrgent(list) {
  const order = { expired: 0, warning: 1, safe: 2 };
  return list.slice().sort((a, b) => {
    const d = order[a.status.level] - order[b.status.level];
    return d !== 0 ? d : a.status.dueTs - b.status.dueTs;
  });
}

// 示例数据：相对今天的偏移生成，保证首次体验就能看到红、黄、绿三种状态
function demoRecords() {
  const now = Date.now();
  // openedDays > 0 时按开封后可保存天数算到期；为 0 时按保质期算到期
  const mk = (name, category, openedOffsetDays, shelfLifeValue, shelfLifeUnit, openedDays, location, notes) => {
    const openedAt = dateUtil.formatDate(dateUtil.addDays(dateUtil.todayStart(), openedOffsetDays));
    return {
      id: 'demo_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      name: name,
      category: category,
      photoPath: '',
      openedAt: openedAt,
      shelfLifeValue: shelfLifeValue,
      shelfLifeUnit: shelfLifeUnit,
      openedDays: openedDays,
      location: location,
      notes: notes,
      createdAt: now,
      updatedAt: now,
      calendarImported: false,
      calendarImportedAt: null,
      calendarReminderDays: 1
    };
  };
  return [
    mk('鲜牛奶', 'fridge', -6, 30, 'day', 7, '冰箱冷藏层', '开封后需冷藏，尽快饮用'), // 剩 1 天 -> 临期
    mk('冷冻水饺', 'freezer', -40, 1, 'month', 0, '冰箱冷冻室', ''),                    // 按保质期 -> 已过期 10 天
    mk('维生素 C 泡腾片', 'medicine', -20, 2, 'year', 60, '药箱', '每天饭后一片'),    // 剩 40 天 -> 安全
    mk('眼霜', 'cosmetics', -95, 3, 'month', 0, '梳妆台', ''),                          // 已过期 5 天
    mk('自制辣酱', 'fridge', -1, 6, 'month', 14, '冰箱冷藏层', ''),                      // 剩 13 天 -> 安全
    mk('眼药水', 'medicine', -24, 6, 'month', 30, '书桌抽屉', '开启后最多使用一个月') // 剩 6 天 -> 临期
  ];
}

module.exports = {
  CATEGORIES,
  SHELF_UNITS,
  categoryOf,
  dueDateOf,
  shelfLifeText,
  computeStatus,
  withStatus,
  sortUrgent,
  demoRecords
};
