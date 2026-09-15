/** Shipped Finance chat: imported invoice, mandatory confirmation, OSS transfer, and draft readback. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { type Session, SessionId } from '@deepseek-ai/dsh-session'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-xiaojing-finance-domain'
import type {} from '@deepseek-ai/dsh-tools'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, webClientProfile, webSnapshotMode } from './scaffold.ts'

const request = { action: 'create', draft: {
  templateCode: 'travel', submitterId: 'u1', employeeId: 'u1', departmentId: 'd1', title: '客户拜访交通费', date: '2026-09-04', payeeCardId: 1,
  fields: [], fees: ['invoice.pdf', 'invoice.png'].map(invoice => ({ templateCode: 'traffic', amount: '10.00', fields: [{ code: 'dateMerge', bindingVal: '2026-09-03' }], invoices: [invoice] })),
} }
const obsoleteError = '所选报销单模板没有附件组件，无法随单据传入发票原件。'

// A settled old-version log exercises resumption without reintroducing its obsolete executor.
function appendLegacyHistory(session: Session): void {
  const callId = CallId('reimbursement-legacy')
  const args = JSON.stringify({ requestJson: JSON.stringify(request) })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '差旅报销单带上发票原件，保存草稿。' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('request/header', { header: { config: { provider: 'draft-test', model: 'draft-test' }, system: 'Legacy reimbursement fixture.' }, reason: 'initial' })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '旧版报销上下文：模板未列出附件时无法附带原件。' }], source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' } }), { surfaceOp: 'append' })
  session.append('assistant/message', { turn: 1, step: 1, message: createAssistantMessage({ content: [{ type: 'tool-call', id: callId, name: 'finance_reimbursement', arguments: args }], source: { provider: 'draft-test', model: 'draft-test' } }), usage: { inputTokens: 1, outputTokens: 1 } }, { surfaceOp: 'append' })
  const call = session.append('tool/call', { turn: 1, step: 1, callId, name: 'finance_reimbursement', arguments: args })
  session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text: obsoleteError }], isError: true }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

class DraftAdapter extends LlmAdapter {
  calls = 0
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls++
    const history = JSON.stringify(options.messages)
    expect(history).toContain(obsoleteError)
    expect(history).toContain('模板查询未列出 attachment 不代表不能带附件')
    expect(history.lastIndexOf('当前报销附件能力')).toBeGreaterThan(history.indexOf(obsoleteError))
    if (this.calls <= 3 || this.calls === 5) {
      expect(options.tools?.some(tool => tool.name === 'finance_reimbursement')).toBe(true)
      if (this.calls === 2) expect(JSON.stringify(options.messages)).toContain('cancelled')
      if (this.calls === 3) expect(JSON.stringify(options.messages)).toContain('暂停报销及附件写入')
      const name = this.calls === 1 ? 'ask_user_question' : this.calls === 3 ? 'finance_attachment_upload' : 'finance_reimbursement'
      const args = JSON.stringify(this.calls === 1 ? { questions: [{ id: 'bill', question: '确认本次报销信息？' }] }
        : this.calls === 3 ? { sourcePath: 'invoice.png' } : { requestJson: JSON.stringify(request) })
      const id = CallId(this.calls === 5 ? 'reimbursement-draft' : `reimbursement-cancel-${this.calls}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      if (this.calls === 6) expect(JSON.stringify(options.messages)).toContain('BX-SNAPSHOT-001')
      const text = this.calls === 4 ? '已暂停，等待用户重新确认报销信息。'
        : '已保存待提交报销草稿 BX-SNAPSHOT-001，未提交审批。附件已传入，是否由有成转存原件仍需核验。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it.skipIf(webClientProfile() !== 'xiaojing')('refreshes legacy attachment guidance on resume, blocks cancelled writes, then saves confirmed PDF and PNG originals', async () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  const scaffold = await launchWebScaffold({ toolsMode: 'native', agentPresets: { default: 'standard', roots: [
    { path: fileURLToPath(new URL('../../cli/config/agent-presets', import.meta.url)), trust: 'system' },
    { path: fileURLToPath(new URL('../../cli/config/xiaojing-agent-presets', import.meta.url)), trust: 'system' },
  ] } })
  const browser = await chromium.launch()
  const originalFetch = globalThis.fetch
  const bytes = Buffer.from('%PDF-1.4\nsynthetic integration fixture\n%%EOF')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS2kAAAAASUVORK5CYII=', 'base64')
  const writes: string[] = []
  let approved = false
  let operationId = ''
  const c = (code: string, type: string) => ({ code, type, require: true, label: code })
  vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.origin === 'https://attachments.example.com') {
      expect(approved).toBe(true)
      expect(init?.method).toBe('PUT')
      expect(Buffer.from(init?.body as Uint8Array)).toEqual(url.pathname.endsWith('.png') ? png : bytes)
      writes.push('attachment')
      return new Response(null, { status: 200 })
    }
    if (url.origin !== 'https://yiqbdata.superboss.cc') return originalFetch(input, init)
    if (typeof init?.body !== 'string') throw new Error('Expected a JSON body')
    const body = JSON.parse(init.body) as Record<string, unknown>
    let data: unknown
    if (url.pathname.startsWith('/auth/')) data = { accessToken: 'reimbursement-fixture-token' }
    else if (url.pathname.includes('getTemplateTree')) data = [
      { templateCode: 'travel', templateName: '差旅报销单', templateType: 1, orderTemplateType: 1, parentTemplateCode: '0', status: 0,
        components: [c('title', 'text'), c('proposer', 'staff'), c('staff', 'staff'), c('department', 'department'), c('amount', 'amount'), c('reimbursementDate', 'date'), c('expenseInfo', 'importDetails'), c('collectionInfo', 'payeeInfo')] },
      { templateCode: 'traffic', templateName: '交通费', templateType: 2, parentTemplateCode: '0', status: 0,
        components: [c('consumptionMoney', 'amount'), c('invoiceNumber', 'number'), c('dateMerge', 'dateMerge'), c('attachment', 'attachment')] },
    ]
    else if (url.pathname.includes('getUserList')) data = [{ userId: 'u1', userName: '测试申请人', corpId: 'corp1', accessToken: 'nested-private-token' }]
    else if (url.pathname.includes('getDeptList')) data = [{ deptId: 'd1', deptName: '测试部门', parentId: '0', status: 1 }]
    else if (url.pathname.includes('getBankCardInfoList')) data = [{ cardId: 1, bankCardNum: '1234567890', holdName: '测试申请人', bankName: '测试银行' }]
    else if (url.pathname.includes('createOrder')) {
      expect(approved).toBe(true)
      expect(writes).toEqual(['attachment', 'attachment'])
      const orders = body.orderList as {
        id: string
        pushOrderStatus: string
        orderComponentList: { code: string; bindingVal: string }[]
        feeList: { feeComponentList: { code: string; bindingVal: string }[] }[]
      }[]
      expect(orders[0]).toMatchObject({ templateCode: 'travel', pushOrderStatus: '1' })
      operationId = orders[0]!.id
      const urls = JSON.parse(orders[0]!.orderComponentList.find(c => c.code === 'attachment')!.bindingVal) as string[]
      expect(urls).toHaveLength(2)
      expect(orders[0]!.orderComponentList.filter(c => c.code === 'attachment')).toHaveLength(1)
      expect(orders[0]!.orderComponentList).toContainEqual({ code: 'staff', bindingVal: 'u1' })
      expect(new URL(urls[0]!).origin).toBe('https://attachments.example.com')
      expect(new URL(urls[0]!).searchParams.has('x-oss-signature')).toBe(true)
      expect(orders[0]!.feeList.map(fee => fee.feeComponentList.filter(field => field.code === 'attachment'))).toEqual(
        urls.map(url => [{ code: 'attachment', bindingVal: JSON.stringify([url]) }]),
      )
      writes.push('draft')
      data = {}
    } else if (url.pathname.includes('getPushResult')) data = [{ orderId: operationId, orderCode: 'BX-SNAPSHOT-001' }]
    else if (url.pathname.includes('getOrderStatusList')) data = [{ orderCode: 'BX-SNAPSHOT-001', status: 1 }]
    else throw new Error(`Unexpected reimbursement operation: ${url.pathname}`)
    return Response.json({ result: 100, data })
  }))
  try {
    const ctx = scaffold.ctx
    const domain = ctx.xiaojingFinanceDomain
    const workspacePath = join(scaffold.workspaceCwd, 'reimbursement-client')
    await mkdir(workspacePath)
    const created = await domain.create({ expectedRevision: 0, workspacePath, client: {
      legalName: '报销测试企业', taxpayerType: 'general-vat', registeredRegion: '上海', accountingStandard: 'enterprise', chartMappings: [], externalSystemRefs: [],
      financeSystem: { system: 'youcheng', environment: 'test', accountCode: 'ledger-1', appKey: 'shared-fixture-key' },
    }, credentialInput: { youchengAppSecret: 'finance-fixture-secret' } })
    await domain.saveReimbursementConnection({ clientId: created.client.id, expectedRevision: 0, apiUrl: 'https://yiqbdata.superboss.cc', appKey: 'shared-fixture-key', appSecret: 'reimbursement-fixture-secret' })
    await domain.saveAttachmentStorage({ expectedRevision: 0, config: { bucket: 'fixture-bucket', region: 'oss-cn-hangzhou', endpoint: 'https://attachments.example.com', prefix: 'fixture/' }, accessKeyId: 'fixtureAccessKey123', accessKeySecret: 'fixtureSecret123' })
    const adapter = new DraftAdapter()
    ctx.effect(() => ctx.llm.registerAdapter(['draft-test'], adapter))
    ctx.on('approval/request', (req) => {
      expect(req.reason).toContain('CNY 20.00')
      expect(req.reason).toContain('invoice.pdf')
      expect(req.reason).toContain('invoice.png')
      expect(req.reason).toContain('员工：测试申请人')
      expect(req.reason).toContain('corp1')
      expect(writes).toEqual([])
      approved = true
      return Promise.resolve('allowed-once')
    }, { prepend: true })
    let handle = await ctx.agents.create({ sessionId: SessionId('finance-reimbursement-chat'), meta: { cwd: workspacePath, agentPreset: 'finance' },
      agentOptions: { provider: 'draft-test', model: 'draft-test' }, setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'finance').then(() => undefined) })
    try {
      await (await ctx.workspaceRegistry.resolveByPath(workspacePath))!.attachSession(handle.agent.session.id)
      await domain.stage(handle.agent, { mode: 'client', clientId: created.client.id })
      const uploadPath = join(domain.localUploadRoot(), 'invoice.pdf')
      await mkdir(domain.localUploadRoot(), { recursive: true })
      await writeFile(uploadPath, bytes)
      const imported = await domain.importUpload(handle.agent, { path: uploadPath, originalName: 'invoice.pdf' })
      const pngPath = join(domain.localUploadRoot(), 'invoice.png')
      await writeFile(pngPath, png)
      const importedPng = await domain.importUpload(handle.agent, { path: pngPath, originalName: 'invoice.png' })
      appendLegacyHistory(handle.agent.session)
      await ctx.sessions.flush(handle.agent.session)
      const resumeSessionId = handle.agent.session.id
      await handle.dispose()
      handle = await ctx.agents.resume({ resumeSessionId, agentOptions: { provider: 'draft-test', model: 'draft-test' },
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'finance').then(() => undefined) })
      const page = await browser.newPage({ locale: 'zh-CN' })
      await page.addInitScript((sessionId) => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId })) }, handle.agent.session.id)
      await page.goto(scaffold.baseUrl)
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '用附件按已确认的信息创建报销草稿，不提交审批。' }], source: { kind: 'user' } }))
      await page.locator('[data-question-key]').getByRole('button', { name: /放弃整组问题|Dismiss all questions/u }).click()
      await handle.agent.whenIdle()
      expect(adapter.calls, JSON.stringify(handle.agent.session.events.filter(e => e.type === 'tool/result').map(e => e.data.message.content))).toBe(4)
      expect(approved).toBe(false)
      expect(writes).toEqual([])
      expect(JSON.stringify(await domain.reimbursement(handle.agent, { action: 'template', code: 'travel' }, new AbortController().signal)))
        .toContain('不代表不支持附件')
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '重新确认：使用这两张发票，员工与申请人均为测试申请人，测试部门，差旅报销单，共20元，保存草稿。' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      expect(adapter.calls).toBe(6)
      const events = handle.agent.session.events
      expect(events.filter(e => e.type === 'tool/call').map(e => e.data.name)).toEqual(['finance_reimbursement', 'ask_user_question', 'finance_reimbursement', 'finance_attachment_upload', 'finance_reimbursement'])
      const rules = events.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'plugin' && event.data.source.form === 'snapshot'
        ? event.data.source.sections.filter(section => section.name === 'xiaojing:reimbursement') : [])
      expect(rules).toHaveLength(1)
      await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-reimbursement/context.expected.md', import.meta.url)), rules[0]!.text, webSnapshotMode())
      expect(events.some(e => e.type === 'approval/decided' && e.data.outcome === 'allowed-once')).toBe(true)
      const results = events.filter(e => e.type === 'tool/result').map(e => e.data.message.content)
      const serialized = JSON.stringify(results, null, 2)
      expect(serialized).toContain('BX-SNAPSHOT-001')
      for (const secret of [
        'finance-fixture-secret', 'reimbursement-fixture-secret', 'reimbursement-fixture-token',
        'nested-private-token', 'fixtureSecret123', 'x-oss-signature', '1234567890',
      ]) expect(JSON.stringify(events)).not.toContain(secret)
      expect(await readFile(imported.path)).toEqual(bytes)
      expect(await readFile(importedPng.path)).toEqual(png)
      await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-reimbursement/result.expected.md', import.meta.url)), serialized.replaceAll(operationId, '<operation-id>').replaceAll(created.client.id, '<client-id>'), webSnapshotMode())
      await page.locator('[data-chat-call-id="reimbursement-draft"]').waitFor()
      await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-reimbursement/card.expected.md', import.meta.url)), await captureStableAria(page, '[data-chat-call-id="reimbursement-draft"]', scaffold.workspaceCwd), webSnapshotMode())
      const standard = await ctx.agents.create({ sessionId: SessionId('reimbursement-standard'), setup: c => ctx.agentPresets.mount(c, 'standard').then(() => undefined) })
      try {
        expect(ctx.tools.schemas(standard.agent).some(t => t.name === 'finance_reimbursement')).toBe(false)
        expect((await ctx.systemPrompt.assemble(assembleContextFor(standard.agent))).contexts.some(section => section.name === 'xiaojing:reimbursement')).toBe(false)
      }
      finally { await standard.dispose() }
      expect(writes).toEqual(['attachment', 'attachment', 'draft'])
    } finally { await handle.dispose() }
  } finally { vi.unstubAllGlobals(); await browser.close(); await scaffold.close(); vi.unstubAllEnvs() }
}, 90_000)
