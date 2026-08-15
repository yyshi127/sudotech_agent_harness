/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-15.1'

/** Official platform entry used by the first-use guide. */
export const DEEPSEEK_PLATFORM_URL = 'https://platform.deepseek.com/'

/** The complete editable first-use guide in both supported GUI locales. */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: '初次使用说明',
    body: '1. 获取 API Key：注册或登录 DeepSeek 开放平台，进入“API keys”页面，创建并复制 API Key。\n\n2. 设置 API Key：打开左下角“设置”→“模型”，找到 DeepSeek 并点击“编辑”，将密钥粘贴到“API 密钥”，然后点击“保存”。\n\n3. 更换 API Key：回到同一位置，输入新的 API Key 并保存，原密钥会被替换。\n\n4. 安全提示：API Key 属于敏感信息，请勿通过聊天、截图或文件分享给他人。',
    platformLabel: '打开 DeepSeek 开放平台',
    continueLabel: '开始使用',
  },
  en: {
    title: 'First-time setup',
    body: '1. Get an API key: sign up for or sign in to the DeepSeek Platform, open the “API keys” page, then create and copy an API key.\n\n2. Set the API key: open “Settings” → “Models” in the lower-left corner, find DeepSeek and select “Edit”, paste the key into “API key”, then select “Apply”.\n\n3. Replace the API key: return to the same place, enter a new key, and apply it. The previous key will be replaced.\n\n4. Keep it secure: an API key is sensitive. Do not share it in chats, screenshots, or files.',
    platformLabel: 'Open the DeepSeek Platform',
    continueLabel: 'Get started',
  },
} as const
