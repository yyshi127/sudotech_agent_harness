/** Reusable shell approval follows the production session directory owner. */

import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import { describe, expect, it, vi } from 'vitest'
import * as XiaojingProduct from '../src/index.ts'

async function fixture(toolName: 'bash' | 'pwsh' = 'pwsh') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'xiaojing-shell-approval-')))
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(WorkingDirectory, { defaultDirectory: root })
    await ctx.plugin(ApprovalService, { policy: 'never' })
    await ctx.plugin(XiaojingProduct)
    const harness = await mountAgentLoopTestHarness(ctx)
    const agent = await harness.create(SessionId('shell-directory'), {}, { cwd: root })
    agent.session.append('turn/start', { turn: 1 })
    const executed: string[] = []
    ctx.tools.register(defineTool({
      name: toolName,
      description: 'Record the directory selected by a shell call without executing a command.',
      parameters: {
        command: { type: 'string', required: true },
        workdir: { type: 'string' },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args, exec) {
        if (exec.agent === undefined) throw new Error('Missing shell fixture agent')
        const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
        const directory = typeof args.workdir === 'string' ? resolve(cwd, args.workdir) : cwd
        executed.push(directory)
        return directory
      },
    }))
    let calls = 0
    return {
      ctx, root, agent, executed,
      run: (workdir?: string) => ctx.tools.execute({
        name: toolName,
        callId: ToolCallId(`shell-directory-${++calls}`),
        arguments: {
          command: toolName === 'bash' ? 'rm test.txt' : 'Remove-Item test.txt',
          ...workdir === undefined ? {} : { workdir },
        },
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

describe('Shell approval after changing the current directory', () => {
  it.each([
    ['bash', undefined], ['bash', 'nested'], ['pwsh', undefined], ['pwsh', 'nested'],
  ] as const)('asks again in a changed %s directory with override %s', async (toolName, workdir) => {
    await using f = await fixture(toolName)
    const first = join(f.root, 'first')
    const second = join(f.root, 'second')
    await mkdir(join(first, 'nested'), { recursive: true })
    await mkdir(join(second, 'nested'), { recursive: true })
    const answer = vi.fn(async (_request: ApprovalRequest) => 'allowed-session' as const)
    f.ctx.on('approval/request', answer)

    await f.ctx.workingDirectory.set(f.agent, first)
    expect((await f.run(workdir)).isError).toBe(false)
    expect((await f.run(workdir)).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
    await f.ctx.workingDirectory.set(f.agent, second)
    expect((await f.run(workdir)).isError).toBe(false)
    expect((await f.run(workdir)).isError).toBe(false)
    expect(answer).toHaveBeenCalledTimes(2)
    expect(f.executed).toEqual([
      resolve(first, workdir ?? ''), resolve(first, workdir ?? ''),
      resolve(second, workdir ?? ''), resolve(second, workdir ?? ''),
    ])
    expect(answer.mock.calls[0]?.[0].reusable?.scope).not.toBe(answer.mock.calls[1]?.[0].reusable?.scope)
    expect(f.agent.session.header.cwd).toBe(f.root)
  })

  it('does not execute a relative command when its directory changes during confirmation', async () => {
    await using f = await fixture()
    const second = join(f.root, 'second')
    await mkdir(second)
    const answer = vi.fn(async (_request: ApprovalRequest) => {
      await f.ctx.workingDirectory.set(f.agent, second)
      return 'allowed-session' as const
    })
    f.ctx.on('approval/request', answer)

    const stale = await f.run()
    expect(stale.isError).toBe(true)
    expect(stale.content).toEqual([{ type: 'text', text: 'Error: 工作目录在确认期间发生变化，本次命令未执行，请重新发起。' }])
    expect(f.executed).toEqual([])
    expect((await f.run()).isError).toBe(false)
    expect(answer).toHaveBeenCalledTimes(2)
    expect(f.executed).toEqual([second])
  })

  it('asks for the recovered directory when the selected directory disappears', async () => {
    await using f = await fixture()
    const temporary = join(f.root, 'temporary')
    await mkdir(temporary)
    const answer = vi.fn(async (_request: ApprovalRequest) => 'allowed-session' as const)
    f.ctx.on('approval/request', answer)
    await f.ctx.workingDirectory.set(f.agent, temporary)
    expect((await f.run()).isError).toBe(false)
    await rm(temporary, { recursive: true })

    expect((await f.run()).isError).toBe(false)
    expect(answer).toHaveBeenCalledTimes(2)
    expect(f.executed).toEqual([temporary, f.root])
    expect(f.ctx.workingDirectory.get(f.agent.session)).toBe(f.root)
    expect(answer.mock.calls[0]?.[0].reusable?.scope).not.toBe(answer.mock.calls[1]?.[0].reusable?.scope)
  })

  it('does not execute in the recovered directory when the selected directory disappears during confirmation', async () => {
    await using f = await fixture()
    const temporary = join(f.root, 'temporary')
    await mkdir(temporary)
    await f.ctx.workingDirectory.set(f.agent, temporary)
    f.ctx.on('approval/request', async () => {
      await rm(temporary, { recursive: true })
      return 'allowed-once'
    })

    const result = await f.run()
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Error: 工作目录在确认期间发生变化，本次命令未执行，请重新发起。' }])
    expect(f.executed).toEqual([])
    expect(f.ctx.workingDirectory.get(f.agent.session)).toBe(f.root)
  })
})
