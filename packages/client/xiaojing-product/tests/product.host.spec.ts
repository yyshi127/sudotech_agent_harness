import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { configurationFixture } from '../../../settings/settings/tests/configuration-fixture.ts'
import SystemPrompt, { PERSONA_PREFIX_SECTION, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import * as XiaojingProduct from '../src/index.ts'
import { deletionApprovalReason, XIAOJING_PERSONA, XIAOJING_RESPONSE_POLICY } from '../src/index.ts'

afterEach(() => { vi.unstubAllEnvs() })

async function mountedProduct(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false }).await()
  await ctx.plugin(ToolRuntime).await()
  await ctx.plugin(ApprovalService, { policy: 'never' }).await()
  await ctx.plugin(XiaojingProduct).await()
  return ctx
}

function openTurnAgent(id: string): Agent {
  const events: Array<{ type: string; data?: Record<string, unknown> }> = [{ type: 'turn/start' }]
  return {
    id,
    session: {
      events,
      get seq() { return events.length },
      eventAt: (seq: number) => events[seq],
      append: (type: string, data: Record<string, unknown>) => {
        const event = { type, data }
        events.push(event)
        return event
      },
    },
  } as unknown as Agent
}

function shellTool(execute: () => Promise<string>): ToolDefinition {
  return {
    name: 'pwsh',
    description: 'test PowerShell tool',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute,
  }
}

async function runShell(ctx: Context, agent: Agent, command: string) {
  return await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`product-${command}`),
    name: 'pwsh',
    arguments: { command },
    agent,
  })
}

describe('Xiaojing product persona', () => {
  it.each([
    ['deepseek-official', 'deepseek-v4-flash', 'deepseek-flash'],
    ['deepseek-official', 'deepseek-v4-flash-vision-exp', 'deepseek-flash'],
    ['deepseek-official', 'deepseek-flash', 'deepseek-flash'],
    ['other-provider', 'deepseek-v4-flash', 'deepseek-v4-flash'],
  ])('migrates only retired DeepSeek Flash selections (%s/%s)', async (provider, model, expected) => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
    const { ctx } = await configurationFixture({ hmr: false })
    await ctx.agentDefaultModel.saveSelection({ provider, model })
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false }).await()
    await ctx.plugin(ToolRuntime).await()
    await ctx.plugin(ApprovalService, { policy: 'never' }).await()
    await ctx.plugin(XiaojingProduct).await()
    await vi.waitFor(() => {
      expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider, model: expected })
    })
    await ctx.fiber.dispose()
  })

  it('leaves an official-profile saved model unchanged', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const { ctx } = await configurationFixture({ hmr: false })
    await ctx.agentDefaultModel.saveSelection({
      provider: 'deepseek-official', model: 'deepseek-v4-flash',
    })
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false }).await()
    await ctx.plugin(ToolRuntime).await()
    await ctx.plugin(ApprovalService, { policy: 'never' }).await()
    await ctx.plugin(XiaojingProduct).await()
    expect(ctx.agentDefaultModel.currentSelection().model).toBe('deepseek-v4-flash')
    await ctx.fiber.dispose()
  })

  it('fills an empty deployment persona without claiming framework authorship', async () => {
    const ctx = await mountedProduct()

    const prompt = (await ctx.systemPrompt.assemble()).sections
      .find(section => section.name === PERSONA_PREFIX_SECTION)?.text
    expect(prompt).toBe(XIAOJING_PERSONA)
    expect(prompt).toContain('based on DeepSeek Harness')
    expect(prompt).toContain('do not claim that SUDO Tech developed the underlying framework')
    await ctx.fiber.dispose()
  })

  it('keeps internal execution evidence out of every Xiaojing final answer', async () => {
    const ctx = await mountedProduct()

    const policy = (await ctx.systemPrompt.assemble()).sections
      .find(section => section.name === 'xiaojing:business-facing-responses')?.text
    expect(policy).toBe(XIAOJING_RESPONSE_POLICY)
    expect(policy).toContain('Treat it as internal working context')
    expect(policy).toContain('Translate internal lifecycle states')
    expect(policy).toContain('do not narrate failed attempts')
    expect(policy).toContain('do not expose internal error codes')
    expect(policy).toContain('Do not append checksums, byte sizes')
    await ctx.fiber.dispose()
  })

  it('leaves an explicitly configured persona unchanged', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, personaPrefix: 'User-selected persona.' }).await()
    await ctx.plugin(ToolRuntime).await()
    await ctx.plugin(ApprovalService, { policy: 'never' }).await()
    await ctx.plugin(XiaojingProduct).await()

    const assembled = await ctx.systemPrompt.assemble()
    expect(assembled.sections.find(section => section.name === PERSONA_PREFIX_SECTION)?.text).toBe('User-selected persona.')
    expect(renderPrompt(assembled)).toContain(XIAOJING_RESPONSE_POLICY)
    await ctx.fiber.dispose()
  })
})

describe('mandatory deletion confirmation', () => {
  it.each([
    ['pwsh', { command: "Remove-Item 'C:\\Users\\Ada\\Desktop\\test.txt' -Force" }],
    ['pwsh', { command: 'git clean -fd' }],
    ['bash', { command: 'rm -rf ./build' }],
    ['schedule_delete', { id: 'daily-report' }],
  ])('detects explicit deletion through %s', (toolName, args) => {
    expect(deletionApprovalReason(toolName, args)).toContain('二次确认')
  })

  it.each([
    ['pwsh', { command: "Get-Item 'C:\\Users\\Ada\\Desktop\\test.txt'" }],
    ['bash', { command: 'ls -la' }],
    ['pwsh', null],
    ['pwsh', { command: 42 }],
    ['schedule_list', {}],
  ])('does not classify a non-deleting %s call', (toolName, args) => {
    expect(deletionApprovalReason(toolName, args)).toBeUndefined()
  })

  it('bounds and flattens the operation preview', () => {
    const reason = deletionApprovalReason('pwsh', { command: `Remove-Item  ${'x'.repeat(260)}\n-Force` })

    expect(reason).toMatch(/\.\.\.$/u)
    expect(reason).not.toContain('\n')
    expect(reason?.length).toBeLessThan(340)
  })

  it('fails closed without an answerer even when ordinary approval is never', async () => {
    const ctx = await mountedProduct()
    const body = vi.fn(() => Promise.resolve('deleted'))
    ctx.tools.register(shellTool(body))

    const result = await runShell(ctx, openTurnAgent('delete-unavailable'), "Remove-Item 'test.txt' -Force")

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Error: 当前没有可用的二次确认通道，删除操作未执行。' }])
    expect(body).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('executes exactly once after one mandatory grant under never', async () => {
    const ctx = await mountedProduct()
    const body = vi.fn(() => Promise.resolve('deleted'))
    const answer = vi.fn(() => Promise.resolve<'allowed-once'>('allowed-once'))
    ctx.on('approval/request', answer)
    ctx.tools.register(shellTool(body))

    const result = await runShell(ctx, openTurnAgent('delete-allowed'), "Remove-Item 'test.txt' -Force")

    expect(result.isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
    expect(body).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('does not execute after the user rejects the mandatory confirmation', async () => {
    const ctx = await mountedProduct()
    const body = vi.fn(() => Promise.resolve('deleted'))
    ctx.on('approval/request', () => Promise.resolve<'rejected'>('rejected'))
    ctx.tools.register(shellTool(body))

    const result = await runShell(ctx, openTurnAgent('delete-rejected'), "Remove-Item 'test.txt' -Force")

    expect(result.isError).toBe(true)
    expect(body).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('reports a cancelled mandatory confirmation distinctly', async () => {
    const ctx = await mountedProduct()
    const body = vi.fn(() => Promise.resolve('deleted'))
    ctx.on('approval/request', () => Promise.resolve<'cancelled'>('cancelled'))
    ctx.tools.register(shellTool(body))

    const result = await runShell(ctx, openTurnAgent('delete-cancelled'), "Remove-Item 'test.txt' -Force")

    expect(result.content).toEqual([{ type: 'text', text: 'Error: 删除操作确认已取消或超时，未执行。' }])
    expect(body).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('denies deletion calls that have no agent identity', async () => {
    const ctx = await mountedProduct()
    const body = vi.fn(() => Promise.resolve('deleted'))
    ctx.tools.register(shellTool(body))

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('product-missing-agent'),
      name: 'pwsh',
      arguments: { command: "Remove-Item 'test.txt' -Force" },
    })

    expect(result.content).toEqual([{ type: 'text', text: 'Error: 删除操作缺少可确认的会话身份，未执行。' }])
    expect(body).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('revokes a grant when a later pre-execute listener denies the call', async () => {
    const ctx = await mountedProduct()
    const body = vi.fn(() => Promise.resolve('deleted'))
    ctx.on('approval/request', () => Promise.resolve<'allowed-once'>('allowed-once'))
    ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'deny', reason: 'downstream denied' }))
    ctx.tools.register(shellTool(body))

    const result = await runShell(ctx, openTurnAgent('delete-downstream-denied'), "Remove-Item 'test.txt' -Force")

    expect(result.content).toEqual([{ type: 'text', text: 'Error: downstream denied' }])
    expect(body).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('revokes a grant when a later pre-execute listener throws', async () => {
    const ctx = await mountedProduct()
    const body = vi.fn(() => Promise.resolve('deleted'))
    ctx.on('approval/request', () => Promise.resolve<'allowed-once'>('allowed-once'))
    ctx.on('tools/pre-execute', () => { throw new Error('downstream exploded') })
    ctx.tools.register(shellTool(body))

    const result = await runShell(ctx, openTurnAgent('delete-downstream-error'), "Remove-Item 'test.txt' -Force")

    expect(result.content).toEqual([{ type: 'text', text: 'Error: downstream exploded' }])
    expect(body).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('monotonically denies a deletion short-circuited ahead of the confirmation listener', async () => {
    const ctx = await mountedProduct()
    const body = vi.fn(() => Promise.resolve('deleted'))
    ctx.tools.register(shellTool(body))
    ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'allow' }), { prepend: true })

    const result = await runShell(ctx, openTurnAgent('delete-bypass'), "Remove-Item 'test.txt' -Force")

    expect(result.isError).toBe(true)
    const first = result.content[0]
    expect(first?.type).toBe('text')
    if (first?.type !== 'text') throw new Error('expected a text denial')
    expect(first.text).toContain('没有完成强制二次确认')
    expect(body).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('leaves harmless shell commands untouched', async () => {
    const ctx = await mountedProduct()
    const body = vi.fn(() => Promise.resolve('read'))
    const answer = vi.fn(() => Promise.resolve<'allowed-once'>('allowed-once'))
    ctx.on('approval/request', answer)
    ctx.tools.register(shellTool(body))

    const result = await runShell(ctx, openTurnAgent('read-allowed'), "Get-Item 'test.txt'")

    expect(result.isError).toBe(false)
    expect(answer).not.toHaveBeenCalled()
    expect(body).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })
})
