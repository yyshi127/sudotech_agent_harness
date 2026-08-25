const companion = document.querySelector('#companion')
const character = document.querySelector('#character')
const bubble = document.querySelector('#bubble')
const bubbleText = document.querySelector('#bubbleText')
const STARTUP_GREETING = '你好，我是小兢会计，\n您的AI办公搭子！'
const STARTUP_GREETING_DELAY_MS = 3_000
const STARTUP_GREETING_MS = 5_000
const IDLE_POSE_INTERVAL_MS = 3 * 60_000
const IDLE_POSE_ROUNDS = 2
const IDLE_POSE_ROUND_MS = 3_000
const IDLE_POSES = ['thinking', 'approval', 'executing']
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

const copy = {
  thinking: '正在思考',
  executing: '正在执行',
  approval: '等待确认',
  success: '任务完成',
  failure: '任务未完成',
}

let state = 'idle'
let blinkTimer
let transientTimer
let startupGreetingDelayTimer
let idlePoseTimer
let idlePoseResetTimer
let startupGreetingPending = new URLSearchParams(window.location.search).get('startupGreeting') === '1'
let startupGreetingActive = false
let idlePoseActive = false
let idlePoseRound = 0
let lastIdlePose
let applicationReady = false

function scheduleStartupGreeting() {
  if (!startupGreetingPending || startupGreetingDelayTimer || !applicationReady || state !== 'idle') return
  startupGreetingDelayTimer = setTimeout(() => {
    startupGreetingDelayTimer = undefined
    if (!startupGreetingPending || state !== 'idle') return
    startupGreetingPending = false
    startupGreetingActive = true
    bubbleText.textContent = STARTUP_GREETING
    bubble.classList.add('transient')
    transientTimer = setTimeout(() => {
      startupGreetingActive = false
      bubble.classList.remove('transient')
      scheduleIdlePose()
    }, STARTUP_GREETING_MS)
  }, STARTUP_GREETING_DELAY_MS)
}

function applyScale(scale) {
  const pixels = (base, minimum = 0) => `${Math.max(minimum, base * scale)}px`
  const root = document.documentElement.style
  root.setProperty('--companion-size', pixels(280))
  root.setProperty('--companion-stage-height', pixels(320))
  root.setProperty('--companion-bubble-bottom', pixels(280, 1))
  root.setProperty('--companion-ring-size', pixels(230))
  root.setProperty('--companion-ring-right', pixels(25))
  root.setProperty('--companion-ring-bottom', pixels(12))
  root.setProperty('--companion-ring-border', pixels(5, 2))
  root.setProperty('--companion-stars-top', pixels(45))
  root.setProperty('--companion-stars-side', pixels(15))
  root.setProperty('--companion-stars-size', pixels(28, 16))
  root.setProperty('--companion-motion-breathe', `${-3 * scale}px`)
  root.setProperty('--companion-motion-think', `${-2 * scale}px`)
  root.setProperty('--companion-motion-execute', `${-5 * scale}px`)
  root.setProperty('--companion-motion-alert', `${-7 * scale}px`)
  root.setProperty('--companion-motion-celebrate', `${-16 * scale}px`)
}

function imageFor(next) {
  return `assets/desktop-companion/runtime/${next}.webp`
}

function cancelIdlePose({ restore = false } = {}) {
  clearTimeout(idlePoseTimer)
  clearTimeout(idlePoseResetTimer)
  idlePoseTimer = undefined
  idlePoseResetTimer = undefined
  idlePoseActive = false
  idlePoseRound = 0
  if (restore && state === 'idle') character.src = imageFor('idle')
}

function advanceIdlePose() {
  if (state !== 'idle' || reducedMotion.matches) {
    cancelIdlePose()
    return
  }
  if (idlePoseRound >= IDLE_POSE_ROUNDS) {
    idlePoseActive = false
    idlePoseRound = 0
    character.src = imageFor('idle')
    scheduleBlink()
    scheduleIdlePose()
    return
  }
  const choices = IDLE_POSES.filter(pose => pose !== lastIdlePose)
  const pose = choices[Math.floor(Math.random() * choices.length)]
  lastIdlePose = pose
  idlePoseRound += 1
  character.src = imageFor(pose)
  idlePoseResetTimer = setTimeout(advanceIdlePose, IDLE_POSE_ROUND_MS)
}

function scheduleIdlePose() {
  if (
    idlePoseTimer
    || idlePoseActive
    || reducedMotion.matches
    || state !== 'idle'
    || startupGreetingPending
    || startupGreetingActive
  ) return
  idlePoseTimer = setTimeout(() => {
    idlePoseTimer = undefined
    if (reducedMotion.matches || state !== 'idle' || startupGreetingPending || startupGreetingActive) return
    idlePoseActive = true
    idlePoseRound = 0
    clearTimeout(blinkTimer)
    advanceIdlePose()
  }, IDLE_POSE_INTERVAL_MS)
}

function scheduleBlink() {
  clearTimeout(blinkTimer)
  if (state !== 'idle' || idlePoseActive) return
  blinkTimer = setTimeout(() => {
    if (state !== 'idle' || idlePoseActive) return
    character.src = imageFor('blink')
    setTimeout(() => {
      if (state === 'idle' && !idlePoseActive) character.src = imageFor('idle')
      scheduleBlink()
    }, 145)
  }, 2_600 + Math.floor(Math.random() * 3_200))
}

function render(view) {
  applyScale(view.scale)
  const previous = state
  applicationReady = view.applicationReady === true
  state = view.snapshot.state
  if (state !== 'idle') cancelIdlePose()
  companion.className = `companion state-${state}`
  if (!idlePoseActive || state !== 'idle') character.src = imageFor(state)
  if (startupGreetingActive && state === 'idle') {
    scheduleBlink()
    return
  }
  if (startupGreetingPending && state === 'idle') {
    scheduleStartupGreeting()
    scheduleBlink()
    return
  }
  if (idlePoseActive && state === 'idle') return
  clearTimeout(startupGreetingDelayTimer)
  startupGreetingDelayTimer = undefined
  startupGreetingPending = false
  clearTimeout(transientTimer)
  startupGreetingActive = false
  bubble.classList.remove('transient')
  if (state === 'idle') {
    bubbleText.textContent = ''
    if (previous === 'thinking' || previous === 'executing' || previous === 'approval') {
      bubbleText.textContent = '任务已停止'
      bubble.classList.add('transient')
      transientTimer = setTimeout(() => { bubble.classList.remove('transient') }, 1_800)
    }
  } else if (state === 'executing' && view.snapshot.activeTaskCount > 1) {
    bubbleText.textContent = `${copy.executing} · ${view.snapshot.activeTaskCount} 项`
  } else if (state === 'approval' && view.snapshot.approvalCount > 1) {
    bubbleText.textContent = `${copy.approval} · ${view.snapshot.approvalCount} 项`
  } else {
    bubbleText.textContent = copy[state] ?? ''
  }
  scheduleBlink()
  scheduleIdlePose()
}

reducedMotion.addEventListener('change', () => {
  cancelIdlePose({ restore: true })
  scheduleIdlePose()
})

companion.addEventListener('dblclick', () => { void window.xiaojingDesktop.showMainWindow() })
const unsubscribe = window.xiaojingDesktop.subscribeCompanionState(render)
window.addEventListener('beforeunload', unsubscribe, { once: true })
void window.xiaojingDesktop.getCompanionState().then(render)
