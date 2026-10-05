import { Context } from '@deepseek-ai/cordis'
import Agents, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm, { ToolCallId } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Approval, { type ApprovalAnswer, type ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installNativeBrowserGuard, nativeBrowserApprovalReason, nativeSnapshotLabels } from '../src/native-approval.ts'

const contexts: Context[] = []
const prefix = 'mcp__xiaojing-edge-existing__'
let identity = 0

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function fixture(allowPrivateHosts = true, globalGuard = false, browser: 'edge' | 'chrome' = 'edge', routePrefix = prefix) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  await ctx.plugin(Llm).await()
  await ctx.plugin(Sessions).await()
  await ctx.plugin(Projections).await()
  await ctx.plugin(Agents).await()
  await ctx.plugin(AgentLoop, { agents: [] }).await()
  await ctx.plugin(Approval, { policy: 'never' }).await()
  const { agent } = await ctx.agents.create({ sessionId: SessionId(`native-confirmation-${identity++}`) })
  agent.session.append('turn/start', { turn: 1 })
  let policy = ctx
  await ctx.plugin({
    name: 'native-confirmation-fixture', inject: ['tools', 'approval'],
    apply(inner) {
      policy = globalGuard ? inner : createScope(inner, agent).ctx
      installNativeBrowserGuard(policy, { prefix: routePrefix, browser, surface: 'existing', owner: agent, allowPrivateHosts })
    },
  }).await()
  let call = 0
  const run = (action: string, args: object = {}, owner: Agent = agent, signal = new AbortController().signal) => ctx.tools.execute({
    name: routePrefix + action, arguments: args, agent: owner, callId: ToolCallId(`native-confirmation-${call++}`), signal,
  })
  const register = (action: string, text = 'Completed') => {
    const execute = vi.fn(async () => text)
    policy.tools.register({
      name: routePrefix + action, description: 'Native browser fixture', parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value as string }] }, execute,
    })
    return execute
  }
  const snapshot = async (text: string) => {
    const remove = policy.tools.register({
      name: routePrefix + 'browser_snapshot', description: 'Native snapshot fixture', parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value as string }] },
      execute: async () => text,
    })
    const result = await run('browser_snapshot')
    remove()
    return result
  }
  const answer = vi.fn(async (_request: ApprovalRequest) => 'allowed-once' as const)
  return { ctx, policy, agent, run, register, snapshot, answer }
}

describe('native snapshot confirmation labels', () => {
  it('retains dialog and row context without references and removes it for siblings', () => {
    const labels = nativeSnapshotLabels([{ type: 'text', text: [
      '- dialog "Delete report":',
      '  - button "OK" [ref=e1]',
      '- table:',
      '  - row "Transfer funds":',
      '    - button "Continue" [ref=e2]',
      '- button "Search" [ref=e3]',
    ].join('\n') }])
    expect(labels.get('e1')).toBe('dialog "Delete report": / button "OK"')
    expect(labels.get('e2')).toBe('row "Transfer funds": / button "Continue"')
    expect(labels.get('e3')).toBe('button "Search"')
  })

  it('classifies legacy drag references and generic confirmation controls', () => {
    const labels = new Map([['e1', 'button "Delete report"'], ['e2', 'button "OK"']])
    expect(nativeBrowserApprovalReason('browser_drag', { startRef: 'e1', endRef: 'e2' }, labels)).toContain('destructive')
    expect(nativeBrowserApprovalReason('browser_click', { target: 'e2' }, labels)).toContain('external-impact')
  })

  it('reads DevTools UIDs and nested dialog context', () => {
    const labels = nativeSnapshotLabels([{ type: 'text', text: [
      'uid=1_0 RootWebArea "Ledger" url="https://8.8.8.8/"',
      '  uid=1_1 dialog "Remove voucher"',
      '    uid=1_2 button "Continue"',
      '  uid=1_3 textbox "Search"',
    ].join('\n') }])
    expect(labels.get('1_2')).toBe('dialog "Remove voucher" / button "Continue"')
    expect(labels.get('1_3')).toBe('textbox "Search"')
  })
})

describe('DevTools native catalog confirmation', () => {
  it('uses click uid and ignores unrelated target, fields, and model descriptions', async () => {
    const { ctx, snapshot, run, register, answer } = await fixture()
    ctx.on('approval/request', answer)
    await snapshot('## Latest page snapshot\nuid=1_0 RootWebArea "Ledger" url="https://8.8.8.8/"\n  uid=1_1 button "Delete voucher"\n  uid=1_2 button "Search"')
    const execute = register('click')
    expect((await run('click', { uid: '1_1', target: '1_2', fields: [{ target: '1_2' }], element: 'Harmless search' })).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
    expect(answer.mock.calls[0]?.[0].reason).toContain('Delete voucher')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('checks every fill_form element UID and rejects observed password fields', async () => {
    const { ctx, snapshot, run, register, answer } = await fixture()
    ctx.on('approval/request', answer)
    await snapshot('## Latest page snapshot\nuid=1_0 RootWebArea "Search"\n  uid=1_1 textbox "Search"\n  uid=1_2 textbox "Password"')
    const execute = register('fill_form')
    expect((await run('fill_form', { elements: [{ uid: '1_1', value: 'report' }] })).isError).toBe(false)
    expect(answer).not.toHaveBeenCalled()
    expect((await run('fill_form', { elements: [{ uid: '1_1', value: 'report' }, { uid: 'missing', value: 'other' }] })).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
    expect((await run('fill_form', { elements: [{ uid: '1_2', value: 'secret' }] })).isError).toBe(true)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['upload_file', {}], ['evaluate_script', {}], ['click_at', {}], ['handle_dialog', { action: 'accept' }],
    ['type_text', { text: 'report' }], ['press_key', { key: 'Control+S' }], ['execute_webmcp_tool', {}],
    ['navigate_page', { url: 'https://8.8.8.8/', initScript: 'window.changed = true' }], ['future_native_action', {}],
  ])('requires mandatory confirmation for %s', async (action, args) => {
    const { ctx, run, register, answer } = await fixture()
    ctx.on('approval/request', answer)
    const execute = register(action)
    expect((await run(action, args)).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledOnce()
  })

  it('does not reuse references after an empty complete snapshot', async () => {
    const { ctx, run, register, answer } = await fixture()
    ctx.on('approval/request', answer)
    const read = register('take_snapshot', '## Latest page snapshot\nuid=1_0 RootWebArea "Search"\n  uid=1_1 button "Search"')
    register('click')
    await run('take_snapshot')
    expect((await run('click', { uid: '1_1' })).isError).toBe(false)
    expect(answer).not.toHaveBeenCalled()
    read.mockResolvedValue('## Latest page snapshot\nNo accessible controls')
    await run('take_snapshot')
    expect((await run('click', { uid: '1_1' })).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
  })

  it('checks an explicit pageId destination and keeps its UIDs separate from the selected page', async () => {
    const { ctx, run, register, answer } = await fixture(false)
    ctx.on('approval/request', answer)
    register('list_pages', '## Pages\n1: Public (https://8.8.8.8/) [selected]\n2: Private ledger (http://127.0.0.1:8040/)')
    expect((await run('list_pages')).isError).toBe(false)
    expect(answer).not.toHaveBeenCalled()
    register('take_snapshot', '## Latest page snapshot\nuid=2_0 RootWebArea "Private ledger" url="http://127.0.0.1:8040/"\n  uid=2_1 button "Search"')
    expect((await run('take_snapshot', { pageId: 2 })).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
    expect(answer.mock.calls[0]?.[0].reason).toContain('127.0.0.1')
    register('click')
    expect((await run('click', { pageId: 2, uid: '2_1' })).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
    expect((await run('click', { uid: '2_1' })).isError).toBe(false)
    expect(answer).toHaveBeenCalledTimes(2)
    expect(answer.mock.calls[1]?.[0].reason).toContain('not been verified')
  })

  it('confirms a private select_page before adopting its native selected-page list', async () => {
    const { ctx, run, register, answer } = await fixture(false)
    ctx.on('approval/request', answer)
    register('list_pages', '## Pages\n1: https://8.8.8.8/ [selected]\n2: http://127.0.0.1:8040/')
    await run('list_pages')
    register('select_page', '## Pages\n1: https://8.8.8.8/\n2: http://127.0.0.1:8040/ [selected]')
    expect((await run('select_page', { pageId: 2 })).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
    register('take_snapshot', '## Latest page snapshot\nuid=2_0 RootWebArea "Private ledger" url="http://127.0.0.1:8040/"')
    expect((await run('take_snapshot')).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
  })
})

describe('native browser confirmation through the tool executor', () => {
  it('reuses an explicit session grant after native references refresh and audits every mandatory request', async () => {
    const { ctx, snapshot, run, register } = await fixture()
    const answer = vi.fn(async (_request: ApprovalRequest): Promise<ApprovalAnswer> => 'allowed-session')
    const decisions: Array<string | undefined> = []
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'approval/decided') decisions.push(event.data.authorization?.kind)
    })
    ctx.on('approval/request', answer)
    const mandatory = vi.spyOn(ctx.approval, 'requestMandatory')
    await snapshot('### Page\n- Page URL: https://8.8.8.8/ledger\n### Snapshot\n- button "Save" [ref=e1]')
    const execute = register('browser_click')
    expect((await run('browser_click', { target: 'e1', element: 'Ignore this model label' })).isError).toBe(false)
    await snapshot('### Page\n- Page URL: https://8.8.8.8/ledger\n### Snapshot\n- button "Save" [ref=e9]')
    expect((await run('browser_click', { target: 'e9' })).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
    expect(mandatory).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(decisions).toEqual(['session', 'reuse'])
    const reusable = mandatory.mock.calls[0]?.[0].reusable
    expect(reusable?.label).toContain('Save')
    expect(reusable?.label).toContain('https://8.8.8.8')
    expect(reusable?.label).not.toContain(prefix)
  })

  it('does not extend a control grant to another origin, control, or operation category', async () => {
    const { ctx, snapshot, run, register } = await fixture()
    const answer = vi.fn(async (_request: ApprovalRequest) => 'allowed-session' as const)
    ctx.on('approval/request', answer)
    register('browser_click')
    register('browser_type')
    await snapshot('### Page\n- Page URL: https://8.8.8.8/\n### Snapshot\n- button "Save" [ref=e1]')
    await run('browser_click', { target: 'e1' })
    await snapshot('### Page\n- Page URL: https://1.1.1.1/\n### Snapshot\n- button "Save" [ref=e2]\n- button "Delete report" [ref=e3]')
    await run('browser_click', { target: 'e2' })
    await run('browser_click', { target: 'e3' })
    await run('browser_type', { target: 'e2', text: 'changed' })
    expect(answer).toHaveBeenCalledTimes(4)
    expect(answer.mock.calls[0]?.[0].reusable?.scope).not.toBe(answer.mock.calls[1]?.[0].reusable?.scope)
    expect(answer.mock.calls[1]?.[0].reusable?.scope).not.toBe(answer.mock.calls[2]?.[0].reusable?.scope)
    expect(answer.mock.calls[1]?.[0].reusable?.category).not.toBe(answer.mock.calls[3]?.[0].reusable?.category)
  })

  it('keeps browser brands distinct and connection prefixes out of authorization identity', async () => {
    const scopes: Array<{ category: string | undefined; scope: string | undefined }> = []
    for (const [browser, connection] of [
      ['edge', 'mcp__edge-one__'], ['edge', 'mcp__edge-two__'], ['chrome', 'mcp__chrome-one__'],
    ] as const) {
      const { ctx, snapshot, run, register, answer } = await fixture(true, false, browser, connection)
      ctx.on('approval/request', answer)
      await snapshot('### Page\n- Page URL: https://8.8.8.8/\n### Snapshot\n- button "Save" [ref=e1]')
      register('browser_click')
      expect((await run('browser_click', { target: 'e1' })).isError).toBe(false)
      const classification = answer.mock.calls[0]?.[0].reusable
      scopes.push({ category: classification?.category, scope: classification?.scope })
    }
    expect(scopes[0]).toEqual(scopes[1])
    expect(scopes[0]?.scope).not.toBe(scopes[2]?.scope)
  })

  it('does not reuse authorization from another live Session', async () => {
    const questions = vi.fn(async () => 'allowed-session' as const)
    for (let session = 0; session < 2; session += 1) {
      const { ctx, snapshot, run, register } = await fixture()
      ctx.on('approval/request', questions)
      await snapshot('### Page\n- Page URL: https://8.8.8.8/\n### Snapshot\n- button "Delete" [ref=e1]')
      register('browser_click')
      expect((await run('browser_click', { target: 'e1' })).isError).toBe(false)
    }
    expect(questions).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['browser_file_upload', { target: 'e1' }], ['browser_press_key', { key: 'Enter' }],
    ['browser_click', { target: 'missing', element: 'Save' }],
    ['browser_click', { target: 'e1', url: 'https://1.1.1.1/' }],
  ])('leaves %s without an observed operation scope ineligible for session authorization', async (action, args) => {
    const { ctx, snapshot, run, register, answer } = await fixture()
    ctx.on('approval/request', answer)
    await snapshot('### Page\n- Page URL: https://8.8.8.8/\n### Snapshot\n- button "Save" [ref=e1]')
    register(action)
    expect((await run(action, args)).isError).toBe(false)
    expect(answer.mock.calls[0]?.[0].reusable).toBeUndefined()
  })

  it.each(['browser_evaluate', 'evaluate_script', 'browser_run_code', 'browser_mouse_click', 'click_at'])(
    'offers a localized browser-wide session grant for %s and reuses it', async (action) => {
      const { ctx, run, register } = await fixture()
      const answer = vi.fn(async (_request: ApprovalRequest) => 'allowed-session' as const)
      ctx.on('approval/request', answer)
      const execute = register(action)
      expect((await run(action)).isError).toBe(false)
      expect((await run(action)).isError).toBe(false)
      expect(answer).toHaveBeenCalledOnce()
      expect(answer.mock.calls[0]?.[0].displayReason?.zh).toContain('浏览器')
      expect(answer.mock.calls[0]?.[0].reusable?.displayLabel?.zh).toContain('整个浏览器')
      expect(execute).toHaveBeenCalledTimes(2)
    },
  )

  it('separates script and coordinate session grants and does not create a grant from rejection', async () => {
    const { ctx, run, register } = await fixture()
    const answer = vi.fn(async (_request: ApprovalRequest): Promise<ApprovalAnswer> => 'allowed-session')
    answer.mockResolvedValueOnce('rejected')
    ctx.on('approval/request', answer)
    const script = register('browser_evaluate')
    const click = register('browser_mouse_click')
    expect((await run('browser_evaluate')).isError).toBe(true)
    expect(script).not.toHaveBeenCalled()
    expect((await run('browser_evaluate')).isError).toBe(false)
    expect((await run('browser_evaluate', { function: 'different script' })).isError).toBe(false)
    expect((await run('browser_mouse_click')).isError).toBe(false)
    expect(answer).toHaveBeenCalledTimes(3)
    expect(answer.mock.calls[1]?.[0].reusable?.category).not.toEqual(answer.mock.calls[2]?.[0].reusable?.category)
    expect(click).toHaveBeenCalledOnce()
  })

  it('asks again for a script with a one-time grant and for a new Session', async () => {
    const answer = vi.fn(async () => 'allowed-once' as const)
    for (let session = 0; session < 2; session += 1) {
      const { ctx, run, register } = await fixture()
      ctx.on('approval/request', answer)
      register('browser_evaluate')
      expect((await run('browser_evaluate')).isError).toBe(false)
      expect((await run('browser_evaluate')).isError).toBe(false)
    }
    expect(answer).toHaveBeenCalledTimes(4)
  })

  it.each([
    '### Snapshot\n- button "Save" [ref=e1]',
    '### Page\n- Page URL: https://8.8.8.8/\n### Snapshot\n- button "Save" [ref=e1]\n- button "Save" [ref=e2]',
  ])('does not classify an unobserved origin or ambiguous control for reuse', async (text) => {
    const { ctx, snapshot, run, register, answer } = await fixture()
    ctx.on('approval/request', answer)
    await snapshot(text)
    register('browser_click')
    expect((await run('browser_click', { target: 'e1' })).isError).toBe(false)
    expect(answer.mock.calls[0]?.[0].reusable).toBeUndefined()
  })

  it.each(['target', 'ref'])('uses observed deletion labels for %s and ignores model-written descriptions', async (key) => {
    const { ctx, snapshot, run, register, answer } = await fixture()
    ctx.on('approval/request', answer)
    await snapshot('### Snapshot\n- button "Delete report" [ref=e1]')
    const execute = register('browser_click')
    expect((await run('browser_click', { [key]: 'e1', element: 'Harmless search' })).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
    expect(answer.mock.calls[0]?.[0].reason).toContain('Delete report')
    expect(execute).toHaveBeenCalledOnce()
  })

  it.each(['Send', 'Pay', 'Save', 'Approve', '确定'])('confirms external-impact control %s for each execution', async (label) => {
    const { ctx, snapshot, run, register, answer } = await fixture()
    ctx.on('approval/request', answer)
    await snapshot(`### Snapshot\n- button "${label}" [ref=e1]`)
    const execute = register('browser_click')
    expect((await run('browser_click', { target: 'e1' })).isError).toBe(false)
    expect((await run('browser_click', { target: 'e1' })).isError).toBe(false)
    expect(answer).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it.each(['审核', 'Refund'])('requires a user answer for financial control %s with ordinary approval disabled', async (label) => {
    const { ctx, snapshot, run, register, answer } = await fixture()
    await snapshot(`### Snapshot\n- button "${label}" [ref=e1]`)
    const execute = register('browser_click')
    expect((await run('browser_click', { target: 'e1' })).isError).toBe(true)
    expect(execute).not.toHaveBeenCalled()
    ctx.on('approval/request', answer)
    expect((await run('browser_click', { target: 'e1' })).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
    expect(answer.mock.calls[0]?.[0].reason).toContain(label)
    expect(execute).toHaveBeenCalledOnce()
  })

  it.each(['browser_file_upload', 'browser_evaluate', 'browser_run_code', 'browser_mouse_click'])('allows %s only after mandatory confirmation with ordinary prompts disabled', async (action) => {
    const { ctx, run, register, answer } = await fixture()
    ctx.on('approval/request', answer)
    const execute = register(action)
    expect((await run(action)).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledOnce()
  })

  it('fails closed without an answerer and when the user rejects', async () => {
    const { ctx, run, register } = await fixture()
    const execute = register('browser_file_upload')
    expect((await run('browser_file_upload')).isError).toBe(true)
    ctx.on('approval/request', async () => 'rejected')
    expect((await run('browser_file_upload')).isError).toBe(true)
    expect(execute).not.toHaveBeenCalled()
  })

  it('asks for unknown selectors while allowing ordinary observed editing and rejecting password entry', async () => {
    const { ctx, snapshot, run, register, answer } = await fixture()
    ctx.on('approval/request', answer)
    await snapshot('### Snapshot\n- textbox "Search" [ref=e1]\n- textbox "Password" [ref=e2]')
    const execute = register('browser_type')
    expect((await run('browser_type', { target: 'e1', text: 'report' })).isError).toBe(false)
    expect(answer).not.toHaveBeenCalled()
    expect((await run('browser_type', { target: '#unobserved', element: 'Search', text: 'report' })).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
    expect((await run('browser_type', { target: 'e2', text: 'secret' })).isError).toBe(true)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('rejects a pre-execute listener that bypasses this policy', async () => {
    const { policy, run, register, answer } = await fixture()
    policy.on('approval/request', answer)
    policy.on('tools/pre-execute', async () => ({ kind: 'allow' }), { prepend: true })
    const execute = register('browser_file_upload')
    expect((await run('browser_file_upload')).isError).toBe(true)
    expect(answer).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not expose one Session connection to another live Agent', async () => {
    const { ctx, run, register, answer } = await fixture(true, true)
    ctx.on('approval/request', answer)
    const { agent: other } = await ctx.agents.create({ sessionId: SessionId(`other-${identity++}`) })
    other.session.append('turn/start', { turn: 1 })
    const execute = register('browser_file_upload')
    expect((await run('browser_file_upload', {}, other)).isError).toBe(true)
    expect(answer).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('requires fresh confirmation after an upstream policy denial or throw', async () => {
    const { policy, run, register, answer } = await fixture()
    policy.on('approval/request', answer)
    const execute = register('browser_file_upload')
    const deny = policy.on('tools/pre-execute', async () => ({ kind: 'deny', reason: 'Other policy' }))
    expect((await run('browser_file_upload')).isError).toBe(true)
    deny()
    const throwing = policy.on('tools/pre-execute', async () => { throw new Error('Other policy failed') })
    expect((await run('browser_file_upload')).isError).toBe(true)
    throwing()
    expect((await run('browser_file_upload')).isError).toBe(false)
    expect(answer).toHaveBeenCalledTimes(3)
    expect(execute).toHaveBeenCalledOnce()
  })
})

describe('native browser private destination confirmation', () => {
  it('requires mandatory confirmation for an existing local page without applying a legacy HTTP-only ban', async () => {
    const { ctx, run, register, answer } = await fixture(false)
    ctx.on('approval/request', answer)
    register('browser_tabs', '### Open tabs\n- 0: (current) [Local preview](file:///D:/Reports/preview.html)')
    await run('browser_tabs', { action: 'list' })
    const execute = register('browser_snapshot', '### Page\n- Page URL: file:///D:/Reports/preview.html\n### Snapshot\n- heading "Preview" [ref=e1]')
    expect((await run('browser_snapshot')).isError).toBe(false)
    expect((await run('browser_snapshot')).isError).toBe(false)
    expect(answer).toHaveBeenCalledTimes(2)
    expect(answer.mock.calls[0]?.[0].reason).toContain('file:')
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('uses the current URL from the actual native tab-list format before reading an existing tab', async () => {
    const { ctx, run, register, answer } = await fixture(false)
    ctx.on('approval/request', answer)
    register('browser_tabs', '### Open tabs\n- 0: (current) [Private ledger](http://127.0.0.1:8040/ledger)')
    expect((await run('browser_tabs', { action: 'list' })).isError).toBe(false)
    expect(answer).not.toHaveBeenCalled()
    const execute = register('browser_snapshot', '### Page\n- Page URL: http://127.0.0.1:8040/ledger\n### Snapshot\n- heading "Ledger" [ref=e1]')
    expect((await run('browser_snapshot')).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
    expect(answer.mock.calls[0]?.[0].reason).toContain('127.0.0.1')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('confirms a private selected tab and clears references from the previous page', async () => {
    const { ctx, run, register, answer } = await fixture(false)
    ctx.on('approval/request', answer)
    const tabs = register('browser_tabs', '### Open tabs\n- 0: (current) [Public](https://8.8.8.8/)\n- 1: [Private](http://127.0.0.1:8040/)')
    await run('browser_tabs', { action: 'list' })
    const snapshot = register('browser_snapshot', '### Page\n- Page URL: https://8.8.8.8/\n### Snapshot\n- button "Search" [ref=e1]')
    await run('browser_snapshot')
    tabs.mockResolvedValue('### Open tabs\n- 0: [Public](https://8.8.8.8/)\n- 1: (current) [Private](http://127.0.0.1:8040/)')
    expect((await run('browser_tabs', { action: 'select', index: 1 })).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
    snapshot.mockResolvedValue('### Page\n- Page URL: http://127.0.0.1:8040/\n### Snapshot\n- button "Search" [ref=e2]')
    const execute = register('browser_click')
    expect((await run('browser_click', { target: 'e1' })).isError).toBe(false)
    expect(answer).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledOnce()
    await run('browser_snapshot')
    expect(answer).toHaveBeenCalledTimes(2)
  })

  it('does not retain private-host approval when a later monotonic guard denies the call', async () => {
    const { policy, run, register, answer } = await fixture(false)
    policy.on('approval/request', answer)
    const execute = register('browser_navigate', '### Page\n- Page URL: http://127.0.0.1:8040/')
    const deny = policy.tools.guard(() => 'Later guard denied')
    expect((await run('browser_navigate', { url: 'http://127.0.0.1:8040/' })).isError).toBe(true)
    deny()
    expect((await run('browser_navigate', { url: 'http://127.0.0.1:8040/' })).isError).toBe(false)
    expect(answer).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledOnce()
  })

  it('does not retain private-host approval when the browser operation fails', async () => {
    const { policy, run, register, answer } = await fixture(false)
    policy.on('approval/request', answer)
    const execute = register('browser_navigate', '### Page\n- Page URL: http://127.0.0.1:8040/')
    execute.mockRejectedValueOnce(new Error('Browser disconnected'))
    expect((await run('browser_navigate', { url: 'http://127.0.0.1:8040/' })).isError).toBe(true)
    expect((await run('browser_navigate', { url: 'http://127.0.0.1:8040/' })).isError).toBe(false)
    expect(answer).toHaveBeenCalledTimes(2)
  })

  it('requires confirmation before accessing an existing tab whose destination has not been observed', async () => {
    const { ctx, run, register, answer } = await fixture(false)
    ctx.on('approval/request', answer)
    register('browser_snapshot', '### Page\n- Page URL: https://8.8.8.8/\n### Snapshot\n- heading "Public" [ref=e1]')
    expect((await run('browser_snapshot')).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
    expect((await run('browser_snapshot')).isError).toBe(false)
    expect(answer).toHaveBeenCalledOnce()
  })
})
