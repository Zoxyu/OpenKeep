/**
 * 状态徽章组件：红黄绿语义胶囊，颜色与文案跟随主题变量。
 */
Component({
  properties: {
    // 'expired' | 'warning' | 'safe'
    level: { type: String, value: 'safe' },
    // 展示文字，如「已过期」「临期」「安全」
    text: { type: String, value: '' },
    // 'small' 时更紧凑
    size: { type: String, value: '' }
  }
});
