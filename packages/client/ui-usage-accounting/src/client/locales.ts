/** Usage-accounting browser copy. */

export const zh = {
  nav: '用量',
  today: '今日已使用',
  token: 'token',
  loading: '正在读取用量…',
  unavailable: '用量暂不可用',
  title: '本机用量',
  description: '依据当前 API Key 在本机收到的 DeepSeek usage 统计；费用不是开放平台正式账单。',
  monthTotal: '本月合计',
  detailTitle: '今日计费明细',
  category: '项目',
  tokenColumn: 'Token',
  costColumn: '费用',
  cacheHitInput: '缓存命中输入',
  cacheMissInput: '缓存未命中输入',
  output: '模型输出',
  todayTotal: '今日合计',
  detailUnavailable: '明细未统计',
  unpricedTokens: '未计价 token',
  detailNote: '按每次请求发生时的北京时间高峰或空闲价格结算。',
  noKey: '请先在“模型”中设置 API Key。',
  untracked: '未统计',
  unpriced: '未计价',
  weekdays: '一,二,三,四,五,六,日',
}

/** English usage-accounting dictionary. */
export const en: { [Key in keyof typeof zh]: string } = {
  nav: 'Usage',
  today: 'Today',
  token: 'token',
  loading: 'Loading usage…',
  unavailable: 'Usage unavailable',
  title: 'Local usage',
  description: 'Based on DeepSeek usage returned locally for the current API key; this is not the platform bill.',
  monthTotal: 'Month total',
  detailTitle: 'Today billing details',
  category: 'Category',
  tokenColumn: 'Token',
  costColumn: 'Cost',
  cacheHitInput: 'Cache-hit input',
  cacheMissInput: 'Uncached input',
  output: 'Model output',
  todayTotal: 'Today total',
  detailUnavailable: 'Not recorded',
  unpricedTokens: 'Unpriced tokens',
  detailNote: 'Settled at the Beijing peak or off-peak price active when each request started.',
  noKey: 'Set an API key under Models first.',
  untracked: 'Not tracked',
  unpriced: 'unpriced',
  weekdays: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
}

/** Keys accepted by the usage-accounting locale namespace. */
export type UsageAccountingKey = keyof typeof zh
