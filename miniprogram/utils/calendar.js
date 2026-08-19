/**
 * 日历工具：只「写入」用户主动选择的到期提醒，绝不读取已有日程。
 * 能力依赖 wx.addPhoneCalendar（基础库 2.15.0+），全程做兼容性检测与降级。
 * 注意：日历 API 的时间戳单位为「秒」，alarmOffset（提醒提前量）单位也是「秒」。
 */
const dateUtil = require('./date');

const SCOPE = 'scope.addPhoneCalendar';

// 能力检测：低版本微信 / 不支持的设备返回 false
function isSupported() {
  return !!(wx.canIUse && wx.canIUse('addPhoneCalendar'));
}

// 查询当前授权状态：true 已授权 / false 曾拒绝 / undefined 从未请求
function getAuthStatus() {
  return new Promise(resolve => {
    wx.getSetting({
      success: res => resolve(res.authSetting ? res.authSetting[SCOPE] : undefined),
      fail: () => resolve(undefined)
    });
  });
}

/**
 * 确保已获得日历写入授权。
 * resolve 结果：
 *   { granted: true }                          已授权
 *   { granted: false, deniedBefore: true }     用户曾拒绝，需要解释弹窗 + openSetting 引导
 *   { granted: false, cancelled: true }        本次弹窗中用户点了拒绝
 */
function ensureAuth() {
  return getAuthStatus().then(status => {
    if (status === true) return { granted: true };
    if (status === false) return { granted: false, deniedBefore: true };
    return new Promise(resolve => {
      wx.authorize({
        scope: SCOPE,
        success: () => resolve({ granted: true }),
        fail: () => resolve({ granted: false, cancelled: true })
      });
    });
  });
}

// 引导用户去设置页开启权限，并回查结果
function openSettingAndRecheck() {
  return new Promise(resolve => {
    wx.openSetting({
      success: res => resolve(!!(res.authSetting && res.authSetting[SCOPE])),
      fail: () => resolve(false)
    });
  });
}

/**
 * 完整授权流程（只在用户主动点击导入时调用）：
 * 已授权直接通过；曾拒绝则展示解释弹窗，确认后 openSetting 引导；
 * 本次拒绝则温和提示，不反复骚扰。Promise<boolean> 表示最终是否获得授权。
 */
function requestAuth() {
  return ensureAuth().then(st => {
    if (st.granted) return true;
    if (st.deniedBefore) {
      return new Promise(resolve => {
        wx.showModal({
          title: '需要日历权限',
          content: '写入到期提醒需要「添加手机日历事件」权限。我们只写入你主动选择的提醒，不会读取你的已有日程。',
          confirmText: '去设置',
          cancelText: '暂不',
          success: r => {
            if (r.confirm) {
              resolve(openSettingAndRecheck());
            } else {
              resolve(false);
            }
          },
          fail: () => resolve(false)
        });
      });
    }
    wx.showToast({ title: '未获得日历权限', icon: 'none' });
    return false;
  });
}

/**
 * 构造日历事件参数：
 *   事件时间 = 到期日当天上午 09:00（本地时间，转成秒级时间戳）
 *   标题     = 【临期提醒】物品名称
 *   alarmOffset = 提前提醒天数 × 86400 秒（0 表示事件开始时提醒）
 */
function buildEvent(record, status, reminderDays) {
  const due = dateUtil.parseDate(status.dueDate);
  const start = new Date(due.getFullYear(), due.getMonth(), due.getDate(), 9, 0, 0);
  const lines = [
    '分类：' + (record.categoryLabel || '其他'),
    '开封日期：' + record.openedAt,
    '到期日期：' + status.dueDate,
    '开封后可保存：' + record.shelfLifeDays + ' 天'
  ];
  if (record.notes) lines.push('备注：' + record.notes);
  return {
    title: '【临期提醒】' + record.name,
    startTime: Math.floor(start.getTime() / 1000),
    description: lines.join('\n'),
    alarmOffset: Math.max(0, Number(reminderDays) || 0) * 86400
  };
}

// 写入单条日历事件（Promise 化）
function addEvent(evt) {
  return new Promise((resolve, reject) => {
    wx.addPhoneCalendar({
      title: evt.title,
      startTime: evt.startTime,
      description: evt.description,
      alarmOffset: evt.alarmOffset,
      success: () => resolve(true),
      fail: err => reject(err)
    });
  });
}

module.exports = {
  isSupported,
  getAuthStatus,
  ensureAuth,
  openSettingAndRecheck,
  requestAuth,
  buildEvent,
  addEvent
};
