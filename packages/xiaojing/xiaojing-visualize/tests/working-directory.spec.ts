/** Visualization files follow current directories while retaining session write permissions. */

import { mkdtemp, mkdir, realpath, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import { describe, expect, it, vi } from 'vitest'
import { visualizeTool } from '../src/tool.ts'

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'xiaojing-visualize-directory-')))
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(WorkingDirectory, { defaultDirectory: root })
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: root })
    const harness = await mountAgentLoopTestHarness(ctx)
    const agent = await harness.create(SessionId('visualize-directory'), {}, { cwd: root })
    ctx.tools.register(visualizeTool(ctx, 1000))
    let calls = 0
    return {
      ctx, root, agent,
      run: (args: { fragment: string; title?: string } | { action: 'update'; path: string; title: string; old_str: string; new_str: string }) => ctx.tools.execute({
        name: 'visualize',
        arguments: args,
        callId: ToolCallId(`visualize-directory-${++calls}`),
        agent,
        signal: new AbortController().signal,
      }),
      async [Symbol.asyncDispose]() {
        await ctx.fiber.dispose()
        await rm(root, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

describe('Visualization current directory', () => {
  it('creates and updates relative files below the changed directory with the original write policy', async () => {
    await using f = await fixture()
    const current = join(f.root, 'current')
    await mkdir(current)
    await f.ctx.workingDirectory.set(f.agent, current)
    const write = vi.spyOn(f.ctx.fs, 'writeText')

    const result = await f.run({ fragment: '<div>before</div>', title: 'Example' })
    expect(result.isError).toBe(false)
    const metadata = result.meta
    const savedPath = typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata) ? metadata.path : undefined
    expect(typeof savedPath).toBe('string')
    if (typeof savedPath !== 'string') throw new Error('Visualization did not return a file path')
    const target = await f.ctx.fs.resolve(savedPath)
    const file = f.ctx.fs.processPath(target)
    expect(dirname(file)).toBe(join(current, 'viz'))
    expect(await readFile(file, 'utf8')).toBe('<div>before</div>')

    await mkdir(join(f.root, 'viz'))
    const originalCopy = join(f.root, 'viz', basename(file))
    await writeFile(originalCopy, '<div>before</div>')
    expect((await f.run({
      action: 'update', path: `viz/${basename(file)}`, title: 'Example', old_str: 'before', new_str: 'after',
    })).isError).toBe(false)
    expect(await readFile(file, 'utf8')).toBe('<div>after</div>')
    expect(await readFile(originalCopy, 'utf8')).toBe('<div>before</div>')
    expect(write).toHaveBeenCalledTimes(2)
    for (const call of write.mock.calls) {
      expect(call[4]).toEqual({ mode: 'workspace-write', workspaceRoot: f.root, sessionId: f.agent.session.id })
    }
    expect(f.agent.session.header.cwd).toBe(f.root)
  })
})
