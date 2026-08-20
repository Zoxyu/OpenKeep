/**
 * 历史上的今天 · 数据服务
 * 获取策略（渐进增强，保证任何时候都有内容可看）：
 *   1. 当天缓存：同一日期只请求一次，命中即用；
 *   2. 在线接口：仅在下方 API_CONFIG 配置了 key 后才启用；
 *      请求超时 / 失败 / 未配置时一律静默回退本地数据；
 *   3. 本地兜底：内置 366 天精选数据（按月拆分的 JSON 文件），
 *      不联网、零配置、永远可用。
 * 本地数据来源：GitHub 开源项目 PrintNow/TodayInHistory（数据源于维基百科），
 * 经 tools/convert.js 清洗过滤（剔除政治军事敏感条目，单日上限 10 条）后生成；
 * 如需重新生成数据，先下载该项目 history_in_today.json 到 tools/ 目录，
 * 再执行 node tools/convert.js。
 */
const dateUtil = require('./date');

// ====== 在线接口配置（可选，默认关闭） ======
// 启用步骤：1) 下方 enabled 改为 true 并填入 key；
//          2) 在小程序管理后台「开发设置 → 服务器域名」中添加对应合法域名。
// 支持两种免费接口（任选其一）：
//   juhe 聚合数据「历史上的今天」https://www.juhe.cn/docs/api/id/63
//        域名：https://v.juhe.cn  免费额度有限，需实名认证
//   tian 天行数据「历史上的今天」https://www.tianapi.com/apiv1/onthisday
//        域名：https://www.tianapi.com  免费额度有限
const API_CONFIG = {
  enabled: false,
  provider: 'juhe', // 'juhe' | 'tian'
  juheKey: '',      // 聚合数据 appkey
  tianKey: ''       // 天行数据 apikey
};

const REQUEST_TIMEOUT = 5000;
const CACHE_KEY = 'openkeep_history_cache_v1';

// 本地数据：静态 require（微信小程序 require 不支持动态路径，故全部显式引入；
// 注意：基础库不支持 require .json 文件，数据文件必须以 .js 模块形式提供）
const LOCAL_DATA = {
  '01': require('../data/history/01.js'),
  '02': require('../data/history/02.js'),
  '03': require('../data/history/03.js'),
  '04': require('../data/history/04.js'),
  '05': require('../data/history/05.js'),
  '06': require('../data/history/06.js'),
  '07': require('../data/history/07.js'),
  '08': require('../data/history/08.js'),
  '09': require('../data/history/09.js'),
  '10': require('../data/history/10.js'),
  '11': require('../data/history/11.js'),
  '12': require('../data/history/12.js')
};

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

// 读取本地精选数据；2/29 无数据时回退 2/28
function loadLocalEvents(month, day) {
  const file = LOCAL_DATA[month];
  let list = [];
  if (file) {
    list = file[String(day)] || [];
    if (!list.length && month === '02' && day === 29) {
      list = file['28'] || [];
    }
  }
  return list.map(e => ({ year: String(e[0]), text: String(e[1]) }));
}

function readCache() {
  try {
    const v = wx.getStorageSync(CACHE_KEY);
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    return null;
  }
}

function writeCache(date, events) {
  try {
    wx.setStorageSync(CACHE_KEY, { date: date, events: events });
  } catch (e) {
    // 缓存写失败不影响展示
  }
}

// 请求在线接口；未启用 / 超时 / 失败 / 数据非法均返回 null
function fetchRemoteEvents(month, day) {
  return new Promise(resolve => {
    if (!API_CONFIG.enabled) {
      resolve(null);
      return;
    }
    let url = '';
    if (API_CONFIG.provider === 'juhe') {
      url = 'https://v.juhe.cn/todayOnhistory/queryEvent.php?key=' +
        API_CONFIG.juheKey + '&date=' + Number(month) + '/' + day;
    } else {
      url = 'https://www.tianapi.com/apiv1/onthisday/index?key=' +
        API_CONFIG.tianKey + '&date=' + month + '-' + day;
    }
    wx.request({
      url: url,
      method: 'GET',
      timeout: REQUEST_TIMEOUT,
      success: res => {
        let events = null;
        try {
          const result = res.data && res.data.result;
          if (result && Array.isArray(result)) {
            events = result
              .map(it => ({
                year: String(it.year || ''),
                text: String(API_CONFIG.provider === 'juhe' ? it.des : it.title || '').trim()
              }))
              .filter(e => e.text);
          }
        } catch (e) {
          events = null;
        }
        resolve(events && events.length ? events : null);
      },
      fail: () => resolve(null)
    });
  });
}

/**
 * 获取「今天的」历史事件。
 * resolve 结果：{ events: [{year, text}], source: 'cache'|'remote'|'local', date: 'M-D' }
 * @param {boolean} force 为 true 时跳过当天缓存，强制重新获取
 */
function getTodayEvents(force) {
  return new Promise(resolve => {
    const now = dateUtil.todayStart();
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());
    const dayKey = month + '-' + day;

    if (!force) {
      const cache = readCache();
      if (cache && cache.date === dayKey && Array.isArray(cache.events) && cache.events.length) {
        resolve({ events: cache.events, source: 'cache', date: dayKey });
        return;
      }
    }

    fetchRemoteEvents(month, day).then(remote => {
      if (remote && remote.length) {
        writeCache(dayKey, remote);
        resolve({ events: remote, source: 'remote', date: dayKey });
        return;
      }
      resolve({ events: loadLocalEvents(month, day), source: 'local', date: dayKey });
    });
  });
}

// 首页卡片用的本地预览：同步返回当天第一、二条（不触发任何网络请求）
function getLocalPreview() {
  const now = dateUtil.todayStart();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const events = loadLocalEvents(month, day);
  return {
    month: now.getMonth() + 1,
    day: now.getDate(),
    first: events[0] ? events[0].text : '',
    second: events[1] ? events[1].text : ''
  };
}

module.exports = {
  getTodayEvents,
  getLocalPreview,
  loadLocalEvents
};
