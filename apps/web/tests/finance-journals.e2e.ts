/** Shipped Finance composition, durable journal results and rendered cards; only network/model are mocked. */
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

const marker = { date: '', abstractStr: '初始余额', accountCode: '', accountName: '', currencyCode: '', baseCurrencyCode: '',
  balance: 0, baseBalance: 0, categoryName: '', keeperName: '' }
const row = { ...marker, id: 123, date: '2026-09-07', abstractStr: '收入测试', subjectId: 174553, subjectCode: '1001', subjectName: '库存现金',
  currencyCode: 'CNY', baseCurrencyCode: 'CNY', borrow: '120.00', loan: 0, balance: 120 }
class JournalAdapter extends LlmAdapter {
  calls = 0
  constructor(readonly scenario: string) { super() }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    if (this.calls === 1) {
      expect(JSON.stringify(options)).toContain('不要求严格关键词')
      const id = ToolCallId('journal-query')
      expect(JSON.stringify(options)).toContain('空页不等于当天没有流水')
      expect(JSON.stringify(options)).toContain('标题也必须保留接口标签')
      expect(JSON.stringify(options)).toContain('检查全部标题、表格、总结和过渡句')
      expect(JSON.stringify(options)).toContain('比较、汇总或问进账/花费差多少，必须使用 analyze:true')
      const args = JSON.stringify({ month: '2026-09', ...this.scenario.endsWith('export') ? { exportExcel: true } : {},
        ...this.scenario === 'boundary-export' ? { dateStart: '2026-09-08', dateEnd: '2026-09-08', cashAccountId: '174553' } : {},
        ...this.scenario.startsWith('analysis-') ? { analyze: true, cashAccountId: '174553', baselineMonth: '2026-08', exportExcel: true } : {},
        ...this.scenario.startsWith('bank-') ? { cashAccountId: '174554' } : {} })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'finance_journals', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'finance_journals', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const messages = JSON.stringify(options.messages)
      expect(messages).not.toMatch(/snapshot-secret|snapshot-token|snapshot-key|private-network/)
      const failed = this.scenario === 'failure' || this.scenario === 'bank-mismatch' || this.scenario === 'analysis-rejected'
      expect(messages).toContain(failed
        ? this.scenario === 'analysis-rejected' ? '与接口合计不一致' : '财务操作未完成'
        : this.scenario.endsWith('export') ? '"exportFile"' : '120.00')
      const text = this.scenario === 'analysis-rejected' ? '接口收支合计与已提供业务金额不一致，未生成汇总或文件；不能手工拼凑合计。'
        : failed ? '日记账查询失败，不能判断没有流水。'
          : this.scenario === 'analysis-export' ? '账户174553的2026年9月与8月收支分析已导出，共1笔当前记录。'
            : this.scenario === 'boundary-export' ? '2026年9月8日的库存现金流水已导出，本次共0笔。'
              : this.scenario === 'export' ? '2026年9月日记账已导出，共1笔。'
                : this.scenario === 'bank-empty' ? '所选银行账户本页没有业务流水，不代表全部期间。'
                  : this.scenario === 'empty' ? '本次只有余额汇总，不代表全账套没有流水。'
                    : '本页库存现金收入 120.00 CNY，余额汇总不是业务流水。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it.skipIf(webClientProfile() !== 'xiaojing').each(['report', 'empty', 'failure', 'export', 'bank-empty', 'bank-mismatch', 'boundary-export', 'analysis-export', 'analysis-rejected'])('queries journals through the real Finance preset: %s', async (scenario) => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  const scaffold = await launchWebScaffold({ toolsMode: 'native', agentPresets: {
    default: 'standard', roots: [
      { path: fileURLToPath(new URL('../../cli/config/agent-presets', import.meta.url)), trust: 'system' },
      { path: fileURLToPath(new URL('../../cli/config/xiaojing-agent-presets', import.meta.url)), trust: 'system' },
    ],
  } })
  const browser = await chromium.launch()
  const originalFetch = globalThis.fetch
  const paths: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.origin !== 'https://cwdata.yiqiyun.com') return originalFetch(input, init)
    paths.push(url.pathname)
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'snapshot-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35601', sobName: '日记账测试账套' }] })
    if (url.pathname === '/finance/cashjournal/getAccountList.rjson') {
      expect(scenario.startsWith('bank-') || scenario === 'boundary-export' || scenario.startsWith('analysis-')).toBe(true)
      return Response.json({ result: 100, data: [{ accountId: 174553 }, { accountId: 174554 }] })
    }
    expect(url.pathname).toBe('/finance/cashjournal/getListPage.rjson')
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body')
    if (scenario.startsWith('analysis-')) {
      const body = JSON.parse(init.body) as { periodNumber: string; page: number }
      expect(body).toMatchObject({ accountName: '日记账测试账套', subjectId: 174553, pageSize: 100 })
      expect(body.periodNumber).toMatch(/^2026-0[89]$/)
      expect(body.page).toBeLessThanOrEqual(2)
      const total = { ...marker, abstractStr: '合计', borrow: body.periodNumber === '2026-08' ? 0 : scenario === 'analysis-rejected' ? 121 : 120, loan: 0 }
      return Response.json({ result: 100, data: body.periodNumber === '2026-09' && body.page === 1 ? [marker, { ...row, loan: undefined }, total] : [total] })
    }
    const body = JSON.parse(init.body) as { page: number }
    expect(body).toMatchObject({ accountName: '日记账测试账套', periodNumber: '2026-09', dateStart: '2026-09-01', dateEnd: '2026-09-30',
      pageSize: scenario.endsWith('export') ? 100 : 20,
      ...scenario === 'boundary-export' ? { dateStart: '2026-09-08', dateEnd: '2026-09-08', subjectId: 174553 } : {},
      ...scenario.startsWith('bank-') ? { subjectId: 174554 } : {} })
    if (scenario.endsWith('export')) {
      expect(body.page).toBeGreaterThanOrEqual(1)
      expect(body.page).toBeLessThanOrEqual(2)
    } else {
      expect(body.page).toBe(1)
    }
    if (scenario === 'failure') throw new TypeError('private-network snapshot-secret', {
      cause: Object.assign(new Error('private-network snapshot-secret'), { code: 'ECONNRESET' }),
    })
    if (scenario === 'bank-empty') return Response.json({ result: 100, data: [] })
    if (scenario === 'boundary-export') return Response.json({ result: 100, data: [
      { ...marker, balance: 100, baseBalance: 100 }, { ...marker, abstractStr: '合计', balance: 100, baseBalance: 100 },
    ] })
    if (scenario === 'export' && body.page === 2) return Response.json({ result: 100, data: [
      { ...marker, abstractStr: '合计', borrow: '120.00', loan: 0, balance: 120 },
    ] })
    return Response.json({ result: 100, data: scenario === 'empty'
      ? [marker, { ...marker, abstractStr: '合计' }]
      : [marker, row, { ...marker, abstractStr: '合计', borrow: '120.00', loan: 0, balance: 120 }] })
  }))
  try {
    const ctx = scaffold.ctx
    const workspacePath = join(scaffold.workspaceCwd, 'journal-client')
    await mkdir(workspacePath)
    const created = await ctx.xiaojingFinanceDomain.create({ expectedRevision: 0, workspacePath,
      client: { legalName: '日记账测试企业', shortName: '日记账测试', taxpayerType: 'general-vat', registeredRegion: '上海', accountingStandard: 'enterprise', chartMappings: [], externalSystemRefs: [],
        financeSystem: { system: 'youcheng', environment: 'test', accountCode: '35601', appKey: 'snapshot-key' } },
      credentialInput: { youchengAppSecret: 'snapshot-secret' },
    })
    const adapter = new JournalAdapter(scenario)
    ctx.effect(() => ctx.llm.registerAdapter(['journal-test'], adapter))
    const handle = await ctx.agents.create({ sessionId: SessionId('finance-journal-chat'), meta: { cwd: workspacePath, agentPreset: 'finance' },
      agentOptions: { provider: 'journal-test', model: 'journal-test' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'finance').then(() => undefined),
    })
    try {
      const workspace = await ctx.workspaceRegistry.resolveByPath(workspacePath)
      if (workspace === undefined) throw new Error('Missing workspace')
      await workspace.attachSession(handle.agent.session.id)
      await ctx.xiaojingFinanceDomain.stage(handle.agent, { mode: 'client', clientId: created.client.id })
      const before = await readFile(join(scaffold.harnessHome, 'finance/clients-v1.json'), 'utf8')
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: scenario === 'export'
        ? '导出2026年9月全部日记账，保留范围说明。'
        : scenario.startsWith('analysis-') ? '比较账户174553的2026年9月和8月收支，核对分页和接口合计，成功后导出Excel，失败不要出文件。'
          : scenario === 'boundary-export' ? '看看2026年9月8日库存现金174553当天流水和结余，导出Excel，不把缺失数值当零。'
            : scenario.startsWith('bank-') ? '只查已确认的银行账户174554，2026年9月第一页。' : '查查2026年9月现金进出流水，只查询。' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      expect(adapter.calls).toBe(2)
      const events = handle.agent.session.snapshotEvents()
      expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual(['finance_journals'])
      const results = events.filter(event => event.type === 'tool/result').map(event => event.data.message.content)
      expect(JSON.stringify(results)).not.toMatch(/snapshot-key|snapshot-secret|snapshot-token/)
      expect(await readFile(join(scaffold.harnessHome, 'finance/clients-v1.json'), 'utf8')).toBe(before)
      const pagePaths = ['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson',
        ...scenario.startsWith('bank-') || scenario === 'boundary-export' || scenario.startsWith('analysis-') ? ['/finance/cashjournal/getAccountList.rjson'] : [], '/finance/cashjournal/getListPage.rjson']
      expect(paths).toEqual([...Array.from({ length: scenario === 'analysis-export' ? 3
        : scenario === 'analysis-rejected' || scenario === 'export' ? 2 : 1 }, () => pagePaths).flat(),
      ...scenario === 'failure' ? ['/finance/cashjournal/getListPage.rjson'] : []])
      if (scenario === 'analysis-rejected') {
        expect(events.some(event => event.type === 'finance/file-published')).toBe(false)
        expect(JSON.stringify(results)).toContain('与接口合计不一致')
      }
      if (scenario === 'bank-mismatch') {
        expect(JSON.stringify(results)).toContain('财务操作未完成')
        expect(JSON.stringify(results)).not.toContain('库存现金')
        expect(events.some(event => event.type === 'finance/file-published')).toBe(false)
      }
      let resultSnapshot = JSON.stringify(results, null, 2)
      if (scenario.endsWith('export')) {
        const published = events.filter(event => event.type === 'finance/file-published')
        expect(published).toHaveLength(1)
        const file = published[0]!.data.file
        const bytes = await readFile(file.path)
        expect(bytes.subarray(0, 2).toString()).toBe('PK')
        expect(bytes.length).toBe(file.size)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
        const blocks = results.flat().filter(block => block.type === 'tool-result').flatMap(block => block.content)
        const text = blocks.find(block => block.type === 'text')
        if (text?.type !== 'text') throw new Error('Missing page export receipt')
        const receipt = JSON.parse(text.text) as {
          accountName: string
          month: string
          dateStart: string
          dateEnd: string
          baselineMonth?: string
          recordCount: number
          exportFile: { path: string; name: string }
        }
        expect(receipt.exportFile).toEqual({ path: file.path, name: file.name })
        resultSnapshot = JSON.stringify({ ...receipt, exportFile: { publishedXlsx: true } }, null, 2)
      }
      await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-journals/${scenario}-result.expected.md`, import.meta.url)), resultSnapshot, webSnapshotMode())
      const page = await browser.newPage({ locale: 'zh-CN' })
      await page.addInitScript((sessionId) => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId })) }, handle.agent.session.id)
      await page.goto(scaffold.authenticatedUrl)
      const selector = '[data-chat-call-id="journal-query"]'
      const card = await revealToolCallCard(page, selector)
      if (scenario === 'boundary-export') {
        expect(await card.textContent()).toContain('流水：0 笔')
        expect(await card.textContent()).toContain('导出文件：')
        expect(await card.textContent()).not.toMatch(/首个空业务页|币种未提供|coverage|pageSize|接口/)
      }
      await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-journals/${scenario}-card.expected.md`, import.meta.url)), await captureStableAria(page, selector, scaffold.workspaceCwd), webSnapshotMode())
      const standard = await ctx.agents.create({ sessionId: SessionId('journal-standard'), setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined) })
      try { expect(ctx.tools.schemas(standard.agent).some(tool => tool.name === 'finance_journals')).toBe(false) }
      finally { await standard.dispose() }
    } finally { await handle.dispose() }
  } finally { vi.unstubAllGlobals(); await browser.close(); await scaffold.close() }
}, 90_000)
