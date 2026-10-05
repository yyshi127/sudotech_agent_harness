import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { configurationFixture } from '../../../settings/settings/tests/configuration-fixture.ts'
import SystemPrompt, { PERSONA_PREFIX_SECTION, renderContextSnapshot, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import * as XiaojingProduct from '../src/index.ts'
import { deletionApprovalReason, XIAOJING_PERSONA, XIAOJING_RESPONSE_POLICY } from '../src/index.ts'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import { agentPresetProjectionDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

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
  const header = { ...Session.create(SessionId(id)).header, cwd: process.cwd() }
  const session = Session.create(header.id, undefined, header)
  session.append('turn/start', { turn: 1 })
  return { id: session.id, session } as Agent
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

async function runShell(ctx: Context, agent: Agent, command: string, args: { workdir?: string; sandbox_permissions?: string } = {}) {
  return await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`product-${command}`),
    name: 'pwsh',
    arguments: { command, ...args },
    agent,
  })
}

describe('Xiaojing product persona', () => {
  it('approves office tools and deletion after confirmation, inherits to children, and revokes without affecting other sessions', async () => {
    const ctx = await mountedProduct()
    await ctx.plugin(SessionStore).await()
    await ctx.plugin(SessionProjectionRegistry).await()
    ctx.sessionProjections.register(agentPresetProjectionDefinition)
    ctx.provide('agentPresets', {})
    ctx.provide('shell', { sandboxMode: 'workspace-write' })
    await ctx.plugin(PermissionPresetService, { defaultPreset: 'workspace-write' }).await()
    await new Promise<void>(resolve => setImmediate(resolve))
    const parent = ctx.sessions.create(SessionId('office-auto'), { meta: { agentPreset: 'standard' } })
    const other = ctx.sessions.create(SessionId('office-other'), { meta: { agentPreset: 'standard' } })
    const child = ctx.sessions.create(SessionId('office-child'), { meta: { agentPreset: 'standard', origin: 'subagent', parentSession: parent.id } })
    const finance = ctx.sessions.create(SessionId('finance-auto'), { meta: { agentPreset: 'finance' } })
    const agentOf = (session: typeof parent) => Object.assign(openTurnAgent(session.id), { session })
    for (const session of [parent, other, child]) session.append('turn/start', { turn: 1 })
    ctx.permissionPresets.set(parent, 'xiaojing-no-approval')
    expect(await ctx.approval.request({ agent: agentOf(parent), toolName: 'upload_file' })).toBe('allowed-once')
    expect(await ctx.approval.requestMandatory({ agent: agentOf(child), toolName: 'pwsh', reason: 'delete fixture' })).toBe('allowed-once')
    expect(await ctx.approval.requestMandatory({ agent: agentOf(other), toolName: 'pwsh' })).toBe('unavailable')
    expect(() => { ctx.permissionPresets.set(finance, 'xiaojing-no-approval') }).toThrow('only in office')
    const future = ctx.sessions.create(SessionId('office-future-child'), { meta: { agentPreset: 'standard', origin: 'subagent', parentSession: child.id } })
    future.append('turn/start', { turn: 1 })
    expect(await ctx.approval.request({ agent: agentOf(future), toolName: 'browser_submit' })).toBe('allowed-once')
    ctx.permissionPresets.set(parent, 'workspace-write')
    expect(await ctx.approval.requestMandatory({ agent: agentOf(child), toolName: 'pwsh' })).toBe('unavailable')
    expect(await ctx.approval.requestMandatory({ agent: agentOf(future), toolName: 'pwsh' })).toBe('unavailable')
    await ctx.fiber.dispose()
  })

  it('restores a confirmed office choice but does not copy it into an ordinary fork', async () => {
    const ctx = await mountedProduct()
    await ctx.plugin(SessionStore).await()
    await ctx.plugin(SessionProjectionRegistry).await()
    ctx.sessionProjections.register(agentPresetProjectionDefinition)
    ctx.provide('agentPresets', {})
    ctx.provide('shell', { sandboxMode: 'workspace-write' })
    await ctx.plugin(PermissionPresetService, { defaultPreset: 'workspace-write' }).await()
    await new Promise<void>(resolve => setImmediate(resolve))
    const parent = ctx.sessions.create(SessionId('office-reopen'), { meta: { agentPreset: 'standard' } })
    ctx.permissionPresets.set(parent, 'xiaojing-no-approval')
    const restored = ctx.sessions.create(SessionId('office-restored'), { seed: parent.snapshotEvents(), meta: { agentPreset: 'standard' } })
    expect(ctx.permissionPresets.current(restored)).toBe('xiaojing-no-approval')
    expect(ctx.sessionProjections.stateOf(restored, 'xiaojingOfficeApproval')).toBe(true)
    const fork = ctx.sessions.fork(parent, undefined, SessionId('office-fork'))
    expect(ctx.sessionProjections.stateOf(fork, 'xiaojingOfficeApproval')).toBe(false)
    expect(ctx.permissionPresets.current(fork)).toBe('danger-full-access')
    await ctx.fiber.dispose()
  })
  it('treats an ordinary browser-opening request as authorization without requiring profile terminology', async () => {
    const ctx = await mountedProduct()
    ctx.effect(() => ctx.tools.register({ ...shellTool(() => Promise.resolve('connected')), name: 'browser_connect' }))
    try {
      const policy = renderContextSnapshot(await ctx.systemPrompt.assemble())
      expect(policy).toContain('A request to open a browser or public website authorizes the necessary browser connection and ordinary tab opening')
      expect(policy).toContain('Start browser_connect without another confirmation or prolonged authorization analysis')
      expect(policy).toContain('Default to browser=edge; choose browser=chrome only when the user explicitly requests Chrome')
      expect(policy).toContain('explicitly try surface=managed once with the same browser')
      expect(policy).not.toContain('If connection fails, explain the required connection step and do not substitute a dedicated browser')
    } finally { await ctx.fiber.dispose() }
  })

  it('retains the requested existing browser, its permissions, and rejection and page-state protections', async () => {
    const ctx = await mountedProduct()
    ctx.effect(() => ctx.tools.register({ ...shellTool(() => Promise.resolve('connected')), name: 'browser_connect' }))
    try {
      const policy = renderContextSnapshot(await ctx.systemPrompt.assemble())
      expect(policy).toContain('When the user specifically requests already-open tabs or their existing browser profile, select surface=existing')
      expect(policy).toContain('If that requested existing connection fails, report the connection requirement without replacing it')
      expect(policy).toContain('allowing remote debugging in its inspect page, and approving the browser connection')
      expect(policy).toContain('the user did not reject or cancel access or require existing tabs/profile')
      expect(policy).toContain('Do not repeat an action after an uncertain result without checking the page state')
      expect(policy).toContain('Browser code, uploads, submission, payment, and deletion remain subject to tool confirmations')
    } finally { await ctx.fiber.dispose() }
  })

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
    ['pwsh', { command: "$files = Remove-Item 'test.txt'" }],
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
    ['pwsh', { command: "Write-Output 'Remove-Item is a command'" }],
    ['pwsh', { command: 'Get-Command Remove-Item' }],
    ['pwsh', { command: '# Remove-Item old.txt\nGet-Item test.txt' }],
    ['bash', { command: 'echo "rm -rf is destructive"' }],
    ['bash', { command: 'operation=rm; echo "$operation"' }],
    ['bash', { command: 'echo "example: ; \'rm\' test.txt"' }],
    ['pwsh', { command: "@'\nRemove-Item test.txt\n'@" }],
    ['pwsh', { command: '<# Remove-Item old.txt #> Get-Item test.txt' }],
    ['pwsh', { command: "Write-Output '-EncodedCommand is a flag'" }],
  ])('does not classify a non-deleting %s call', (toolName, args) => {
    expect(deletionApprovalReason(toolName, args)).toBeUndefined()
  })

  it('decodes a literal deleting PowerShell command before requesting deletion approval', () => {
    const command = 'powershell.exe -EncodedCommand ' + Buffer.from("Remove-Item 'test.txt'", 'utf16le').toString('base64')
    expect(deletionApprovalReason('pwsh', { command })).toContain('删除')
  })

  it('does not label a readonly encoded payload as deletion or miss deletion after that payload', () => {
    const command = 'powershell.exe -EncodedCommand ' + Buffer.from("Write-Output 'Remove-Item'", 'utf16le').toString('base64')
    expect(deletionApprovalReason('pwsh', { command })).toContain('确认执行')
    expect(deletionApprovalReason('pwsh', { command })).not.toContain('删除操作')
    expect(deletionApprovalReason('pwsh', { command: command + "; Remove-Item 'test.txt'" })).toContain('删除操作')
    expect(deletionApprovalReason('bash', { command: "'rm' ./build" })).toContain('删除操作')
  })

  it('uses execution confirmation for an opaque encoded command instead of asserting deletion', () => {
    const reason = deletionApprovalReason('pwsh', { command: 'powershell.exe -EncodedCommand $encoded' })
    expect(reason).toContain('确认执行')
    expect(reason).not.toContain('删除操作')
  })

  it.each([
    '& "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -EncodedCommand $payload',
    'python -c "import os; os.remove(\'test.txt\')"',
    '& \'Remove-Item\' test.txt',
  ])('keeps indirect command %s confirmed without claiming verified deletion', (command) => {
    const reason = deletionApprovalReason('pwsh', { command })
    expect(reason).toContain('确认执行')
    expect(reason).not.toContain('删除操作')
  })

  it('offers session approval for repeated shell deletions and asks again when the command changes', async () => {
    const ctx = await mountedProduct()
    const body = vi.fn(() => Promise.resolve('deleted'))
    const answer = vi.fn((_request: ApprovalRequest) => Promise.resolve<'allowed-session'>('allowed-session'))
    ctx.on('approval/request', answer)
    ctx.tools.register(shellTool(body))
    const agent = openTurnAgent('repeated-shell-delete')
    try {
      expect((await runShell(ctx, agent, "Remove-Item 'test.txt' -Force")).isError).toBe(false)
      expect((await runShell(ctx, agent, "Remove-Item 'test.txt' -Force")).isError).toBe(false)
      expect(answer).toHaveBeenCalledOnce()
      expect(answer.mock.calls[0]?.[0].reusable?.displayLabel?.zh).toContain('同一命令')
      expect((await runShell(ctx, agent, "Remove-Item 'other.txt' -Force")).isError).toBe(false)
      expect(answer).toHaveBeenCalledTimes(2)
      expect(body).toHaveBeenCalledTimes(3)
    } finally { await ctx.fiber.dispose() }
  })

  it('separates repeated command grants by working directory, permissions, and Session', async () => {
    const ctx = await mountedProduct()
    const answer = vi.fn(async (_request: ApprovalRequest) => 'allowed-session' as const)
    ctx.on('approval/request', answer)
    ctx.tools.register(shellTool(() => Promise.resolve('deleted')))
    const agent = openTurnAgent('shell-scopes')
    const command = "Remove-Item 'test.txt'"
    try {
      await runShell(ctx, agent, command)
      await runShell(ctx, agent, command, { workdir: '.' })
      expect(answer).toHaveBeenCalledOnce()
      await runShell(ctx, agent, command, { workdir: 'other' })
      await runShell(ctx, agent, command, { sandbox_permissions: 'require_escalated' })
      await runShell(ctx, openTurnAgent('other-shell-session'), command)
      expect(answer).toHaveBeenCalledTimes(4)
      expect(answer.mock.calls[0]?.[0].reusable?.scope).not.toEqual(answer.mock.calls[1]?.[0].reusable?.scope)
    } finally { await ctx.fiber.dispose() }
  })

  it('does not reuse a one-time answer for a repeated command', async () => {
    const ctx = await mountedProduct()
    const answer = vi.fn(async () => 'allowed-once' as const)
    ctx.on('approval/request', answer)
    ctx.tools.register(shellTool(() => Promise.resolve('deleted')))
    const agent = openTurnAgent('shell-once')
    try {
      await runShell(ctx, agent, "Remove-Item 'test.txt'")
      await runShell(ctx, agent, "Remove-Item 'test.txt'")
      expect(answer).toHaveBeenCalledTimes(2)
    } finally { await ctx.fiber.dispose() }
  })

  it('does not label a rejected opaque command as a deletion', async () => {
    const ctx = await mountedProduct()
    const body = vi.fn(() => Promise.resolve('executed'))
    ctx.on('approval/request', async () => 'rejected')
    ctx.tools.register(shellTool(body))
    try {
      const result = await runShell(ctx, openTurnAgent('opaque-denied'), 'pwsh -EncodedCommand $payload')
      expect(result.content).toEqual([{ type: 'text', text: 'Error: 命令执行已被用户拒绝，未执行。' }])
      expect(body).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
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
