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

const DEFAULT_SETTINGS = { warningDays: 7, theme: 'system' };
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

  const shelf = parseInt(raw.shelfLifeDays, 10);
  const now = Date.now();
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : genId(),
    name: name,
    category: CATEGORY_KEYS.indexOf(raw.category) > -1 ? raw.category : 'other',
    photoPath: typeof raw.photoPath === 'string' ? raw.photoPath : '',
    openedAt: dateUtil.parseDate(raw.openedAt) ? raw.openedAt : dateUtil.todayStr(),
    shelfLifeDays: (isFinite(shelf) && shelf >= 1 && shelf <= 3650) ? shelf : 30,
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 100) : '',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
    calendarImported: !!raw.calendarImported,
    calendarImportedAt: typeof raw.calendarImportedAt === 'number' ? raw.calendarImportedAt : null,
    calendarReminderDays: [0, 1, 3, 7].indexOf(raw.calendarReminderDays) > -1 ? raw.calendarReminderDays : 1
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
  const s = { warningDays: DEFAULT_SETTINGS.warningDays, theme: DEFAULT_SETTINGS.theme };
  if (raw && typeof raw === 'object') {
    if (VALID_WARN_DAYS.indexOf(raw.warningDays) > -1) s.warningDays = raw.warningDays;
    if (['system', 'light', 'dark'].indexOf(raw.theme) > -1) s.theme = raw.theme;
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
