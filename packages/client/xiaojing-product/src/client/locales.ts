/** Xiaojing product copy. */

export const zh = {
  heroTitle: '小兢会计，您的AI办公搭子',
  beta: '内测版',
  brandAlt: '数豆科技',
  assistantAlt: '小兢会计',
  tagline: '用AI重新定义财务',
  financePresetName: 'Finance模式',
  financePresetDescription: '继承标准模式的全部能力，提供面向财税工作的专业身份、审慎核验与官方来源优先规则。',
  onboardingTitle: '初次使用说明',
  onboardingBody: '1. 获取 API Key：注册或登录 DeepSeek 开放平台，进入“API keys”页面，创建并复制 API Key。\n\n2. 设置 API Key：打开左下角“设置”→“模型”，找到 DeepSeek 并点击“编辑”，将密钥粘贴到“API 密钥”，然后点击“保存”。\n\n3. 更换 API Key：回到同一位置，输入新的 API Key 并保存，原密钥会被替换。\n\n4. 安全提示：API Key 属于敏感信息，请勿通过聊天、截图或文件分享给他人。',
  platform: '打开 DeepSeek 开放平台',
  start: '开始使用',
  saveError: '暂时无法保存确认状态，请重试。',
  aboutNav: '关于小兢',
  aboutTitle: '小兢会计',
  version: '当前版本',
  releaseEyebrow: 'CURRENT RELEASE',
  releaseTitle: '版本新特性',
  features: '项功能亮点',
  featureVision: '原生视觉模型与统一上传入口，图片和文档自动选择正确处理方式。',
  featureWeixin: '微信频道支持远程任务、进度反馈、文件收发与高风险操作确认。',
  featureEdge: 'Edge 浏览器控制支持专用浏览器和可选的个人网页接管。',
  featureUsage: '本机用量按日统计 Token 与费用，并按官方峰谷价格计算。',
  featureVisualize: 'Visualize 将适合的结果呈现为独立配色的精美交互卡片。',
  featureCompanion: '桌面小兢通过动作和表情显示任务状态，并支持系统托盘常驻。',
}

/** English Xiaojing product dictionary. */
export const en: { [Key in keyof typeof zh]: string } = {
  heroTitle: 'Xiaojing Accounting, Your AI Workmate',
  beta: 'Internal Beta',
  brandAlt: 'SUDO Tech',
  assistantAlt: 'Xiaojing Accounting',
  tagline: 'Redefining finance with AI',
  financePresetName: 'Finance模式',
  financePresetDescription: 'All Standard mode capabilities, with a professional finance and tax identity, verification discipline, and official-source-first guidance.',
  onboardingTitle: 'First-time setup',
  onboardingBody: '1. Get an API key: sign up for or sign in to the DeepSeek Platform, open the “API keys” page, then create and copy an API key.\n\n2. Set the API key: open “Settings” → “Models” in the lower-left corner, find DeepSeek and select “Edit”, paste the key into “API key”, then select “Apply”.\n\n3. Replace the API key: return to the same place, enter a new key, and apply it. The previous key will be replaced.\n\n4. Keep it secure: an API key is sensitive. Do not share it in chats, screenshots, or files.',
  platform: 'Open the DeepSeek Platform',
  start: 'Get started',
  saveError: 'The acknowledgement could not be saved. Please try again.',
  aboutNav: 'About Xiaojing',
  aboutTitle: 'Xiaojing Accounting',
  version: 'Current version',
  releaseEyebrow: 'CURRENT RELEASE',
  releaseTitle: 'release highlights',
  features: 'highlights',
  featureVision: 'Native vision and one upload entry route images and documents to the correct workflow.',
  featureWeixin: 'The Weixin channel supports remote tasks, progress updates, file exchange, and risk confirmation.',
  featureEdge: 'Edge control supports a managed browser and optional attachment to personal Web pages.',
  featureUsage: 'Local usage tracks daily tokens and cost with the published peak and off-peak prices.',
  featureVisualize: 'Visualize presents suitable results as polished interactive cards with its own palette.',
  featureCompanion: 'Desktop Xiaojing reflects task state through motion and expressions and remains available in the tray.',
}

/** Keys accepted by the Xiaojing product locale namespace. */
export type XiaojingProductKey = keyof typeof zh
