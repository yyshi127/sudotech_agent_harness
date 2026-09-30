/** Shipped Finance composition, durable open-item results and rendered cards; only network/model are mocked. */
import { createHash } from 'node:crypto'
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

const marker = { id: -123, date: '', abstractStr: '合计', subjectCode: '', subjectName: '', auxiliaryItemIds: '', auxiliaryItemName: '',
  currencyCode: '', baseCurrencyCode: '', money: 0, balance: 0, baseMoney: 0, baseBalance: 0, categoryName: '', remark: '' }
const row = { ...marker, id: 123, setOfBooksId: 35601, date: '2026-09-07', abstractStr: '往来测试', subjectCode: '1122', subjectName: '应收账款',
  currencyCode: 'CNY', baseCurrencyCode: 'CNY', money: '300.00', balance: '200.00', thisMoney: '100.00' }
class AnalysisAdapter extends LlmAdapter {
  calls = 0
  constructor(readonly scenario: string) { super() }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    if (this.calls === 1) {
      expect(JSON.stringify(options)).toContain('后端自行完整取数')
      expect(JSON.stringify(options)).toContain('本次查询记录的未结余额')
      expect(JSON.stringify(options)).toContain('有成接口提供业务明细，小兢会计在本地计算分组与差额')
      const id = ToolCallId('analysis-query')
      const args = JSON.stringify({ direction: this.scenario === 'payable' ? 'payable' : 'receivable', groupBy: this.scenario === 'missing-dimension' ? 'subject' : 'currency', periodStart: '2026-09', periodEnd: '2026-09', baselineStart: '2026-08', baselineEnd: '2026-08', ...this.scenario === 'export' || this.scenario === 'missing-dimension' ? { exportExcel: true } : {} })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'finance_open_item_analysis', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'finance_open_item_analysis', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const messages = JSON.stringify(options.messages)
      expect(messages).not.toMatch(/snapshot-secret|snapshot-token|snapshot-key|private-network/)
      expect(messages).toContain(this.scenario === 'missing-dimension' ? '可改为按币种汇总'
        : this.scenario === 'failure' ? '财务操作未完成' : this.scenario === 'export' ? '"recordCount":1' : '200.00')
      const text = this.scenario === 'missing-dimension' ? '记录缺少科目分组标识，未生成分析文件。可改为按币种汇总，不按名称猜测科目。'
        : this.scenario === 'failure' ? '应收应付查询失败，不能判断没有往来。'
          : this.scenario === 'empty' ? '接口声明本次记录数为零，汇总不算往来记录。'
            : this.scenario === 'export' ? '2026年9月与8月的应收币种分析已导出，共1笔当前记录。'
              : `两组${this.scenario === 'payable' ? '应付' : '应收'}金额差额 200.00 CNY、余额差额 150.00 CNY，不代表历史期末余额变化。`
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it.skipIf(webClientProfile() !== 'xiaojing').each(['report', 'payable', 'empty', 'failure', 'export', 'missing-dimension'])('queries open-items through the real Finance preset: %s', async (scenario) => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  const scaffold = await launchWebScaffold({ toolsMode: 'native', agentPresets: {
    default: 'standard', definitions: [financePresetDefinition()],
  } })
  const browser = await chromium.launch()
  const originalFetch = globalThis.fetch
  const paths: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.origin !== 'https://cwdata.yiqiyun.com') return originalFetch(input, init)
    paths.push(url.pathname)
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'snapshot-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35601', sobName: '应收应付测试账套' }] })
    expect(url.pathname).toBe('/finance/cashjournal/getCashierList')
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body')
    const body = JSON.parse(init.body) as { periodNumberStart: string }
    expect(['2026-09', '2026-08']).toContain(body.periodNumberStart)
    expect(JSON.parse(init.body)).toEqual({ setOfBooksId: 35601, direction: scenario === 'payable' ? 1 : 0, periodNumberStart: body.periodNumberStart, periodNumberEnd: body.periodNumberStart, page: 1, pageSize: 100 })
    const business = { ...row, subjectCode: scenario === 'missing-dimension' ? '' : row.subjectCode, date: `${body.periodNumberStart}-07`, money: body.periodNumberStart === '2026-09' ? '300.00' : '100.00', balance: body.periodNumberStart === '2026-09' ? '200.00' : '50.00' }
    if (scenario === 'failure') throw new TypeError('private-network snapshot-secret')
    return Response.json({ result: 100, data: scenario === 'empty'
      ? { count: 0, list: [marker] }
      : { count: 1, list: [scenario === 'payable' ? { ...business, subjectCode: '2202', subjectName: '应付账款' } : business, marker] } })
  }))
  try {
    const ctx = scaffold.ctx
    const workspacePath = join(scaffold.workspaceCwd, 'open-item-client')
    await mkdir(workspacePath)
    const created = await ctx.xiaojingFinanceDomain.create({ expectedRevision: 0, workspacePath,
      client: { legalName: '应收应付测试企业', shortName: '应收应付测试', taxpayerType: 'general-vat', registeredRegion: '上海', accountingStandard: 'enterprise', chartMappings: [], externalSystemRefs: [],
        financeSystem: { system: 'youcheng', environment: 'test', accountCode: '35601', appKey: 'snapshot-key' } },
      credentialInput: { youchengAppSecret: 'snapshot-secret' },
    })
    const adapter = new AnalysisAdapter(scenario)
    ctx.effect(() => ctx.llm.registerAdapter(['analysis-test'], adapter))
    const handle = await ctx.agents.create({ sessionId: SessionId('finance-analysis-chat'), meta: { cwd: workspacePath, agentPreset: 'finance' },
      agentOptions: { provider: 'analysis-test', model: 'analysis-test' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'finance').then(() => undefined),
    })
    try {
      const workspace = await ctx.workspaceRegistry.resolveByPath(workspacePath)
      if (workspace === undefined) throw new Error('Missing workspace')
      await workspace.attachSession(handle.agent.session.id)
      await ctx.xiaojingFinanceDomain.stage(handle.agent, { mode: 'client', clientId: created.client.id })
      const before = await readFile(join(scaffold.harnessHome, 'finance/clients-v1.json'), 'utf8')
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: scenario === 'missing-dimension' ? '按科目比较2026年9月和8月应收记录，并导出 Excel。' : scenario === 'export' ? '按币种比较2026年9月和8月应收记录，并导出 Excel。' : scenario === 'payable' ? '按币种比较2026年9月和8月我们欠别人的记录金额，只查询。' : '按币种比较2026年9月和8月别人欠我们的记录金额，只查询。' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      expect(adapter.calls).toBe(2)
      const events = handle.agent.session.snapshotEvents()
      expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual(['finance_open_item_analysis'])
      const results = events.filter(event => event.type === 'tool/result').map(event => event.data.message.content)
      expect(JSON.stringify(results)).not.toMatch(/snapshot-key|snapshot-secret|snapshot-token/)
      expect(await readFile(join(scaffold.harnessHome, 'finance/clients-v1.json'), 'utf8')).toBe(before)
      expect(paths).toEqual(['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson', '/finance/cashjournal/getCashierList',
        ...scenario === 'failure' || scenario === 'missing-dimension' ? [] : ['/finance/cashjournal/getCashierList']])
      if (scenario === 'missing-dimension') expect(events.filter(event => event.type === 'finance/file-published')).toHaveLength(0)
      let snapshotResult = JSON.stringify(results, null, 2)
      if (scenario === 'export') {
        const published = events.filter(event => event.type === 'finance/file-published')
        expect(published).toHaveLength(1)
        const file = published[0]!.data.file
        const bytes = await readFile(file.path)
        expect(bytes.subarray(0, 2).toString()).toBe('PK')
        expect(bytes.length).toBe(file.size)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
        expect(file.path).toContain('04-')
        const blocks = results.flat()
        const text = blocks.find(block => block.type === 'text')
        if (text?.type !== 'text') throw new Error('Missing export receipt')
        const receipt = JSON.parse(text.text) as {
          accountName: string
          direction: string
          periodStart: string
          periodEnd: string
          recordCount: number
          groupCount: number
          differenceCount: number
          exportFile: { path: string; name: string }
        }
        expect(receipt.exportFile).toEqual({ path: file.path, name: file.name })
        snapshotResult = JSON.stringify({ ...receipt, exportFile: { publishedXlsx: true } }, null, 2)
      }
      await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-open-item-analysis/${scenario}-result.expected.md`, import.meta.url)), snapshotResult, webSnapshotMode())
      const page = await browser.newPage({ locale: 'zh-CN' })
      await page.addInitScript((sessionId) => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId })) }, handle.agent.session.id)
      await page.goto(scaffold.authenticatedUrl)
      const selector = '[data-chat-call-id="analysis-query"]'
      await revealToolCallCard(page, selector)
      await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-open-item-analysis/${scenario}-card.expected.md`, import.meta.url)), await captureStableAria(page, selector, scaffold.workspaceCwd), webSnapshotMode())
      const standard = await ctx.agents.create({ sessionId: SessionId('open-item-standard'), setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined) })
      try { expect(ctx.tools.schemas(standard.agent).some(tool => tool.name === 'finance_open_item_analysis')).toBe(false) }
      finally { await standard.dispose() }
    } finally { await handle.dispose() }
  } finally { vi.unstubAllGlobals(); await browser.close(); await scaffold.close() }
}, 90_000)
