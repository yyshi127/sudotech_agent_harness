/** Desktop-companion settings copy. */

export const zh = {
  nav: '桌面小兢',
  title: '桌面小兢',
  description: '让小兢会计常驻桌面，通过动作和表情提示任务执行状态。',
  awake: '已唤醒',
  tucked: '已收起',
  idle: '待机中',
  thinking: '正在思考',
  executing: '正在执行',
  approval: '等待确认',
  success: '任务完成',
  failure: '任务未完成',
  taskCount: '项任务',
  wake: '唤醒桌面小兢',
  tuck: '收起桌面小兢',
  reset: '重置桌面位置',
  size: '桌面小兢大小',
  smaller: '较小',
  larger: '较大',
  unavailable: '桌面小兢仅在 Windows 桌面版中可用。',
  activityHint: '桌面小兢会通过动作和表情提示任务执行状态。',
  backgroundHint: '收起桌面小兢不会退出应用或中断任务。',
}

/** English desktop-companion settings copy. */
export const en: typeof zh = {
  nav: 'Desktop Xiaojing',
  title: 'Desktop Xiaojing',
  description: 'Keep Xiaojing on your desktop and see task progress through motion and expression.',
  awake: 'Awake',
  tucked: 'Tucked away',
  idle: 'Idle',
  thinking: 'Thinking',
  executing: 'Working',
  approval: 'Waiting for approval',
  success: 'Task completed',
  failure: 'Task not completed',
  taskCount: 'active tasks',
  wake: 'Wake Desktop Xiaojing',
  tuck: 'Tuck away Desktop Xiaojing',
  reset: 'Reset desktop position',
  size: 'Desktop Xiaojing size',
  smaller: 'Smaller',
  larger: 'Larger',
  unavailable: 'Desktop Xiaojing is available only in the Windows desktop application.',
  activityHint: 'Desktop Xiaojing uses motion and expressions to show task progress.',
  backgroundHint: 'Tucking away Desktop Xiaojing does not exit the application or interrupt tasks.',
}

/** Locale keys used by the desktop-companion page. */
export type DesktopCompanionKey = keyof typeof zh
