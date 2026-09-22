const test = require('node:test');
const assert = require('node:assert/strict');
const { reminderOverview } = require('../miniprogram/utils/summary');

const TODAY = new Date(2026, 0, 31);
const SETTINGS = { warningDays: 7, warrantyBeyond30: false };

function record(id, extra = {}) {
  return Object.assign({ id, name: id, openedAt: '2026-01-01', shelfLifeValue: 0,
    shelfLifeUnit: 'day', openedDays: 0, warrantyEnd: '', warrantyHandledDate: '',
    maintenanceCycle: 'none', archived: false }, extra);
}

function shelf(id, daysLeft) {
  return record(id, { shelfLifeValue: 30 + daysLeft });
}

function household(id, dueDate, extra = {}) {
  return Object.assign({ id, title: id, dueDate, type: 'bill', repeatRule: 'none', archived: false }, extra);
}

function all(result) {
  return result.groups.flatMap(group => group.items).concat(result.later.items);
}

function group(result, key) {
  return result.groups.find(entry => entry.key === key);
}

function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

test('空数据和无日期备忘不产生提醒，空分组计数完整', () => {
  for (const records of [[], [record('备忘')]]) {
    const result = reminderOverview(records, [], undefined, TODAY);
    assert.equal(result.total, 0);
    assert.deepEqual(result.groups.map(entry => entry.key), ['overdue', 'today', 'upcoming']);
    for (const entry of result.groups.concat(result.later)) {
      assert.equal(entry.count, 0);
      assert.deepEqual(entry.items, []);
      assert.deepEqual(entry.preview, []);
    }
  }
});

test('跨月的昨日、今天、明天、第七天与第八天分组互不重复', () => {
  const dates = [[-1, '2026-01-30'], [0, '2026-01-31'], [1, '2026-02-01'],
    [7, '2026-02-07'], [8, '2026-02-08']];
  const result = reminderOverview(dates.map(([days]) => shelf('record-' + days, days)),
    dates.map(([days, due]) => household('household-' + days, due)), SETTINGS, TODAY);

  assert.equal(result.total, 8);
  assert.deepEqual(result.groups.map(entry => entry.count), [2, 2, 4]);
  assert.deepEqual(group(result, 'overdue').items.map(entry => entry.daysLeft), [-1, -1]);
  assert.deepEqual(group(result, 'today').items.map(entry => entry.daysLeft), [0, 0]);
  assert.deepEqual(group(result, 'upcoming').items.map(entry => entry.daysLeft), [1, 1, 7, 7]);
  assert.deepEqual(result.later.items.map(entry => entry.id), ['household-8']);
  assert.equal(new Set(all(result).map(entry => entry.key)).size, all(result).length);
});

test('近期窗口固定七天，三天临期设置不缩短窗口，十四天设置保留后续临期物品', () => {
  const records = [3, 4, 7, 8, 14, 15].map(days => shelf('shelf-' + days, days));
  const short = reminderOverview(records, [], { warningDays: 3 }, TODAY);
  const long = reminderOverview(records, [], { warningDays: 14 }, TODAY);

  for (const result of [short, long]) {
    assert.deepEqual(group(result, 'upcoming').items.map(entry => entry.daysLeft), [3, 4, 7]);
    assert.equal(result.total, 3);
  }
  assert.equal(short.later.count, 0);
  assert.deepEqual(long.later.items.map(entry => entry.daysLeft), [8, 14]);
  assert.ok(all(long).every(entry => entry.id !== 'shelf-15'));
});

test('保修支持超期和三十天边界，远期保修开关不扩大维保窗口', () => {
  const dates = [[-1, '2026-01-30'], [0, '2026-01-31'], [7, '2026-02-07'],
    [8, '2026-02-08'], [30, '2026-03-02'], [31, '2026-03-03']];
  const records = dates.map(([days, due]) => record('w-' + days, { warrantyEnd: due }))
    .concat([8, 30, 31].map(days => record('m-' + days, {
      maintenanceLast: '2026-01-31', maintenanceCycle: 'custom', maintenanceCycleDays: days
    })));
  const standard = reminderOverview(records, [], SETTINGS, TODAY);
  const extended = reminderOverview(records, [], { ...SETTINGS, warrantyBeyond30: true }, TODAY);

  assert.equal(group(standard, 'overdue').items[0].label, '已过保 1 天');
  assert.equal(group(standard, 'today').items[0].label, '今天过保');
  assert.deepEqual(standard.later.items.filter(entry => entry.kind === 'warranty').map(entry => entry.daysLeft), [8, 30]);
  assert.deepEqual(extended.later.items.filter(entry => entry.kind === 'warranty').map(entry => entry.daysLeft), [8, 30, 31]);
  for (const result of [standard, extended]) {
    assert.deepEqual(result.later.items.filter(entry => entry.kind === 'maintenance').map(entry => entry.daysLeft), [8, 30]);
    assert.equal(result.total, 3);
  }
});

test('混合物品的三种日期分别提醒，两来源同名同 ID 也有独立稳定 key', () => {
  const item = record('同一个ID', { name: '共用名称', shelfLifeValue: 30,
    warrantyEnd: '2026-01-31', maintenanceLast: '2025-12-31', maintenanceCycle: 'monthly' });
  const event = household('同一个ID', '2026-01-31', { title: '共用名称', type: 'insurance' });
  const result = reminderOverview([item], [event], SETTINGS, TODAY);
  const entries = group(result, 'today').items;

  assert.equal(result.total, 4);
  assert.equal(new Set(entries.map(entry => entry.key)).size, 4);
  assert.deepEqual(entries.filter(entry => entry.source === 'record').map(entry => entry.kind).sort(),
    ['due', 'maintenance', 'warranty']);
  assert.equal(entries.find(entry => entry.source === 'household').typeText, '保险续期');
  assert.deepEqual(entries.map(entry => entry.key), group(reminderOverview([item], [event], SETTINGS, TODAY), 'today').items.map(entry => entry.key));
});

test('整件归档排除全部提醒，保修已处理仅抑制当前保修日期', () => {
  const mixed = record('active', { shelfLifeValue: 30, warrantyEnd: '2026-01-31',
    warrantyHandledDate: '2026-01-31', maintenanceLast: '2025-12-31', maintenanceCycle: 'monthly' });
  const result = reminderOverview([mixed, { ...mixed, id: 'archived', archived: true }],
    [household('archived-hh', '2026-01-31', { archived: true })], SETTINGS, TODAY);

  assert.equal(result.total, 2);
  assert.deepEqual(all(result).map(entry => entry.kind).sort(), ['due', 'maintenance']);
  assert.ok(all(result).every(entry => entry.id === 'active'));
  const changedDate = reminderOverview([{ ...mixed, warrantyEnd: '2026-02-01' }], [], SETTINGS, TODAY);
  assert.equal(changedDate.total, 3);
  assert.equal(group(changedDate, 'upcoming').items[0].kind, 'warranty');
  const undone = reminderOverview([{ ...mixed, warrantyHandledDate: '' }], [], SETTINGS, TODAY);
  assert.equal(group(undone, 'today').count, 3);
});

test('远期家庭事项始终保留，周期事项仅显示当前一期且不会跳过欠账', () => {
  const households = [
    household('past', '2025-01-31', { repeatRule: 'monthly', repeatAnchor: '2025-01-31', repeatIndex: 0 }),
    household('far-4', '2036-01-31'), household('far-2', '2026-03-01'),
    household('far-1', '2026-02-08'), household('far-3', '2027-01-31', { repeatRule: 'yearly' })
  ];
  const result = reminderOverview([], households, SETTINGS, TODAY);

  assert.equal(result.total, 1);
  assert.equal(group(result, 'overdue').items[0].dueDate, '2025-01-31');
  assert.equal(result.later.count, 4);
  assert.deepEqual(result.later.items.map(entry => entry.id), ['far-1', 'far-2', 'far-3', 'far-4']);
  assert.deepEqual(result.later.preview.map(entry => entry.id), ['far-1', 'far-2', 'far-3']);
  assert.equal(all(result).length, households.length);
  assert.equal(households[0].dueDate, '2025-01-31');
  assert.equal(households[0].repeatIndex, 0);
});

test('各组按日期、名称稳定排序并只预览三条，反转输入不影响结果且不修改输入', () => {
  const households = [];
  for (const [period, firstDate, lastDate] of [
    ['overdue', '2026-01-20', '2026-01-30'],
    ['today', '2026-01-31', '2026-01-31'],
    ['upcoming', '2026-02-01', '2026-02-07'],
    ['later', '2026-02-08', '2027-01-31']
  ]) {
    households.push(household(period + '-z', lastDate, { title: 'Z' }),
      household(period + '-c', firstDate, { title: 'C' }),
      household(period + '-a', firstDate, { title: 'A' }),
      household(period + '-b', firstDate, { title: 'B' }));
  }
  const input = freezeDeep({ records: [record('memo', { processingHistory: [] })], households,
    settings: { ...SETTINGS } });
  const before = JSON.stringify(input);
  const result = reminderOverview(input.records, input.households, input.settings, TODAY);

  for (const entry of result.groups.concat(result.later)) {
    assert.equal(entry.count, 4);
    assert.deepEqual(entry.items.map(item => item.title), ['A', 'B', 'C', 'Z']);
    assert.deepEqual(entry.preview.map(item => item.title), ['A', 'B', 'C']);
  }
  assert.deepEqual(reminderOverview(input.records, [...input.households].reverse(), input.settings, TODAY), result);
  assert.equal(JSON.stringify(input), before);
  assert.equal(TODAY.getTime(), new Date(2026, 0, 31).getTime());
});

test('月底月周期和闰日年周期复用日历日期，月底当天仍归入今天', () => {
  const records = [
    record('month-end', { openedAt: '2025-01-31', shelfLifeValue: 1, shelfLifeUnit: 'month',
      maintenanceLast: '2025-01-31', maintenanceCycle: 'monthly' }),
    record('leap-year', { openedAt: '2024-02-29', shelfLifeValue: 1, shelfLifeUnit: 'year',
      maintenanceLast: '2024-02-29', maintenanceCycle: 'yearly' })
  ];
  const result = reminderOverview(records, [], SETTINGS, new Date(2025, 1, 28));

  assert.equal(result.total, 4);
  assert.equal(group(result, 'today').count, 4);
  assert.ok(all(result).every(entry => entry.dueDate === '2025-02-28' && entry.daysLeft === 0));
});

test('闰日从明天到今天再到超期按本地日期重算，维保和家庭事项不会自动续期', () => {
  const records = [record('leap-month', { openedAt: '2024-01-31', shelfLifeValue: 1, shelfLifeUnit: 'month',
    maintenanceLast: '2024-01-31', maintenanceCycle: 'monthly' })];
  const households = [household('leap-hh', '2024-02-29', { repeatRule: 'yearly' })];

  for (const [today, expected, daysLeft] of [
    [new Date(2024, 1, 28), 'upcoming', 1],
    [new Date(2024, 1, 29), 'today', 0],
    [new Date(2024, 2, 1), 'overdue', -1]
  ]) {
    const result = reminderOverview(records, households, SETTINGS, today);
    assert.equal(result.total, 3);
    assert.equal(group(result, expected).count, 3);
    assert.ok(all(result).every(entry => entry.dueDate === '2024-02-29' && entry.daysLeft === daysLeft));
  }
  assert.equal(records[0].maintenanceLast, '2024-01-31');
  assert.equal(households[0].dueDate, '2024-02-29');
});

test('每日维保今天完成后仍显示明日下一期，不把处理历史视为永久消除', () => {
  const item = record('daily', { maintenanceLast: '2026-01-31', maintenanceCycle: 'custom', maintenanceCycleDays: 1,
    processingHistory: [{ kind: 'maintenance', dueDate: '2026-01-31', nextDate: '2026-02-01', undoneAt: null }] });
  const result = reminderOverview([item], [], SETTINGS, TODAY);

  assert.equal(result.total, 1);
  assert.equal(group(result, 'today').count, 0);
  const next = group(result, 'upcoming').items[0];
  assert.equal(next.kind, 'maintenance');
  assert.equal(next.dueDate, '2026-02-01');
  assert.equal(next.daysLeft, 1);
  assert.equal(item.processingHistory.length, 1);
});
