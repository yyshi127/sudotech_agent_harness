/** Visible isolated Edge startup for the native DevTools attachment route. @module */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, watch } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { createProcessInspector } from '@deepseek-ai/dsh-subprocess-local'
import type { ProcessIdentity } from '@deepseek-ai/dsh-subprocess-local'

/** Explicit installation and deadline for one owned Edge process. */
export interface ManagedEdgeLaunchOptions {
  /** Absolute trusted Edge executable; never a model-provided command. */
  executablePath: string
  /** Visible product browser or a headless integration fixture. */
  headless: boolean
  /** Positive startup and cleanup deadline in milliseconds. */
  timeoutMs: number
}

/** Browser process owned by one native managed route, independent of the user's browser. */
export interface ManagedEdgeProcess {
  /** Owned temporary profile; never the user's existing profile. */
  readonly profileDir: string
  /** Loopback WebSocket endpoint, settled after startup or awaited cleanup on failure. */
  readonly endpoint: Promise<string>
  /** Terminate only retained process identities and remove the profile after quiescence. */
  close(): Promise<void>
}

/**
 * Start Edge with its sandbox enabled and publish the owner before awaiting CDP readiness.
 * The caller registers close with its scope before awaiting endpoint; cancellation during startup also closes the process.
 * @param options - Trusted executable, display mode, and startup/cleanup deadline.
 * @param signal - Startup cancellation; successful startup transfers lifetime to close.
 * @returns Owned browser handle whose endpoint is ready for the native MCP attach provider.
 */
export async function launchManagedEdge(options: ManagedEdgeLaunchOptions, signal: AbortSignal): Promise<ManagedEdgeProcess> {
  signal.throwIfAborted()
  if (!isAbsolute(options.executablePath)) throw new Error('Managed Edge requires an absolute executable path')
  const inspector = createProcessInspector()
  const profileParent = resolve(tmpdir())
  const profileDir = resolve(await mkdtemp(join(profileParent, 'xiaojing-native-edge-')))
  if (dirname(profileDir) !== profileParent || !basename(profileDir).startsWith('xiaojing-native-edge-')) {
    throw new Error('Managed Edge profile must remain in its owned temporary directory')
  }
  if (signal.aborted) {
    await rm(profileDir, { recursive: true, force: true })
    signal.throwIfAborted()
  }
  const identities = new Map<string, ProcessIdentity>()
  const child = spawn(options.executablePath, [
    `--user-data-dir=${profileDir}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--disable-component-update',
    ...options.headless ? ['--headless=new'] : [], 'about:blank',
  ], { stdio: 'ignore', windowsHide: false, detached: process.platform !== 'win32', env: scrubbedParentEnv() })
  const exited = new Promise<Error | undefined>((resolveExit) => {
    child.once('error', resolveExit)
    child.once('close', () => { resolveExit(undefined) })
  })
  let root: ProcessIdentity | undefined
  const observe = (): void => {
    if (child.pid === undefined || root !== undefined && !inspector.isAlive(root)) return
    for (const identity of inspector.snapshot().tree(child.pid)) {
      identities.set(`${identity.pid}:${identity.started}`, identity)
      if (identity.pid === child.pid) root = identity
    }
  }
  let closing: Promise<void> | undefined
  const close = (): Promise<void> => (closing ??= (async () => {
    const deadline = Date.now() + options.timeoutMs
    observe()
    const members = [...identities.values()].filter(identity => identity.pid !== root?.pid)
    if (root !== undefined) members.push(root)
    for (const identity of members) inspector.signalProcess(identity, 'SIGKILL')
    const unknownOwnership = child.pid !== undefined && root === undefined
    if (unknownOwnership) child.kill('SIGKILL')
    while ([...identities.values()].some(identity => inspector.isAlive(identity))) {
      if (Date.now() >= deadline) throw new Error(`Managed Edge did not stop; retained profile ${profileDir}`)
      await sleep(15)
    }
    const waitAbort = new AbortController()
    try {
      const expired = sleep(Math.max(1, deadline - Date.now()), undefined, { signal: waitAbort.signal }).then(() => {
        throw new Error(`Managed Edge exit was not observed; retained profile ${profileDir}`)
      })
      await Promise.race([exited, expired])
    } finally { waitAbort.abort() }
    if (unknownOwnership) throw new Error(`Managed Edge process ownership could not be verified; retained profile ${profileDir}`)
    while (true) {
      try {
        await rm(profileDir, { recursive: true, force: true })
        break
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY' || Date.now() >= deadline) throw error
        await sleep(15)
      }
    }
  })())
  const endpoint = (async () => {
    const watchAbort = new AbortController()
    const startupSignal = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs), watchAbort.signal])
    const changes = watch(profileDir, { signal: startupSignal })
    let changed = changes.next()
    // Startup may finish on the initial read; cancellation then settles the unused watch promise.
    void changed.catch((_watchFailureReportedByStartup: unknown) => {})
    const ended = exited.then((error) => { throw error ?? new Error('Managed Edge exited before remote debugging became ready') })
    // A ready browser's later exit is joined by close rather than the startup race.
    void ended.catch((_exitReportedByStartupOrClose: unknown) => {})
    try {
      while (true) {
        startupSignal.throwIfAborted()
        observe()
        let content: string | undefined
        try { content = await readFile(join(profileDir, 'DevToolsActivePort'), 'utf8') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        if (content !== undefined) {
          const [rawPort, rawPath] = content.trim().split(/\r?\n/u)
          const port = Number(rawPort)
          if (Number.isInteger(port) && port > 0 && port <= 65535 && /^\/devtools\/browser\/[\w-]+$/u.test(rawPath ?? '')) {
            observe()
            if (root === undefined) throw new Error('Managed Edge process ownership could not be verified')
            return `ws://127.0.0.1:${port}${rawPath}`
          }
        }
        await Promise.race([changed, ended])
        changed = changes.next()
        void changed.catch((_watchFailureReportedByStartup: unknown) => {})
      }
    } finally {
      watchAbort.abort()
      await changes.return?.()
    }
  })().catch(async (error: unknown) => {
    await close()
    throw error
  })
  return { profileDir, endpoint, close }
}
