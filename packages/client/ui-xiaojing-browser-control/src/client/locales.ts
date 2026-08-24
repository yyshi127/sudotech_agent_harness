/** Chinese browser-control settings copy. */
export const zh = {
  nav: '浏览器控制',
  title: '浏览器控制',
  description: '小兢会计使用 Microsoft Edge 执行网页任务。',
  choose: '自动化浏览器',
  edge: 'Microsoft Edge',
  edgeDescription: '使用 Windows 自带浏览器，无需安装额外浏览器。',
  enabled: '已启用',
  visibleTitle: '可见启动，最小化后继续工作',
  visibleDescription: '浏览器首次启动时正常显示，登录完成后可以最小化到任务栏。网页操作通过 DOM 协议完成，不移动你的鼠标，也不占用键盘输入。',
  profileTitle: '独立登录状态',
  profileDescription: 'Edge 使用小兢会计专用配置，登录状态会在应用重启和覆盖升级后保留。',
}

/** English browser-control settings copy. */
export const en: typeof zh = {
  nav: 'Browser Control',
  title: 'Browser Control',
  description: 'Xiaojing Accounting uses Microsoft Edge for web tasks.',
  choose: 'Automation browser',
  edge: 'Microsoft Edge',
  edgeDescription: 'Uses the browser included with Windows; no additional browser installation is required.',
  enabled: 'Enabled',
  visibleTitle: 'Starts visible and keeps working when minimized',
  visibleDescription: 'The browser opens normally for sign-in, then may be minimized to the taskbar. DOM protocol actions do not move your mouse or take keyboard input.',
  profileTitle: 'Dedicated sign-in state',
  profileDescription: 'Edge uses a dedicated Xiaojing profile whose sign-in state survives app restarts and in-place upgrades.',
}

/** Locale keys used by the browser-control page. */
export type BrowserControlKey = keyof typeof zh
