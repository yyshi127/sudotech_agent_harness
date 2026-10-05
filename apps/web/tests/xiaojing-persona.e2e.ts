/** Shipped Web configuration must select the product identity before any model request. */
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { renderContextSnapshot, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { SessionId } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, readPersistedEvents, seedSession, type WebScaffold } from './scaffold.ts'
import { financePresetDefinition } from './xiaojing-agent-presets.ts'

const PERSONA_FIXTURE = fileURLToPath(new URL('../../../snapshots/web/xiaojing-persona/session.v3.jsonl', import.meta.url))

let scaffold: WebScaffold | undefined

afterEach(async () => {
  try {
    await scaffold?.close()
  } finally {
    scaffold = undefined
    vi.unstubAllEnvs()
  }
})

it.each(['standard', 'ptc', 'cordis'])('uses the office identity in the shipped Xiaojing %s preset', async (preset) => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  scaffold = await launchWebScaffold({
    profile: { hmr: false, packages: [] },
    agentPresets: {
      definitions: [financePresetDefinition()],
      default: 'standard',
    },
  })
  const { standard } = await scaffold.ctx.xiaojingFinanceDomain.workspaces()
  const cwd = scaffold.ctx.workspaceRegistry.list().find(workspace => workspace.id === standard.workspaceId)!.path
  const handle = await scaffold.ctx.agents.create({
    sessionId: SessionId(`xiaojing-persona-${preset}`),
    meta: { cwd, agentPreset: preset },
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    setup: ctx => scaffold!.ctx.agentPresets.mount(ctx, preset).then(() => undefined),
  })
  try {
    const assembled = await handle.agent.ctx.systemPrompt.assemble({ agent: handle.agent, scope: handle.agent })
    const prompt = renderPrompt(assembled)
    expect(prompt).toContain('我是小兢会计，您的AI办公搭子！')
    expect(prompt).toContain('自我介绍使用“办公搭子”，不要称自己为“办公助手”')
    expect(prompt).toContain('即使历史回复中曾使用“办公助手”等称呼，后续自我介绍也应使用“办公搭子”')
    expect(prompt).not.toContain('You are a coding agent')
    expect(prompt).not.toContain('You are an AI agent powered by DeepSeek Harness.')
    expect(prompt).not.toContain('pnpm run dev:web')
    expect(prompt).not.toContain('{{cwd}}')
    expect(assembled.sections.some(section => section.name.startsWith('xiaojing:finance-'))).toBe(false)
    expect(assembled.tools.some(tool => tool.name.startsWith('finance_'))).toBe(false)
    if (preset === 'ptc') {
      expect(assembled.sections.find(section => section.name === 'tools:sdk')?.text).toContain('browser_connect')
      expect(assembled.sections.find(section => section.name === 'tools:sdk')?.text).not.toContain('browser_control')
    } else {
      expect(assembled.tools.some(tool => tool.name === 'browser_connect')).toBe(true)
    }
    expect(assembled.tools.some(tool => tool.name === 'browser_control')).toBe(false)
    expect(renderContextSnapshot(assembled)).toContain('Default to browser=edge; choose browser=chrome only when the user explicitly requests Chrome')
    expect(renderContextSnapshot(assembled)).toContain('select surface=existing and reuse the listed tabs')
    for (const category of ['文档处理', '数据处理', '内容撰写', '信息检索', '网页操作', '电脑操作']) {
      expect(prompt).toContain(category)
    }
    if (preset === 'cordis') expect(assembled.tools.some(tool => tool.name === 'plugin_manager')).toBe(true)
    await scaffold.ctx.agentPresets.select(handle.agent, 'finance')
    const finance = await handle.agent.ctx.systemPrompt.assemble({ agent: handle.agent, scope: handle.agent })
    expect(renderPrompt(finance)).toContain('operating in Finance模式')
    expect(renderPrompt(finance)).not.toContain('当前是办公搭子工作区')
    expect(finance.sections.some(section => section.name === 'xiaojing:finance-capabilities')).toBe(true)
    expect(finance.tools.some(tool => tool.name === 'finance_document')).toBe(true)
    await scaffold.ctx.agentPresets.select(handle.agent, preset)
    const office = await handle.agent.ctx.systemPrompt.assemble({ agent: handle.agent, scope: handle.agent })
    expect(office.sections.find(section => section.name === 'deployment:persona-prefix'))
      .toEqual(assembled.sections.find(section => section.name === 'deployment:persona-prefix'))
    expect(office.sections.some(section => section.name.startsWith('xiaojing:finance-'))).toBe(false)
    expect(office.contexts.some(context => context.name === 'xiaojing:finance-client')).toBe(false)
    await scaffold.ctx.agentPresets.select(handle.agent, 'minimal')
    const minimal = await handle.agent.ctx.systemPrompt.assemble({ agent: handle.agent, scope: handle.agent })
    expect(renderPrompt(minimal)).toBe('You are a helpful software engineer assistant.')
    expect(minimal.contexts).toEqual([])
  } finally {
    await handle.dispose()
  }
})

it('does not inject the product identity or response rules into the official profile', async () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
  scaffold = await launchWebScaffold()
  const assembled = await scaffold.ctx.systemPrompt.assemble()
  expect(assembled.sections.some(section => section.name.startsWith('xiaojing:'))).toBe(false)
  expect(assembled.sections.find(section => section.name === 'deployment:persona-prefix')?.text)
    .toBe('You are a coding agent powered by the {{model}} model.')
  expect(assembled.sections.some(section => section.name === 'harness:identity')).toBe(true)
  for (const preset of ['standard', 'ptc', 'cordis']) {
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId(`official-persona-${preset}`),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: preset },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: ctx => scaffold!.ctx.agentPresets.mount(ctx, preset).then(() => undefined),
    })
    try {
      const prompt = renderPrompt(await handle.agent.ctx.systemPrompt.assemble({ agent: handle.agent, scope: handle.agent }))
      expect(prompt).toContain('You are a coding agent powered by the deepseek-v4-flash model.')
      expect(prompt).not.toContain('当前是办公搭子工作区')
    } finally {
      await handle.dispose()
    }
  }
})

it.each([false, true])('logs the office identity in the actual model request (resumed=%s)', async (resumed) => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  scaffold = await launchWebScaffold({ replayFixture: PERSONA_FIXTURE, compareReplaySession: !resumed })
  const sessionId = resumed
    ? await seedSession(scaffold, await readFile(new URL('../../../snapshots/web/xiaojing-persona/session.v4.jsonl', import.meta.url), 'utf8'), 'persona-resumed', 'standard')
    : SessionId('persona-new')
  const options = {
    sessionId,
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    setup: (ctx: Parameters<WebScaffold['ctx']['agentPresets']['mount']>[0]) => scaffold!.ctx.agentPresets.mount(ctx, 'standard').then(() => undefined),
  }
  const handle = resumed
    ? await scaffold.ctx.agents.resume({ ...options, resumeSessionId: sessionId })
    : await scaffold.ctx.agents.create({ ...options, meta: { cwd: scaffold.workspaceCwd, agentPreset: 'standard' } })
  try {
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '你好，你能做什么？' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    expect(handle.agent.session.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(resumed ? 2 : 1)
    const system = handle.agent.session.deriveMessages().filter(message => message.role === 'system').at(-1)
    const prompt = system?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    expect(prompt).toContain('我是小兢会计，您的AI办公搭子！')
    expect(prompt).toContain('自我介绍使用“办公搭子”，不要称自己为“办公助手”')
    expect(prompt).toContain('即使历史回复中曾使用“办公助手”等称呼，后续自我介绍也应使用“办公搭子”')
    expect(prompt).not.toContain('You are a coding agent')
    expect(prompt).not.toContain('operating in Finance模式')
    expect(handle.agent.session.requestHeader()?.tools?.some(tool => tool.name.startsWith('finance_'))).toBe(false)
    expect(handle.agent.session.requestHeader()?.tools?.some(tool => tool.name === 'browser_connect')).toBe(true)
    expect(handle.agent.session.requestHeader()?.tools?.some(tool => tool.name === 'browser_control')).toBe(false)
    const modelText = handle.agent.session.deriveMessages()
      .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
    expect(modelText).toContain('Default to browser=edge; choose browser=chrome only when the user explicitly requests Chrome')
  } finally {
    await handle.dispose()
  }
  const events = await readPersistedEvents(scaffold, sessionId)
  expect(events.some(event => event.type === 'system/message')).toBe(true)
})
