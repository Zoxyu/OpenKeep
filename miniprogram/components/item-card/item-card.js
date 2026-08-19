/**
 * 物品卡片组件：照片 / 分类占位 + 名称信息 + 状态与剩余天数。
 * 点击卡片向页面抛出 tapitem 事件（携带物品 id）。
 */
Component({
  properties: {
    // withStatus 处理后的记录对象（含 status、categoryLabel 等展示字段）
    item: { type: Object, value: null },
    // 深色模式（用于占位图形内联色切换）
    dark: { type: Boolean, value: false }
  },
  methods: {
    onTap() {
      if (this.data.item && this.data.item.id) {
        this.triggerEvent('tapitem', { id: this.data.item.id });
      }
    }
  }
});
