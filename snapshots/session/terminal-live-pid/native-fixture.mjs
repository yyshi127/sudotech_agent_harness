/** Controlled Windows native PID publication through real terminal services and a logged headless turn. */
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

/** Cordis plugin name. */
export const name = 'terminal-live-pid-native'
/** Production services used by the controlled allocation. */
export const inject = ['subprocess', 'tools', 'systemPrompt']

/** Register one controlled PTY, a fixed prompt, and agent-owned terminal tool visibility.
 * @param ctx - owning plugin context; disposal restores allocation and closes its handle.
 * @returns after the fixture's registrations are installed.
 */
export async function apply(ctx) {
  const toolTerminal = await import(new URL(process.env.DSH_EXAMPLE_MODE === 'lib'
    ? '../../../packages/terminal/tool-terminal/lib/index.js'
    : '../../../packages/terminal/tool-terminal/src/index.ts', import.meta.url).href)
  ctx.plugin(toolTerminal, { enableRunInBackground: false })
  const LocalTerminalHandle = process.env.DSH_SNAPSHOT_PID_HANDLE === undefined ? undefined
    : (await import(pathToFileURL(process.env.DSH_SNAPSHOT_PID_HANDLE).href)).LocalTerminalHandle
  const facts = { platform: process.platform, allocation: null, calls: [], nativePid: 0,
    handlePids: [], nativeKills: [], identitySignals: [], toolResults: [], closed: false,
    publicProviderAllocation: LocalTerminalHandle === undefined, nativeAllocations: [], restored: null }
  const save = () => {
    if (process.env.DSH_SNAPSHOT_PID_FACTS !== undefined) {
      writeFileSync(process.env.DSH_SNAPSHOT_PID_FACTS, JSON.stringify(facts, null, 2) + '\n')
    }
  }
  const dataListeners = new Set()
  const exitListeners = new Set()
  let alive = false
  let handle
  const identity = { pid: 4242, started: 'qa-owned-pty-root' }
  const terminal = {
    pid: 0,
    onData(listener) { dataListeners.add(listener); return { dispose() { dataListeners.delete(listener) } } },
    onExit(listener) { exitListeners.add(listener); return { dispose() { exitListeners.delete(listener) } } },
    write(data) { if (data.length > 0) throw new Error('unexpected fixture terminal write') },
    resize() {}, pause() {}, resume() {},
    kill(signal) { facts.nativeKills.push(signal); finish() },
  }
  function finish() {
    if (facts.closed) return
    alive = false
    facts.closed = true
    for (const listener of exitListeners) listener({ exitCode: 0 })
    save()
  }
  const inspector = {
    snapshot() {
      return { complete: true, tree: pid => alive && pid === identity.pid ? [identity] : [],
        session: () => [], alive: member => alive && member.pid === identity.pid && member.started === identity.started }
    },
    foregroundPgid: pid => alive && pid === identity.pid ? identity.pid : undefined,
    isStdinWaiting: () => true,
    isAlive: member => alive && member.pid === identity.pid && member.started === identity.started,
    signalGroup() { throw new Error('unexpected fixture group signal') },
    signalProcess(member, signal) {
      if (!this.isAlive(member)) throw new Error('fixture attempted foreign identity signal')
      facts.identitySignals.push({ member, signal })
      finish()
    },
  }
  ctx.systemPrompt.section({
    name: 'snapshot:terminal-live-pid', order: 0, complete: true, interpolate: false,
    text: 'Use the terminal tools to observe native PID publication. Report the tool results faithfully.',
  })
  ctx.systemPrompt.suppressRuntimeContext()
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.tools.restrict({ allow: ['terminal_open', 'terminal_list', 'terminal_close'] })
  })
  const provider = ctx.subprocess
  const original = provider.spawnTerminal
  const originalSpawnDescriptor = Object.getOwnPropertyDescriptor(provider, 'spawnTerminal')
  const originalInternals = provider.internals
  const originalInspector = provider.terminalInspector
  const native = createRequire(new URL('../../../packages/subprocess/subprocess-local/package.json', import.meta.url))('node-pty')
  const originalNativeSpawn = native.spawn
  ctx.effect(() => {
    provider.internals = { ...originalInternals, platform: 'win32' }
    provider.terminalInspector = inspector
    native.spawn = (file, args, options) => {
      if (facts.nativeAllocations.length !== 0) throw new Error('fixture permits exactly one native allocation')
      facts.nativeAllocations.push({ file, args, cwd: options.cwd, rows: options.rows, cols: options.cols })
      return terminal
    }
    provider.spawnTerminal = async spec => {
      spec.signal?.throwIfAborted()
      if (handle !== undefined) throw new Error('fixture permits exactly one terminal allocation')
      facts.allocation = { argv: spec.argv, cwd: spec.cwd, rows: spec.rows, cols: spec.cols,
        terminalType: spec.terminalType, nativePidAtAllocation: terminal.pid }
      handle = LocalTerminalHandle === undefined ? await original.call(provider, spec)
        : new LocalTerminalHandle(terminal, inspector, spec.graceMs, 'win32')
      facts.handlePids.push({ phase: 'allocated', value: handle.pid })
      save()
      // Allocation completes before the shell prompt arrives; its native PID is still unpublished.
      setTimeout(() => {
        for (const listener of dataListeners) listener('\x1b]133;D;0\x07dsh> ')
      }, 0)
      return handle
    }
    return async () => {
      if (originalSpawnDescriptor === undefined) delete provider.spawnTerminal
      else Object.defineProperty(provider, 'spawnTerminal', originalSpawnDescriptor)
      provider.internals = originalInternals
      provider.terminalInspector = originalInspector
      native.spawn = originalNativeSpawn
      if (handle !== undefined) await handle.terminate()
      const restoredDescriptor = Object.getOwnPropertyDescriptor(provider, 'spawnTerminal')
      facts.restored = { spawnTerminalDescriptor: originalSpawnDescriptor === undefined ? restoredDescriptor === undefined
        : restoredDescriptor?.value === originalSpawnDescriptor.value,
        internals: provider.internals === originalInternals, inspector: provider.terminalInspector === originalInspector,
        nativeSpawn: native.spawn === originalNativeSpawn }
      save()
    }
  })
  ctx.on('tools/execute', (exec, next) => {
    facts.calls.push(exec.name)
    if (exec.name === 'terminal_list') {
      if (handle === undefined || terminal.pid !== 0) throw new Error('fixture PID publication sequence changed')
      terminal.pid = identity.pid
      alive = true
      facts.nativePid = terminal.pid
      facts.handlePids.push({ phase: 'native-published', value: handle.pid })
      save()
    }
    return next()
  })
  ctx.on('tools/post-execute', (exec, result, next) => {
    if (exec.name.startsWith('terminal_')) {
      facts.toolResults.push(JSON.parse(JSON.stringify({ callId: exec.callId, name: exec.name, result })))
      save()
    }
    return next()
  })
}
