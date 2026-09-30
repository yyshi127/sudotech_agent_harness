/** Product visualization status dictionaries. */
export const zh = {
  rendering: '可视化 · 渲染中…',
  errorPrefix: '可视化 · ',
  failed: '可视化失败',
  streaming: '可视化 · 实时预览',
  composing: '可视化 · 生成中…',
  streamingTitle: '可视化实时预览',
}

/** English visualization status dictionary. */
export const en: Record<keyof typeof zh, string> = {
  rendering: 'Visualize · rendering…',
  errorPrefix: 'Visualize · ',
  failed: 'visualization failed',
  streaming: 'Visualize · streaming preview',
  composing: 'Visualize · composing…',
  streamingTitle: 'Visualization streaming preview',
}
