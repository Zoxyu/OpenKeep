/**
 * 数据转换脚本：将 PrintNow/TodayInHistory（数据源于维基百科）的全量 JSON
 * 转换为小程序按月数据文件（miniprogram/data/history/0X.json）。
 *
 * 用法：node tools/convert.js
 *
 * 注意：微信小程序基础库的 require() 不支持 .json 文件，
 * 因此数据以 .js 模块形式输出（module.exports = {...}）。
 *
 * 过滤规则：
 *   - 剔除政治、军事、灾难类敏感条目（战争/政变/国王/总统/条约等关键词）；
 *   - 优先保留"大事件"，不足 5 条时补充非政治人物的出生/逝世条目；
 *   - 输出格式 { "日": [[年份, 文本], ...] }，按年份升序。
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'history_in_today.json');
const OUT_DIR = path.join(__dirname, '..', 'miniprogram', 'data', 'history');

// 硬排除：出现即删除（战争、政治暴力、极端意识形态）
const HARD_BAN = [
  '战争', '战役', '政变', '革命', '起义', '入侵', '侵略', '占领', '屠杀', '独裁',
  '纳粹', '法西斯', '殖民', '核弹', '原子弹', '暗杀', '轰炸', '投降', '歼灭',
  '俘虏', '处决', '处死', '死刑', '叛乱', '兵变', '暴动', '东征', '条约',
  '政权', '军阀', '监狱', '武装', '军队', '导弹', '舰队', '元首', '起义军',
  '革命党', '内战', '夺权', '政体', '攻占', '行刺', '共和国', '大战', '被俘',
  '灭亡', '交战', '战于', '共产党', '国会', '游行', '迫害', '摧毁', '被杀',
  '联军', '左翼', '右翼', '示威', '罢工', '弹劾', '和约', '枪杀', '枪击',
  '自杀', '罹难', '坠毁', '遇难', '丧生', '遇害', '苏联解体', '脱离苏联',
  '宣布恢复独立', '宣布独立', '闽狮渔', '台湾', '空难', '死亡', '审查', '解体',
  '争霸', '入主', '宣战', '冷战', '会盟', '君主立宪'
];

// 大事件软排除：政治头衔与政体类
const EVENT_BAN = [
  '国王', '皇帝', '女王', '教皇', '总统', '首相', '总理', '主席', '总书记',
  '元帅', '将军', '王朝', '即位', '加冕', '称帝', '议会', '宪法', '政府',
  '大使', '使馆', '帝', '帝国'
];

// 出生/逝世软排除：政治人物头衔
const PERSON_BAN = [
  '总统', '国王', '皇帝', '女王', '教皇', '首相', '总理', '主席', '总书记',
  '元帅', '将军', '王子', '公主', '公爵', '侯爵', '伯爵', '君主', '领袖',
  '元首', '大公', '主教', '沙皇', '天皇', '帝国'
];

// 每天最多保留的条数（满足“每天 5 条可看”并控制包体积）
const MAX_PER_DAY = 10;

function banned(text, list) {
  for (let i = 0; i < list.length; i++) {
    if (text.indexOf(list[i]) > -1) return true;
  }
  return false;
}

// 去掉引用标记（[3][4]）、来源请求标记、英文注释与多余空白
function cleanText(t) {
  return String(t)
    .replace(/\[\d+\]/g, '')
    .replace(/\[来源请求\]/g, '')
    .replace(/[（(]英语：[^）)]*[）)]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const map = {}; // 月 -> 日 -> { events, births, deaths }

raw.forEach(it => {
  const m = String(it.month);
  const d = String(it.day);
  if (!map[m]) map[m] = {};
  if (!map[m][d]) map[m][d] = { events: [], births: [], deaths: [] };
  const text = cleanText(it.data);
  if (!text) return;
  const year = parseInt(it.year, 10);
  const bucket = it.type === 1 ? 'events' : (it.type === 2 ? 'births' : 'deaths');
  map[m][d][bucket].push({ year: year, text: text });
});

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

for (let m = 1; m <= 12; m++) {
  const days = map[String(m)] || {};
  const out = {};

  for (let d = 1; d <= 31; d++) {
    const day = days[String(d)] || { events: [], births: [], deaths: [] };

    // 1. 大事件过滤（排除政治军事敏感）
    let list = day.events.filter(
      e => !banned(e.text, HARD_BAN) && !banned(e.text, EVENT_BAN)
    );

    // 2. 不足 5 条时，补充非政治人物的出生/逝世
    if (list.length < 5) {
      const people = day.births
        .concat(day.deaths)
        .filter(e => !banned(e.text, HARD_BAN) && !banned(e.text, PERSON_BAN));
      for (let i = 0; i < people.length && list.length < 5; i++) {
        list.push(people[i]);
      }
    }

    // 3. 控制单日条数（取前 MAX_PER_DAY 条，按年份升序展示）
    list.sort((a, b) => a.year - b.year);
    if (list.length > MAX_PER_DAY) list = list.slice(0, MAX_PER_DAY);
    const arr = list.map(e => [e.year < 0 ? '前' + (-e.year) : String(e.year), e.text]);
    if (arr.length) out[String(d)] = arr;
  }

  const file = path.join(OUT_DIR, (m < 10 ? '0' : '') + m + '.js');
  fs.writeFileSync(file, 'module.exports = ' + JSON.stringify(out) + ';', 'utf8');
  const sizes = Object.keys(out).map(k => out[k].length);
  const min = sizes.length ? Math.min.apply(null, sizes) : 0;
  const max = sizes.length ? Math.max.apply(null, sizes) : 0;
  console.log(
    'month ' + m + ': days=' + Object.keys(out).length +
    ' size=' + fs.statSync(file).size +
    ' per-day(min=' + min + ',max=' + max + ')'
  );
}
console.log('done');
