import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('desktop companion renderer isolation', () => {
  it('limits pointer interception to the character and visible status bubble', () => {
    const html = readFileSync(new URL('../companion.html', import.meta.url), 'utf8')
    const css = readFileSync(new URL('../companion.css', import.meta.url), 'utf8')
    const preload = readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8')
    expect(html).toContain('<main id="companion" class="companion state-idle">')
    expect(html).toContain('class="bubble" aria-live="polite" data-companion-interactive data-companion-drag')
    expect(html).toContain('class="stage" data-companion-interactive data-companion-drag')
    expect(preload).toContain('event.target.setPointerCapture(event.pointerId)')
    expect(preload).toContain('setCompanionScale: scale => ipcRenderer.invoke(channels.scale, scale)')
    expect(preload).toContain('getApplicationInfo: () => ipcRenderer.invoke(channels.applicationInfo)')
    expect(preload.indexOf('if (dragging) {')).toBeLessThan(preload.indexOf('const next = isInteractive(event)'))
    expect(css).toContain('--companion-size: 140px')
    expect(css).toContain('bottom: calc(var(--companion-bubble-bottom) + 4px)')
    expect(css).not.toContain('top: 10px')
  })

  it('shows the startup introduction only for the startup-created companion window', () => {
    const main = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8')
    const renderer = readFileSync(new URL('../companion.js', import.meta.url), 'utf8')
    expect(main).toContain('wakeCompanion({ startupGreeting: true })')
    expect(main).toContain("startupGreeting ? { query: { startupGreeting: '1' } } : undefined")
    expect(renderer).toContain("const STARTUP_GREETING = '你好，我是小兢会计，\\n您的AI办公搭子！'")
    expect(readFileSync(new URL('../companion.css', import.meta.url), 'utf8')).toContain('#bubbleText { white-space: pre-line; }')
    expect(renderer).toContain('const STARTUP_GREETING_DELAY_MS = 3_000')
    expect(renderer).toContain('const STARTUP_GREETING_MS = 5_000')
    expect(main).toContain('applicationReady = true')
    expect(main).toContain('broadcastDesktopState()')
    expect(renderer).toContain('!applicationReady || state !==')
    expect(renderer).toContain('}, STARTUP_GREETING_DELAY_MS)')
    expect(renderer).toContain("startupGreetingActive && state === 'idle'")
    expect(renderer).toContain('startupGreetingPending = false')
  })

  it('rotates idle-only poses without changing the task state', () => {
    const renderer = readFileSync(new URL('../companion.js', import.meta.url), 'utf8')
    expect(renderer).toContain('const IDLE_POSE_INTERVAL_MS = 3 * 60_000')
    expect(renderer).toContain('const IDLE_POSE_ROUNDS = 2')
    expect(renderer).toContain('const IDLE_POSE_ROUND_MS = 3_000')
    expect(renderer).toContain("const IDLE_POSES = ['thinking', 'approval', 'executing']")
    expect(renderer).toContain('if (idlePoseRound >= IDLE_POSE_ROUNDS)')
    expect(renderer).toContain("if (state !== 'idle') cancelIdlePose()")
    expect(renderer).toContain('reducedMotion.matches')
    expect(renderer).toContain('scheduleIdlePose()')
  })
})
