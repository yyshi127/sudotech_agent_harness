/** Chinese browser-control settings copy. */
export const zh = {
  nav: '浏览器控制',
  title: '浏览器控制',
  description: '选择小兢会计执行网页任务时使用的浏览器。选择后，后续任务只使用该浏览器。',
  choose: '自动化浏览器',
  edge: 'Microsoft Edge',
  edgeDescription: 'Windows 默认推荐，无需额外安装。',
  chrome: 'Google Chrome',
  chromeDescription: '适合已经使用 Chrome 的用户，需要本机已安装。',
  default: '默认',
  selected: '已选择',
  visibleTitle: '可见启动，最小化后继续工作',
  visibleDescription: '浏览器首次启动时正常显示，登录完成后可以最小化到任务栏。网页操作通过 DOM 协议完成，不移动你的鼠标，也不占用键盘输入。',
  profileTitle: '登录状态分别保存',
  profileDescription: 'Edge 和 Chrome 使用各自独立的小兢会计专用配置。切换浏览器不会清除另一浏览器的登录状态。',
  switchNotice: '切换后会在当前网页操作完成时关闭原自动化窗口；下一项网页任务将启动新选择的浏览器。',
  loading: '正在读取浏览器设置…',
  saving: '正在切换…',
  unavailable: '浏览器设置当前不可用，请在小兢会计桌面应用中打开此页面。',
}

/** English browser-control settings copy. */
export const en: typeof zh = {
  nav: 'Browser Control',
  title: 'Browser Control',
  description: 'Choose the browser Xiaojing Accounting uses for web tasks. Subsequent tasks use only the selected browser.',
  choose: 'Automation browser',
  edge: 'Microsoft Edge',
  edgeDescription: 'Recommended default on Windows with no additional installation.',
  chrome: 'Google Chrome',
  chromeDescription: 'For users who already use Chrome; Chrome must be installed locally.',
  default: 'Default',
  selected: 'Selected',
  visibleTitle: 'Starts visible and keeps working when minimized',
  visibleDescription: 'The browser opens normally for sign-in, then may be minimized to the taskbar. DOM protocol actions do not move your mouse or take keyboard input.',
  profileTitle: 'Separate sign-in state',
  profileDescription: 'Edge and Chrome use separate dedicated Xiaojing profiles. Switching does not clear the other browser\'s sign-in state.',
  switchNotice: 'After the current web action finishes, switching closes the old automation window. The next web task starts the selected browser.',
  loading: 'Loading browser settings…',
  saving: 'Switching…',
  unavailable: 'Browser settings are unavailable. Open this page in the Xiaojing Accounting desktop app.',
}

/** Locale keys used by the browser-control page. */
export type BrowserControlKey = keyof typeof zh
