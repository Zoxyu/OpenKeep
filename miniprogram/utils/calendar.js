/**
 * 日历工具：只「写入」用户主动选择的到期提醒，绝不读取已有日程。
 * 能力依赖 wx.addPhoneCalendar（基础库 2.15.0+），全程做兼容性检测与降级。
 * 注意：日历 API 的时间戳单位为「秒」，alarmOffset（提醒提前量）单位也是「秒」。
 */
const dateUtil = require('./date');
const recordUtil = require('./record');

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
 *   { granted: true, fresh: true }              本次刚刚通过 wx.authorize 获得授权（首次授权）
 *   { granted: true }                            之前已授权
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
        success: () => resolve({ granted: true, fresh: true }),
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
 * 本次拒绝则温和提示，不反复骚扰。
 * resolve 结果：{ granted: boolean, fresh: boolean }
 *   fresh = true 表示本次刚刚获得授权（首次授权）。
 *   安卓端首次授权通过的瞬间系统权限还在同步，紧接着发起的第一次
 *   wx.addPhoneCalendar 可能被系统吞掉（微信甚至可能误报 success），
 *   调用方应据此让用户再点击一次「开始写入」而非立即写入。
 */
function requestAuth() {
  return ensureAuth().then(st => {
    if (st.granted) return { granted: true, fresh: !!st.fresh };
    if (st.deniedBefore) {
      return new Promise(resolve => {
        wx.showModal({
          title: '需要日历权限',
          content: '写入到期提醒需要「添加手机日历事件」权限。我们只写入你主动选择的提醒，不会读取你的已有日程。',
          confirmText: '去设置',
          cancelText: '暂不',
          success: r => {
            if (r.confirm) {
              resolve(openSettingAndRecheck().then(ok => ({ granted: ok, fresh: ok })));
            } else {
              resolve({ granted: false, fresh: false });
            }
          },
          fail: () => resolve({ granted: false, fresh: false })
        });
      });
    }
    wx.showToast({ title: '未获得日历权限', icon: 'none' });
    return { granted: false, fresh: false };
  });
}

/**
 * 构造日历事件参数：
 *   事件时间 = 到期日当天上午 09:00（本地时间，转成秒级时间戳）
 *   到期日依据：已填「开封后可保存天数」则按它，否则按保质期（已在状态计算中处理）
 *   标题：填了存放位置时为「存放位置 的 物品名称 快要到期啦」
 *   alarmOffset = 提前提醒天数 × 86400 秒（0 表示事件开始时提醒）
 * 安卓兼容处理：
 *   1. 已过期物品的到期时间在过去，部分安卓日历 Provider 会拒绝创建过去事件，
 *      统一钳制到最近一个未来的上午 09:00（今天 9 点前用今天，否则用明天）；
 *   2. 显式传入 endTime（部分安卓日历要求结束时间晚于开始时间，
 *      不传时默认与 startTime 相同，即零时长事件，可能写入异常）；
 *   3. 显式传入 alarm: true，避免部分机型默认不提醒。
 * 到期日期非法时返回 null，由调用方按失败处理，不影响后续条目。
 */
function buildEvent(record, status, reminderDays) {
  const due = dateUtil.parseDate(status && status.dueDate);
  if (!due) return null;

  // 事件开始时间：到期日 09:00；已过期则钳制到最近一个未来的 09:00
  let start = new Date(due.getFullYear(), due.getMonth(), due.getDate(), 9, 0, 0);
  const isExpired = start.getTime() <= Date.now();
  if (isExpired) {
    const now = new Date();
    const todayAt9 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
    start = todayAt9.getTime() > now.getTime()
      ? todayAt9
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
  }

  // 标题：带存放位置时生成「冰箱冷冻室 的 冷冻水饺 快要到期啦」
  const title = record.location
    ? record.location + ' 的 ' + record.name + ' 快要到期啦'
    : record.name + ' 快要到期啦';

  const lines = [
    '分类：' + (record.categoryLabel || '其他')
  ];
  if (record.location) lines.push('存放位置：' + record.location);
  lines.push('开封日期：' + record.openedAt);
  lines.push('到期日期：' + status.dueDate + (isExpired ? '（已过期，提醒时间已调整）' : ''));
  const shelfText = recordUtil.shelfLifeText(record);
  if (shelfText) lines.push('保质期：' + shelfText);
  if (record.openedDays > 0) lines.push('开封后可保存：' + record.openedDays + ' 天');
  if (record.notes) lines.push('备注：' + record.notes);

  const startTimeSec = Math.floor(start.getTime() / 1000);
  return {
    title: title,
    startTime: startTimeSec,
    endTime: startTimeSec + 3600, // 结束时间：开始后 1 小时，规避零时长事件
    description: lines.join('\n'),
    alarm: true,
    alarmOffset: Math.max(0, Number(reminderDays) || 0) * 86400
  };
}

// 写入单条日历事件（Promise 化）
function addEvent(evt) {
  return new Promise((resolve, reject) => {
    wx.addPhoneCalendar({
      title: evt.title,
      startTime: evt.startTime,
      endTime: evt.endTime,
      description: evt.description,
      alarm: evt.alarm !== false,
      alarmOffset: evt.alarmOffset,
      success: () => resolve(true),
      fail: err => reject(err)
    });
  });
}

/**
 * 把底层 errMsg 翻译成用户能看懂的失败原因（批量导入结果页展示用）。
 * 安卓端常见报错：系统日历页被取消、写入过快、日历权限被收回等。
 */
function friendlyError(err) {
  const msg = (err && err.errMsg) || String(err || '');
  if (!msg) return '未知原因';
  if (/cancel/i.test(msg)) return '在系统日历确认页被取消';
  if (/authoriz|permission|权限/i.test(msg)) return '日历权限未开启（可在手机设置中检查微信的日历权限）';
  if (/gesture/i.test(msg)) return '需要在点击操作后立即执行，请重试';
  if (/frequen|频繁|too fast|busy/i.test(msg)) return '写入过于频繁，请稍后重试';
  if (/not support|can not|canIUse/i.test(msg)) return '当前设备或微信版本不支持';
  if (/error/i.test(msg)) return '系统日历写入失败：' + msg;
  return msg;
}

module.exports = {
  isSupported,
  getAuthStatus,
  ensureAuth,
  openSettingAndRecheck,
  requestAuth,
  buildEvent,
  addEvent,
  friendlyError
};
