/**
 * 临时真机主题诊断。默认关闭；只存内存中的主题/生命周期信息，不读写业务记录。
 * 开启后才包装实例 setData，用完成回调区分逻辑层已改值与视图层确认。
 * 回调不是屏幕截图，不能据此断言原生合成帧已经换色。
 */
const LIMIT = 400;
const targets = new Map();
let enabled = false, session = 0, nextTarget = 0, nextRequest = 0;
let startedAt = 0, sequence = 0, revision = 0, dropped = 0, events = [], getDark = () => false;

function snapshot(target) {
  const data = target && target.data || {};
  const result = {};
  for (const key of ['dark', 'themeReady', 'contentReady']) {
    if (typeof data[key] === 'boolean') result[key] = data[key];
  }
  if (Number.isInteger(data.selected)) result.selected = data.selected;
  return result;
}

function record(event, info, details) {
  if (!enabled) return;
  try {
    const row = Object.assign({ seq: ++sequence, ms: Date.now() - startedAt, event,
      effectiveDark: getDark(), themeRevision: revision }, info ? {
      instance: info.id, target: info.label, visible: info.visible,
      state: snapshot(info.target)
    } : {}, details);
    if (events.length === LIMIT) { events.shift(); dropped++; }
    events.push(row);
  } catch (e) { /* 诊断失败不影响页面与切页 */ }
}

function restore(info) {
  if (info.wrapper && info.target.setData === info.wrapper) info.target.setData = info.original;
  info.wrapper = null;
}

function instrument(info) {
  if (info.wrapper || typeof info.target.setData !== 'function') return;
  const original = info.target.setData;
  const captureSession = session;
  info.original = original;
  info.wrapper = function(patch, callback) {
    // 普通业务刷新保持原调用；不读取或记录名称、搜索、列表和备注。
    if (!enabled || captureSession !== session || !patch || typeof patch.dark !== 'boolean') {
      return original.apply(this, arguments);
    }
    const request = ++nextRequest, requestedDark = patch.dark, requestRevision = revision;
    record('theme-send', info, { request, requestedDark, requestRevision });
    return original.call(this, patch, function() {
      if (enabled && captureSession === session && targets.get(info.target) === info) {
        record('theme-ack', info, { request, requestedDark, requestRevision });
      }
      if (typeof callback === 'function') return callback.apply(this, arguments);
    });
  };
  info.target.setData = info.wrapper;
}

function attach(target, label) {
  if (targets.has(target)) return;
  const info = { target, label, id: ++nextTarget, visible: null };
  targets.set(target, info);
  if (enabled) instrument(info);
  record('attach', info);
}

function lifecycle(target, event) {
  const info = targets.get(target);
  if (!info) return;
  if (event === 'show') info.visible = true;
  if (event === 'hide' || event === 'detach') info.visible = false;
  record(event, info);
  if (event === 'detach') { restore(info); targets.delete(target); }
}

function navigation(url, event = 'switch-call') {
  // 只记录四个固定 Tab，防止路径参数或记录 ID 混入日志。
  if (!/^\/pages\/(dashboard\/dashboard|items\/items|history\/history|profile\/profile)$/.test(url)) return;
  record(event, null, { destination: url });
}

function read() {
  return JSON.parse(JSON.stringify({ version: 1, enabled, startedAt, dropped, events }));
}

function stop() {
  record('stop');
  enabled = false;
  targets.forEach(restore);
  return read();
}

function start(resolveDark) {
  stop();
  session++;
  startedAt = Date.now(); sequence = 0; revision = 0; nextRequest = 0; dropped = 0; events = [];
  getDark = resolveDark;
  enabled = true;
  record('start');
  targets.forEach(info => { instrument(info); record('snapshot', info); });
  return { enabled: true, trackedInstances: targets.size };
}

module.exports = { attach, lifecycle, navigation, start, stop, read,
  themeChanged() { if (enabled) { revision++; record('theme-change'); } }
};
