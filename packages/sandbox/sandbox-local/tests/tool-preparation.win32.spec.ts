/** Windows ACL preparation through dispatched tools and the real filesystem version guard. */
import { mkdtemp, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicyService, { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'

describe.skipIf(process.platform !== 'win32')('Windows tool ACL preparation and guarded edits', () => {
  let ctx: Context
  let cwd: string
  let path: string
  let session: Session
  let agent: NonNullable<ToolExecutionInput['agent']>
  let observed: Awaited<ReturnType<Context['fs']['stat']>>
  let counter = 0

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'dsh-tool-acl-ws-')))
    path = join(cwd, 'intro.md')
    await writeFile(path, 'hello original\n')
    ctx = new Context()
    await ctx.plugin(LocalSandboxProvider)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: cwd })
    await ctx.plugin(LocalFileSystem, { cwd })
    const id = SessionId('owned-windows-acl')
    session = Session.create(id, undefined, { version: 4, id, createdAt: 0, isSeeded: false, cwd })
    // These tools use only context and Session policy from the live agent.
    agent = { id, ctx, session } as NonNullable<ToolExecutionInput['agent']>
    observed = undefined
    counter = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'read-owned', description: 'Read an owned file version', parameters: {},
      async execute(_args, exec) {
        const target = await ctx.fs.resolve(path)
        observed = await ctx.fs.stat(target, exec.signal)
        return [{ type: 'text', text: await ctx.fs.readText(target, exec.signal) }]
      },
    }))
    ctx.tools.register(defineContentToolFixture({
      name: 'prepare-command', description: 'Prepare a confined command without starting a child', parameters: {},
      async execute(_args, exec) {
        const policy = ctx.sandboxPolicy.resolve({ session })
        if (policy.mode === 'danger-full-access') return []
        await ctx.sandbox.confine(['pwsh', '-NoProfile', '-Command', 'Get-Content intro.md'],
          { ...policy, mode: policy.mode }, exec.signal)
        return []
      },
    }))
    ctx.tools.register(defineContentToolFixture({
      name: 'edit-owned', description: 'Edit an owned file with the observed version', parameters: {},
      async execute(_args, exec) {
        if (observed === undefined) throw new Error('owned file has not been read')
        const target = await ctx.fs.resolve(path)
        await ctx.fs.editText(target, { oldString: 'original', newString: 'updated', replaceAll: false },
          { version: observed.version }, exec.signal, ctx.sandboxPolicy.resolve({ session }))
        return []
      },
    }))
  })

  afterEach(async () => {
    await ctx?.fiber.dispose()
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true })
  })

  const call = (name: string) => ctx.tools.execute({
    name, arguments: {}, agent, callId: ToolCallId(`owned-${++counter}`), signal: new AbortController().signal,
  })

  async function awaitMetadataTick(previous: bigint) {
    // NTFS may stamp two immediate changes with the same clock tick.
    const clockProbe = join(cwd, 'clock-probe.txt')
    await vi.waitFor(async () => {
      await writeFile(clockProbe, 'clock probe')
      expect((await stat(clockProbe, { bigint: true })).ctimeNs).toBeGreaterThan(previous)
    }, { timeout: 1_000, interval: 10 })
  }

  it('keeps the first read version valid when later command confinement creates its private temp grant', async () => {
    const before = await stat(path, { bigint: true })
    await awaitMetadataTick(before.ctimeNs)
    expect((await call('read-owned')).isError).toBe(false)
    const read = await stat(path, { bigint: true })
    expect(read.ctimeNs).not.toBe(before.ctimeNs)
    expect(read.mtimeNs).toBe(before.mtimeNs)
    expect((await call('prepare-command')).isError).toBe(false)
    const after = await stat(path, { bigint: true })
    expect(after.ctimeNs).toBe(read.ctimeNs)
    expect(after.mtimeNs).toBe(read.mtimeNs)
    expect((await call('edit-owned')).isError).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('hello updated\n')
  })

  it.each(['read-only', 'danger-full-access'] as const)('rejects the old version after switching from %s and succeeds after a fresh read', async (mode) => {
    setSandboxMode(session, mode)
    expect((await call('read-owned')).isError).toBe(false)
    const before = await stat(path, { bigint: true })
    await awaitMetadataTick(before.ctimeNs)
    setSandboxMode(session, 'workspace-write')
    expect(await call('edit-owned')).toMatchObject({ isError: true, error: { info: { code: 'FS_STALE_VERSION' } } })
    const after = await stat(path, { bigint: true })
    expect(after.ctimeNs).not.toBe(before.ctimeNs)
    expect(after.mtimeNs).toBe(before.mtimeNs)
    expect(await readFile(path, 'utf8')).toBe('hello original\n')
    expect((await call('read-owned')).isError).toBe(false)
    expect((await call('edit-owned')).isError).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('hello updated\n')
  })

  it.each(['metadata', 'same-size-content'] as const)('rejects an external %s change after ACL preparation', async (kind) => {
    expect((await call('read-owned')).isError).toBe(false)
    if (kind === 'metadata') {
      const info = await stat(path)
      await utimes(path, info.atime, new Date(info.mtimeMs + 10_000))
    } else await writeFile(path, 'hello changed!\n')
    expect(await call('edit-owned')).toMatchObject({ isError: true, error: { info: { code: 'FS_STALE_VERSION' } } })
    expect(await readFile(path, 'utf8')).toBe(kind === 'metadata' ? 'hello original\n' : 'hello changed!\n')
  })
})
