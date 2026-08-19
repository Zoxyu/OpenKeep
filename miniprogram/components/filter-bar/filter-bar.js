/**
 * 快捷筛选条组件：横向胶囊选项，选中后抛出 change 事件（携带 key）。
 */
Component({
  properties: {
    // [{ key, label, count? }]
    options: { type: Array, value: [] },
    // 当前选中的 key
    active: { type: String, value: 'all' }
  },
  methods: {
    onTap(e) {
      const key = e.currentTarget.dataset.key;
      if (key !== this.data.active) {
        this.triggerEvent('change', { key: key });
      }
    }
  }
});
