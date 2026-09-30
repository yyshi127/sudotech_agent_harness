/** Shipped Finance preset and browser transcript; only the external vendor and model are substituted. */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import { ToolCallId, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-xiaojing-finance-domain'
import type {} from '@deepseek-ai/dsh-tools'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, revealToolCallCard, webClientProfile, webSnapshotMode } from './scaffold.ts'
import { financePresetDefinition } from './xiaojing-agent-presets.ts'

const queries = [
  { kind: 'subjects', name: '费用' }, { kind: 'auxiliary-categories' }, { kind: 'auxiliary-items', categoryCode: '01' },
  { kind: 'cash-accounts' }, { kind: 'cash-categories' },
]

class ReferenceAdapter extends LlmAdapter {
  calls = 0
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const tool = options.tools?.find(tool => tool.name === 'finance_references')
    expect(tool?.description).toContain('科目与出纳账户 directionRaw：0借1贷；收支类别：0收1支')
    const query = queries[this.calls++]
    if (query !== undefined) {
      const args = JSON.stringify(query)
      const id = ToolCallId(`reference-${this.calls}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'finance_references', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'finance_references', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      expect(JSON.stringify(options.messages)).toContain('ambiguous')
      expect(JSON.stringify(options.messages)).toContain('unverified')
      expect(JSON.stringify(options.messages)).toContain('本次科目 directionRaw：0借1贷')
      expect(JSON.stringify(options.messages)).toContain('未返回方向时不能根据名称或会计惯例推断')
      expect(JSON.stringify(options.messages)).toContain('subjectType')
      expect(JSON.stringify(options.messages)).toContain('期间费用')
      const text = '五类基础资料已查询；同名科目6602返回类型为期间费用、方向为借，660201未提供类型和方向，不能沿用父科目属性。请按编码区分；清单完整性尚未验证，未新增任何资料。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it.skipIf(webClientProfile() !== 'xiaojing')('queries five reference kinds without guessing same-name records or writing to the vendor', async () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  const scaffold = await launchWebScaffold({ agentPresets: { default: 'standard', definitions: [financePresetDefinition()] } })
  const browser = await chromium.launch()
  const originalFetch = globalThis.fetch
  const paths: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.origin !== 'https://cwdata.yiqiyun.com') return originalFetch(input, init)
    paths.push(url.pathname)
    if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'snapshot-token' })
    if (url.pathname.endsWith('queryAccountList.rjson')) return Response.json({ result: 100, data: [{ id: 'ref-ledger', sobName: '基础资料演示' }] })
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body')
    expect(JSON.parse(init.body)).toMatchObject({ setOfBooksId: 'ref-ledger', sobName: '基础资料演示', pageSize: 1000 })
    const fixtures: Record<string, unknown[]> = {
      '/finance/auxiliary/querySubjectInfoList.rjson': [
        { subjectCode: '6602', subjectName: '费用', subjectType: '期间费用', enableStatus: '1', hasChild: true, parentSubjectCode: '', balanceDirection: '0' },
        { subjectCode: '660201', subjectName: '费用', enableStatus: '0', hasChild: false, parentSubjectCode: '6602' },
      ],
      '/finance/auxiliary/queryAuxiliaryCategoryList.rjson': [{ id: 'cat', categoryCode: '01', categoryName: '客户' }],
      '/finance/auxiliary/queryAuxiliaryItemList.rjson': [{ id: 'item', itemCode: '001', itemName: '客户甲', categoryId: 'cat' }],
      '/finance/cashjournal/getAccountList.rjson': [{ accountId: 11, accountName: '银行', status: 0, direction: false, subjectCode: '1002' }],
      '/finance/cashjournal/getCategoryList.rjson': [{ id: 21, code: '01', name: '销售收入', type: false }],
    }
    const rows = fixtures[url.pathname]
    expect(rows).toBeDefined()
    if (url.pathname.endsWith('queryAuxiliaryItemList.rjson')) expect(JSON.parse(init.body)).toMatchObject({ categoryCode: '01' })
    return Response.json({ result: 100, data: rows })
  }))
  try {
    const ctx = scaffold.ctx
    const workspacePath = join(scaffold.workspaceCwd, 'reference-client')
    await mkdir(workspacePath)
    const created = await ctx.xiaojingFinanceDomain.create({ expectedRevision: 0, workspacePath,
      client: { legalName: '基础资料测试企业', shortName: '基础资料测试', taxpayerType: 'general-vat', registeredRegion: '上海', accountingStandard: 'enterprise', chartMappings: [], externalSystemRefs: [],
        financeSystem: { system: 'youcheng', environment: 'test', accountCode: 'ref-ledger', appKey: 'snapshot-key' } },
      credentialInput: { youchengAppSecret: 'snapshot-secret' },
    })
    const adapter = new ReferenceAdapter()
    ctx.effect(() => ctx.llm.registerAdapter(['reference-test'], adapter))
    const handle = await ctx.agents.create({ sessionId: SessionId('finance-reference-chat'), meta: { cwd: workspacePath, agentPreset: 'finance' },
      agentOptions: { provider: 'reference-test', model: 'reference-test' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'finance').then(() => undefined),
    })
    try {
      const workspace = await ctx.workspaceRegistry.resolveByPath(workspacePath)
      if (workspace === undefined) throw new Error('Missing workspace')
      await workspace.attachSession(handle.agent.session.id)
      await ctx.xiaojingFinanceDomain.stage(handle.agent, { mode: 'client', clientId: created.client.id })
      const before = await readFile(join(scaffold.harnessHome, 'finance/clients-v1.json'), 'utf8')
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '查询账套的科目、辅助类别和项目、出纳账户及收支类别，不新增资料。' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      expect(adapter.calls).toBe(6)
      const events = handle.agent.session.snapshotEvents()
      expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual(queries.map(() => 'finance_references'))
      const results = events.filter(event => event.type === 'tool/result').map(event => event.data.message.content)
      expect(JSON.stringify(results)).not.toMatch(/snapshot-key|snapshot-secret|snapshot-token/)
      expect(JSON.stringify(results)).toContain('disabled')
      expect(paths).toHaveLength(16)
      expect(await readFile(join(scaffold.harnessHome, 'finance/clients-v1.json'), 'utf8')).toBe(before)
      await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-references/result.expected.md', import.meta.url)), JSON.stringify(results, null, 2), webSnapshotMode())
      const page = await browser.newPage({ locale: 'zh-CN' })
      await page.addInitScript((sessionId) => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId })) }, handle.agent.session.id)
      await page.goto(scaffold.authenticatedUrl)
      const card = page.locator('[data-chat-call-id="reference-1"]')
      await revealToolCallCard(page, '[data-chat-call-id="reference-1"]')
      await expect.poll(() => card.textContent()).toContain('资料类型：会计科目')
      await expect.poll(() => card.textContent()).toContain('返回记录：2 条')
      expect(await card.textContent()).not.toMatch(/unverified|coverage|requestedLimit|returnedCount|接口/)
      await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-references/card.expected.md', import.meta.url)),
        await captureStableAria(page, '[data-chat-call-id="reference-1"]', scaffold.workspaceCwd), webSnapshotMode())
      const standard = await ctx.agents.create({ sessionId: SessionId('reference-standard'), setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined) })
      try { expect(ctx.tools.schemas(standard.agent).some(tool => tool.name === 'finance_references')).toBe(false) }
      finally { await standard.dispose() }
    } finally { await handle.dispose() }
  } finally {
    vi.unstubAllGlobals()
    await browser.close()
    await scaffold.close()
    vi.unstubAllEnvs()
  }
}, 120_000)
