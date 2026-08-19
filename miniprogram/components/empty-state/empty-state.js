/**
 * 空状态组件：CSS 绘制的占位图形 + 标题与描述。
 * type: 'box'（无记录）| 'search'（无搜索结果）| 'calendar'（无可导入记录）
 */
Component({
  properties: {
    type: { type: String, value: 'box' },
    title: { type: String, value: '' },
    desc: { type: String, value: '' }
  }
});
