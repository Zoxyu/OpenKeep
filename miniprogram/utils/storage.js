/**
 * 本地存储工具：带数据版本号的键名 + 完整容错。
 * 所有数据仅保存在 wx.setStorage / wx.getStorage 本地缓存中，不使用云开发。
 * 展示读取可容错；写入前严格读取，失败时保留原缓存。
 */
const dateUtil = require('./date');
const householdUtil = require('./household');
const repeatUtil = require('./repeat');
const calendarState = require('./calendar-state');

const VERSION = 1;
const KEYS = {
  records: 'openkeep_records_v' + VERSION,
  household: 'openkeep_household_v' + VERSION,
  settings: 'openkeep_settings_v' + VERSION,
  onboarded: 'openkeep_onboarded_v' + VERSION
};

const DEFAULT_SETTINGS = { warningDays: 7, theme: 'system', warrantyBeyond30: false };
const VALID_WARN_DAYS = [3, 7, 14];
const CATEGORY_KEYS = ['fridge', 'freezer', 'medicine', 'cosmetics', 'other'];

function safeGet(key, fallback) {
  try {
    const v = wx.getStorageSync(key);
    return (v === '' || v === null || v === undefined) ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function safeSet(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

function safeRemove(key) {
  try {
    wx.removeStorageSync(key);
  } catch (e) {
    // 忽略
  }
}

// 生成唯一 ID
function genId() {
  return 'ok_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// 处理历史与所属记录同一次写入，避免状态与归档仅一项保存成功。
function normalizeProcessingHistory(value) {
  if (!Array.isArray(value)) return [];
  const kinds = ['household', 'consumed', 'discarded', 'warranty', 'maintenance', 'archive'];
  const fields = ['archived', 'dueDate', 'repeatAnchor', 'repeatIndex', 'maintenanceLast', 'warrantyHandledDate'];
  function patch(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    fields.forEach(key => {
      if (key === 'archived' && typeof raw[key] === 'boolean') out[key] = raw[key];
      else if (key === 'repeatIndex' && Number.isInteger(raw[key]) && raw[key] >= 0) out[key] = raw[key];
      else if (key !== 'archived' && key !== 'repeatIndex' && (raw[key] === '' || dateUtil.parseDate(raw[key]))) out[key] = raw[key];
    });
    return out;
  }
  return value.filter(e => e && typeof e.id === 'string' && kinds.indexOf(e.kind) >= 0 && Number.isFinite(e.processedAt)).map(e => ({
    id: e.id, kind: e.kind, title: typeof e.title === 'string' ? e.title.slice(0, 30) : '',
    dueDate: dateUtil.parseDate(e.dueDate) ? e.dueDate : '',
    nextDate: dateUtil.parseDate(e.nextDate) ? e.nextDate : '',
    processedAt: e.processedAt, undoneAt: Number.isFinite(e.undoneAt) ? e.undoneAt : null,
    before: patch(e.before), after: patch(e.after), guard: typeof e.guard === 'string' ? e.guard : ''
  }));
}

// 规范化单条记录：补齐缺失字段、纠正非法值；关键字段（名称）缺失时返回 null
function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 30) : '';
  if (!name) return null;

  const now = Date.now();

  // 开封后可保存天数：可选（1–3650），未填为 0 表示按保质期计算到期
  const openedDaysRaw = parseInt(raw.openedDays, 10);
  let openedDays = (isFinite(openedDaysRaw) && openedDaysRaw >= 1 && openedDaysRaw <= 3650) ? openedDaysRaw : 0;

  // 保质期：数值（1–3650）+ 单位（天/个月/年）
  const shelfRaw = parseInt(raw.shelfLifeValue, 10);
  let shelfLifeValue = (isFinite(shelfRaw) && shelfRaw >= 1 && shelfRaw <= 3650) ? shelfRaw : 0;
  const shelfLifeUnit = ['day', 'month', 'year'].indexOf(raw.shelfLifeUnit) > -1 ? raw.shelfLifeUnit : 'day';

  // 旧版本数据迁移：旧字段 shelfLifeDays 的语义即「开封后可保存天数」
  if (raw.openedDays === undefined && shelfLifeValue === 0) {
    const legacy = parseInt(raw.shelfLifeDays, 10);
    if (isFinite(legacy) && legacy >= 1 && legacy <= 3650) {
      openedDays = legacy;
    }
  }

  // ===== M1 家庭物品管家：购买 / 保修字段（全部可选，旧数据读时自动补默认）=====
  // 仅作类型校验与默认兜底；不参与到期状态计算，不影响照片 / 删除 / 日历字段。
  // 购买日期：'YYYY-MM-DD'，经 date.js 校验，非法 / 未填为 ''
  const purchaseDate = dateUtil.parseDate(raw.purchaseDate) ? raw.purchaseDate : '';
  // 保修结束日期：'YYYY-MM-DD'，经 date.js 校验，非法 / 未填为 ''
  const warrantyEnd = dateUtil.parseDate(raw.warrantyEnd) ? raw.warrantyEnd : '';
  // 购买价格：number|null，仅接受有限且 >=0 的数值并保留两位小数；未填 / 非法为 null
  //（不引入折旧 / 财务 / 货币逻辑，null 与 0 语义不同：null = 未填写）
  let purchasePrice = null;
  const priceNum = Number(raw.purchasePrice);
  if ((typeof raw.purchasePrice === 'number' ||
       (typeof raw.purchasePrice === 'string' && raw.purchasePrice.trim() !== '')) &&
      isFinite(priceNum) && priceNum >= 0) {
    purchasePrice = Math.round(priceNum * 100) / 100;
  }

  // ===== M1 第二批次：维护周期字段（全部可选；下次维护日为派生值、不落库）=====
  // 上次维护日期：'YYYY-MM-DD'，经 date.js 校验，非法 / 未填为 ''
  const maintenanceLast = dateUtil.parseDate(raw.maintenanceLast) ? raw.maintenanceLast : '';
  // 维护周期：none/monthly/yearly/custom，旧数据默认 none
  const maintenanceCycle = ['none', 'monthly', 'yearly', 'custom'].indexOf(raw.maintenanceCycle) > -1 ? raw.maintenanceCycle : 'none';
  // 自定义周期天数：1–3650 整数（仅 custom 有意义），非法 / 未填为 0
  const mcDaysRaw = parseInt(raw.maintenanceCycleDays, 10);
  const maintenanceCycleDays = (isFinite(mcDaysRaw) && mcDaysRaw >= 1 && mcDaysRaw <= 3650) ? mcDaysRaw : 0;

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : genId(),
    name: name,
    category: CATEGORY_KEYS.indexOf(raw.category) > -1 ? raw.category : 'other',
    photoPath: typeof raw.photoPath === 'string' ? raw.photoPath : '',
    openedAt: dateUtil.parseDate(raw.openedAt) ? raw.openedAt : dateUtil.todayStr(),
    shelfLifeValue: shelfLifeValue,
    shelfLifeUnit: shelfLifeUnit,
    openedDays: openedDays,
    location: typeof raw.location === 'string' ? raw.location.trim().slice(0, 20) : '',
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 100) : '',
    purchaseDate: purchaseDate,
    purchasePrice: purchasePrice,
    warrantyEnd: warrantyEnd,
    maintenanceLast: maintenanceLast,
    maintenanceCycle: maintenanceCycle,
    maintenanceCycleDays: maintenanceCycleDays,
    archived: raw.archived === true,
    warrantyHandledDate: dateUtil.parseDate(raw.warrantyHandledDate) ? raw.warrantyHandledDate : '',
    processingHistory: normalizeProcessingHistory(raw.processingHistory),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
    calendarImported: !!raw.calendarImported,
    calendarEntries: calendarState.normalize(raw.calendarEntries),
    calendarLegacyUnknown: calendarState.legacyUnknown(raw),
    calendarImportedAt: typeof raw.calendarImportedAt === 'number' ? raw.calendarImportedAt : null,
    calendarReminderDays: [0, 1, 2, 3, 5, 7, 14].indexOf(raw.calendarReminderDays) > -1 ? raw.calendarReminderDays : 1
  };
}

function loadRecords() {
  const raw = safeGet(KEYS.records, []);
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeRecord).filter(Boolean);
}

// 写入必须读取原始数组，不能用展示层的空数组兜底覆盖损坏或暂时无法读取的数据。
function readRecordRows() {
  const rows = wx.getStorageSync(KEYS.records);
  if (rows === '' || rows === undefined) return [];
  if (!Array.isArray(rows)) throw new Error('invalid record storage');
  return rows;
}

function saveRecords(list) {
  if (!Array.isArray(list)) return false;
  try {
    readRecordRows();
    return safeSet(KEYS.records, list);
  } catch (e) { return false; }
}

function getRecord(id) {
  if (!id) return null;
  const list = loadRecords();
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

// 新增或更新一条记录（按 id 匹配）
function upsertRecord(record, mustExist) {
  const normalized = normalizeRecord(record);
  if (!normalized) return false;
  try {
    // 只修改目标行，其余原始行（包括未知字段和不能展示的条目）原样保留。
    const rows = readRecordRows().slice();
    const index = rows.findIndex(row => row && row.id === normalized.id);
    if (mustExist && index < 0) return false;
    if (index < 0) rows.push(normalized);
    else rows[index] = Object.assign({}, rows[index], normalized);
    return safeSet(KEYS.records, rows);
  } catch (e) { return false; }
}

function removeRecord(id) {
  if (typeof id !== 'string' || !id) return false;
  try {
    const rows = readRecordRows();
    if (!rows.some(row => row && row.id === id)) return false;
    return safeSet(KEYS.records, rows.filter(row => !row || row.id !== id));
  } catch (e) { return false; }
}

// 家庭事项单独存储，旧物品键、字段与统计语义保持不变。
// 无合法名称/日期/id 的缓存条目不显示，读取时不生成 id 或写回缓存。
function normalizeHousehold(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 30) : '';
  const due = dateUtil.parseDate(raw.dueDate);
  if (!title || !due) return null;
  return {
    id: raw.id,
    title: title,
    type: Object.prototype.hasOwnProperty.call(householdUtil.TYPES, raw.type) ? raw.type : 'bill',
    dueDate: dateUtil.formatDate(due),
    repeatRule: Object.prototype.hasOwnProperty.call(repeatUtil.RULES, raw.repeatRule) ? raw.repeatRule : 'none',
    repeatAnchor: dateUtil.parseDate(raw.repeatAnchor) ? raw.repeatAnchor : dateUtil.formatDate(due),
    repeatIndex: Number.isInteger(raw.repeatIndex) && raw.repeatIndex >= 0 ? raw.repeatIndex : 0,
    archived: raw.archived === true,
    processingHistory: normalizeProcessingHistory(raw.processingHistory),
    calendarImportedFor: typeof raw.calendarImportedFor === 'string' ? raw.calendarImportedFor : '',
    calendarImportedAt: Number.isFinite(raw.calendarImportedAt) ? raw.calendarImportedAt : null,
    calendarReminderDays: [0, 1, 2, 3, 5, 7, 14].indexOf(raw.calendarReminderDays) >= 0 ? raw.calendarReminderDays : 1,
    notes: typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 100) : '',
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  };
}

function readHouseholdRows() {
  // 读取失败不能按空列表继续写入，以免覆盖已有事项；由页面显示可重试错误。
  const rows = wx.getStorageSync(KEYS.household);
  if (rows === '' || rows === null || rows === undefined) return [];
  if (!Array.isArray(rows)) throw new Error('invalid household storage');
  return rows;
}

function loadHousehold() {
  return readHouseholdRows().map(normalizeHousehold).filter(Boolean);
}

function getHousehold(id) {
  return loadHousehold().find(item => item.id === id) || null;
}

function upsertHousehold(raw, mustExist) {
  const item = normalizeHousehold(raw);
  if (!item || Object.keys(householdUtil.validate(raw)).length) return false;
  try {
    // 保留其它原始条目（含未知字段），只替换当前事项。
    const rows = readHouseholdRows().slice();
    const index = rows.findIndex(row => row && row.id === item.id);
    if (mustExist && index < 0) return false;
    if (index < 0) rows.push(item);
    else rows[index] = item;
    return safeSet(KEYS.household, rows);
  } catch (e) { return false; }
}

function removeHousehold(id) {
  try {
    const rows = readHouseholdRows();
    if (!rows.some(row => row && row.id === id)) return false;
    return safeSet(KEYS.household, rows.filter(row => !row || row.id !== id));
  } catch (e) { return false; }
}

// 严格读取用于处理、归档与日历写入；失败时不按空缓存覆盖。
function loadEntriesStrict(source) {
  if (source !== 'record' && source !== 'household') throw new Error('invalid source');
  const rows = wx.getStorageSync(source === 'record' ? KEYS.records : KEYS.household);
  if (rows === '' || rows === null || rows === undefined) return [];
  if (!Array.isArray(rows)) throw new Error('invalid storage');
  return rows.map(source === 'record' ? normalizeRecord : normalizeHousehold).filter(Boolean);
}

function updateExisting(source, id, transform) {
  if (source !== 'record' && source !== 'household') throw new Error('invalid source');
  const key = source === 'record' ? KEYS.records : KEYS.household;
  const raw = wx.getStorageSync(key);
  if (!Array.isArray(raw)) throw new Error('记录已不存在或无法读取');
  const rows = raw.slice();
  const index = rows.findIndex(r => r && r.id === id);
  if (index < 0) throw new Error('记录已不存在');
  const normalize = source === 'record' ? normalizeRecord : normalizeHousehold;
  const current = normalize(rows[index]);
  if (!current) throw new Error('记录无法读取');
  const updated = normalize(transform(current));
  if (!updated || updated.id !== id) throw new Error('记录无效');
  rows[index] = updated;
  return safeSet(key, rows);
}

function loadSettings() {
  const raw = safeGet(KEYS.settings, null);
  const s = { warningDays: DEFAULT_SETTINGS.warningDays, theme: DEFAULT_SETTINGS.theme, warrantyBeyond30: DEFAULT_SETTINGS.warrantyBeyond30 };
  if (raw && typeof raw === 'object') {
    if (VALID_WARN_DAYS.indexOf(raw.warningDays) > -1) s.warningDays = raw.warningDays;
    if (['system', 'light', 'dark'].indexOf(raw.theme) > -1) s.theme = raw.theme;
    // M1：保修提醒窗口开关（默认 false＝只看 30 天内；true＝超过 30 天的保修也纳入看板卡与批量导入候选）
    if (typeof raw.warrantyBeyond30 === 'boolean') s.warrantyBeyond30 = raw.warrantyBeyond30;
  }
  return s;
}

function saveSettings(settings) {
  return safeSet(KEYS.settings, settings);
}

// 是否已完成首次启动引导（决定是否展示「示例数据 / 空白开始」选择）
function isOnboarded() {
  return !!safeGet(KEYS.onboarded, false);
}

function setOnboarded() {
  safeSet(KEYS.onboarded, true);
}

// 清空全部本地数据：先逐条删除本地照片文件，再清空所有缓存键
function clearAllData() {
  const fs = wx.getFileSystemManager();
  loadRecords().forEach(r => {
    if (r.photoPath && r.photoPath.indexOf(wx.env.USER_DATA_PATH) === 0) {
      try {
        fs.unlinkSync(r.photoPath);
      } catch (e) {
        // 文件不存在时忽略
      }
    }
  });
  safeRemove(KEYS.records);
  safeRemove(KEYS.household);
  safeRemove(KEYS.settings);
  safeRemove(KEYS.onboarded);
}

module.exports = {
  genId,
  loadEntriesStrict,
  updateExisting,
  normalizeRecord,
  loadRecords,
  saveRecords,
  getRecord,
  upsertRecord,
  removeRecord,
  normalizeHousehold,
  loadHousehold,
  getHousehold,
  upsertHousehold,
  removeHousehold,
  loadSettings,
  saveSettings,
  isOnboarded,
  setOnboarded,
  clearAllData
};
