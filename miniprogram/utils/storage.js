/**
 * 本地存储工具：带数据版本号的键名 + 完整容错。
 * 所有数据仅保存在 wx.setStorage / wx.getStorage 本地缓存中，不使用云开发。
 * 缓存损坏、字段缺失时一律降级为默认值，保证页面不会白屏。
 */
const dateUtil = require('./date');

const VERSION = 1;
const KEYS = {
  records: 'openkeep_records_v' + VERSION,
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
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
    calendarImported: !!raw.calendarImported,
    calendarImportedAt: typeof raw.calendarImportedAt === 'number' ? raw.calendarImportedAt : null,
    calendarReminderDays: [0, 1, 2, 3, 5, 7, 14].indexOf(raw.calendarReminderDays) > -1 ? raw.calendarReminderDays : 1
  };
}

function loadRecords() {
  const raw = safeGet(KEYS.records, []);
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeRecord).filter(Boolean);
}

function saveRecords(list) {
  return safeSet(KEYS.records, Array.isArray(list) ? list : []);
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
function upsertRecord(record) {
  const normalized = normalizeRecord(record);
  if (!normalized) return false;
  const list = loadRecords();
  let found = false;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === normalized.id) {
      list[i] = normalized;
      found = true;
      break;
    }
  }
  if (!found) list.push(normalized);
  return saveRecords(list);
}

function removeRecord(id) {
  const list = loadRecords().filter(r => r.id !== id);
  return saveRecords(list);
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
  safeRemove(KEYS.settings);
  safeRemove(KEYS.onboarded);
}

module.exports = {
  genId,
  normalizeRecord,
  loadRecords,
  saveRecords,
  getRecord,
  upsertRecord,
  removeRecord,
  loadSettings,
  saveSettings,
  isOnboarded,
  setOnboarded,
  clearAllData
};
