/** Xiaojing product copy. */

export const zh = {
  heroTitle: '小兢会计，您的AI办公搭子',
  beta: '内测版',
  brandAlt: '数豆科技',
  assistantAlt: '小兢会计',
  tagline: '用AI重新定义财务',
  onboardingTitle: '初次使用说明',
  onboardingBody: '1. 获取 API Key：注册或登录 DeepSeek 开放平台，进入“API keys”页面，创建并复制 API Key。\n\n2. 设置 API Key：打开左下角“设置”→“模型”，找到 DeepSeek 并点击“编辑”，将密钥粘贴到“API 密钥”，然后点击“保存”。\n\n3. 更换 API Key：回到同一位置，输入新的 API Key 并保存，原密钥会被替换。\n\n4. 安全提示：API Key 属于敏感信息，请勿通过聊天、截图或文件分享给他人。',
  platform: '打开 DeepSeek 开放平台',
  start: '开始使用',
  saveError: '暂时无法保存确认状态，请重试。',
}

/** English Xiaojing product dictionary. */
export const en: { [Key in keyof typeof zh]: string } = {
  heroTitle: 'Xiaojing Accounting, Your AI Workmate',
  beta: 'Internal Beta',
  brandAlt: 'SUDO Tech',
  assistantAlt: 'Xiaojing Accounting',
  tagline: 'Redefining finance with AI',
  onboardingTitle: 'First-time setup',
  onboardingBody: '1. Get an API key: sign up for or sign in to the DeepSeek Platform, open the “API keys” page, then create and copy an API key.\n\n2. Set the API key: open “Settings” → “Models” in the lower-left corner, find DeepSeek and select “Edit”, paste the key into “API key”, then select “Apply”.\n\n3. Replace the API key: return to the same place, enter a new key, and apply it. The previous key will be replaced.\n\n4. Keep it secure: an API key is sensitive. Do not share it in chats, screenshots, or files.',
  platform: 'Open the DeepSeek Platform',
  start: 'Get started',
  saveError: 'The acknowledgement could not be saved. Please try again.',
}

/** Keys accepted by the Xiaojing product locale namespace. */
export type XiaojingProductKey = keyof typeof zh
