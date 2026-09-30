/** Shipped Finance composition, durable balance results and rendered cards; only network/model are mocked. */
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

const row = {
  subjectCode: '1001', subjectName: '库存现金', subjectLevel: 1, hasChild: false,
  periodInitialBorrow: '1,000.00', periodInitialLoan: '', periodInitialBalance: '',
  periodThisBorrow: '25.50', periodThisLoan: '173.28', periodThisBalance: '-147.78',
  periodYearBorrow: '25.50', periodYearLoan: '173.28', periodYearBalance: '-147.78',
  periodFinalBorrow: '852.22', periodFinalLoan: '', periodFinalBalance: '',
}
class BalanceAdapter extends LlmAdapter {
  calls = 0
  constructor(readonly scenario: string) { super() }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    const systemText = options.messages.filter(message => message.role === 'system')
      .flatMap(message => message.content)
      .filter(block => block.type === 'text')
      .map(block => block.text).join('\n')
    const evidenceRules = systemText.match(/财务查询证据规则：\n(?:- [^\n]+\n?){4}/)?.[0]?.trim()
    expect(evidenceRules).toContain('名称相同不证明账户与科目对应')
    expect(evidenceRules).toContain('不能判为异常，也不能判为正常')
    expect(evidenceRules).toContain('不能解释成“即贷方余额”')
    expect(evidenceRules).toContain('不代表所有期初余额缺失')
    if (this.scenario === 'report' && this.calls === 1) {
      await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-balances/read-evidence.expected.md', import.meta.url)), evidenceRules!, webSnapshotMode())
    }
    if (this.scenario === 'analysis' && this.calls === 1) {
      const id = ToolCallId('balance-analysis-skill')
      const args = JSON.stringify({ name: 'finance-data-analysis' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'skill', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'skill', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else if (this.calls === (this.scenario === 'analysis' ? 2 : 1)) {
      if (this.scenario === 'analysis') {
        const loaded = JSON.stringify(options.messages)
        expect(loaded).toContain('Separate quoted source values from new calculations')
        expect(loaded).toContain('do not reconstruct balances or introduce arithmetic merely to explain them')
        expect(loaded).toContain('without repeatedly offering actions the user declined')
        expect(loaded).toContain('verify that their account mapping, currency, period basis, population and accounting status are comparable')
        expect(loaded).toContain('do not declare a discrepancy, an inaccurate source, missing synchronization or unposted transactions')
      }
      expect(JSON.stringify(options)).toContain('不把父子科目和汇总重复相加')
      expect(JSON.stringify(options)).toContain('发生额留空只能说明未提供')
      expect(JSON.stringify(options)).toContain('空值统一写“未提供”，包括科目表、接口汇总、标题和结论')
      expect(JSON.stringify(options)).toContain('没有凭证关联证据，不从现金银行金额相等或相反推断划转')
      expect(JSON.stringify(options)).toContain('直接引用返回的合计，不添加自行展开的算式')
      const id = ToolCallId('balance-query')
      const args = JSON.stringify({ month: '2026-09', ...this.scenario === 'root' ? { subjectLevel: 1 } : {}, ...this.scenario === 'export' ? { exportExcel: true } : {}, ...this.scenario === 'level' ? { subjectLevel: 2 } : {}, ...this.scenario === 'range' ? { subjectLevel: 1, subjectLevelEnd: 4 } : {},
        ...this.scenario === 'compare' ? { analyze: true, compareMonth: '2026-08', monthEnd: '2026-09', subjectLevel: 1, subjectLevelEnd: 1, exportExcel: true } : {},
        ...this.scenario === 'compare-invalid' ? { analyze: true, compareMonth: '2026-08', monthEnd: '2026-10', subjectLevel: 1, exportExcel: true } : {} })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'finance_balances', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'finance_balances', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const messages = JSON.stringify(options.messages)
      expect(messages).not.toMatch(/snapshot-secret|snapshot-token|snapshot-key|private-network/)
      expect(messages).toContain(this.scenario === 'compare-invalid' ? '余额分析须指定单个'
        : this.scenario === 'failure' ? '财务操作未完成'
          : this.scenario === 'export' || this.scenario === 'compare' ? '"exportFile"' : 'unverified')
      if (!['failure', 'compare-invalid', 'export', 'compare'].includes(this.scenario)) expect(messages).toContain('期初期末相等也不能证明期间没有发生')
      if (this.scenario === 'report') {
        expect(messages).toContain('1000.00')
        expect(messages).toContain('852.22')
        expect(messages).not.toContain('1,000.00')
      }
      const text = this.scenario === 'failure' ? '余额查询失败，不能判断没有余额。'
        : this.scenario === 'compare-invalid' ? '跨期比较不能与多月累计范围混用，未查询、未生成文件。'
          : this.scenario === 'compare' ? '2026年9月与8月的一级科目余额比较已导出，共1个科目。'
            : this.scenario === 'export' ? '2026年9月科目余额已导出，共1个科目。'
              : this.scenario === 'empty' ? '本次没有科目行，不能据此判断账套余额为零。'
                : this.scenario === 'level' ? '本次仅查询二级科目，返回 100101；不代表查询了全部层级。'
                  : '库存现金期初借方为 1000.00，期末借方为 852.22。本期合计借方和贷方均为 198.78；未提供的汇总字段仍为未提供，不改写借贷列、不推断划转。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it.skipIf(webClientProfile() !== 'xiaojing').each(['report', 'empty', 'failure', 'export', 'level', 'range', 'analysis', 'retry', 'compare', 'compare-invalid', 'root'])('queries balances through the real Finance preset: %s', async (scenario) => {
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
    if (scenario === 'retry' && paths.length === 1) throw new TypeError('private-network snapshot-secret', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'snapshot-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35601', sobName: '余额测试账套' }] })
    expect(url.pathname).toBe('/finance/subject/getList.rjson')
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body')
    const month = scenario === 'compare' && paths.filter(path => path === url.pathname).length === 2 ? '2026-08' : '2026-09'
    const childRequest = scenario === 'range' && paths.filter(path => path === url.pathname).length === 2
    expect(JSON.parse(init.body)).toEqual({ setOfBooksId: 35601, periodNumber: month, periodNumber2: month, pageNo: 1, pageSize: 1000, isNeedPage: scenario !== 'range' && scenario !== 'compare',
      ...scenario === 'level' ? { subjectLevelStart: 2, subjectLevelEnd: 2 } : {},
      ...scenario === 'root' ? { subjectLevelStart: 1, subjectLevelEnd: 1 } : {},
      ...scenario === 'range' ? { subjectLevelStart: childRequest ? 2 : 1, subjectLevelEnd: childRequest ? 2 : 1, parentSubjectId: childRequest ? 1 : 0, currency: true, displayDisableSubject: true } : {},
      ...scenario === 'compare' ? { subjectLevelStart: 1, subjectLevelEnd: 1, parentSubjectId: 0, currency: true, displayDisableSubject: true } : {},
    })
    if (scenario === 'failure') throw new TypeError('private-network snapshot-secret')
    if (childRequest) return Response.json({ result: 100, data: { success: true, count: 0, list: [
      { ...row, subjectCode: '100101', subjectLevel: 2, subjectInfoId: 2, parentSubjectId: 1 },
    ] } })
    const subject = scenario === 'level' ? { ...row, subjectCode: '100101', subjectLevel: 2 }
      : scenario === 'range' || scenario === 'compare' || scenario === 'root' ? { ...row, subjectInfoId: 1, parentSubjectId: 0, hasChild: true } : row
    return Response.json({ result: 100, data: { success: true, count: 0, list: scenario === 'empty' ? [] : [subject,
      { ...row, subjectCode: '', subjectName: '本期合计', periodThisBorrow: '198.78', periodThisLoan: '198.78' },
    ] } })
  }))
  try {
    const ctx = scaffold.ctx
    const workspacePath = join(scaffold.workspaceCwd, 'balance-client')
    await mkdir(workspacePath)
    const created = await ctx.xiaojingFinanceDomain.create({ expectedRevision: 0, workspacePath,
      client: { legalName: '余额测试企业', shortName: '余额测试', taxpayerType: 'general-vat', registeredRegion: '上海', accountingStandard: 'enterprise', chartMappings: [], externalSystemRefs: [],
        financeSystem: { system: 'youcheng', environment: 'test', accountCode: '35601', appKey: 'snapshot-key' } },
      credentialInput: { youchengAppSecret: 'snapshot-secret' },
    })
    const adapter = new BalanceAdapter(scenario)
    ctx.effect(() => ctx.llm.registerAdapter(['balance-test'], adapter))
    const handle = await ctx.agents.create({ sessionId: SessionId('finance-balance-chat'), meta: { cwd: workspacePath, agentPreset: 'finance' },
      agentOptions: { provider: 'balance-test', model: 'balance-test' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'finance').then(() => undefined),
    })
    try {
      expect(typeof ctx.tools.get('finance_balances', handle.agent)?.presentCall).toBe('function')
      expect(typeof ctx.tools.get('finance_balances', handle.agent)?.presentResult).toBe('function')
      const workspace = await ctx.workspaceRegistry.resolveByPath(workspacePath)
      if (workspace === undefined) throw new Error('Missing workspace')
      await workspace.attachSession(handle.agent.session.id)
      await ctx.xiaojingFinanceDomain.stage(handle.agent, { mode: 'client', clientId: created.client.id })
      const before = await readFile(join(scaffold.harnessHome, 'finance/clients-v1.json'), 'utf8')
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: scenario === 'compare' ? '比较2026年9月与8月的一级科目余额并导出Excel，保留未知值和完整性限制。' : scenario === 'export' ? '导出2026年9月科目余额的接口查询结果，保留范围限制。' : scenario === 'level' ? '只查2026年9月二级科目余额。' : '看看2026年9月现金还剩多少，这个月进出多少，只查询。' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      expect(adapter.calls).toBe(scenario === 'analysis' ? 3 : 2)
      const events = handle.agent.session.snapshotEvents()
      expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual(scenario === 'analysis' ? ['skill', 'finance_balances'] : ['finance_balances'])
      const results = events.filter(event => event.type === 'tool/result').map(event => event.data.message.content)
      expect(JSON.stringify(results)).not.toMatch(/snapshot-key|snapshot-secret|snapshot-token/)
      expect(await readFile(join(scaffold.harnessHome, 'finance/clients-v1.json'), 'utf8')).toBe(before)
      if (scenario === 'compare-invalid') expect(events.filter(event => event.type === 'finance/file-published')).toHaveLength(0)
      expect(paths).toEqual(scenario === 'compare-invalid' ? [] : [...scenario === 'retry' ? ['/auth/getAccessToken.rjson'] : [], '/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson', '/finance/subject/getList.rjson',
        ...scenario === 'range' ? ['/finance/subject/getList.rjson'] : [],
        ...scenario === 'compare' ? ['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson', '/finance/subject/getList.rjson'] : []])
      let resultSnapshot = JSON.stringify(results, null, 2)
      if (scenario === 'analysis') {
        const blocks = results[0]
        const loaded = blocks?.find(block => block.type === 'text')
        if (loaded?.type !== 'text') throw new Error('Missing loaded analysis skill')
        const instructions = loaded.text.match(/<skill_instructions>\n([\s\S]*?)\n<\/skill_instructions>/)?.[1]
        expect(instructions).toContain('Separate quoted source values from new calculations')
        resultSnapshot = JSON.stringify({ skillInstructions: instructions, balanceResults: results.slice(1) }, null, 2)
      }
      if (scenario === 'export' || scenario === 'compare') {
        const published = events.filter(event => event.type === 'finance/file-published')
        expect(published).toHaveLength(1)
        const file = published[0]!.data.file
        const bytes = await readFile(file.path)
        expect(bytes.subarray(0, 2).toString()).toBe('PK')
        expect(bytes.length).toBe(file.size)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
        const blocks = results.flat()
        const text = blocks.find(block => block.type === 'text')
        if (text?.type !== 'text') throw new Error('Missing balance export receipt')
        const receipt = JSON.parse(text.text) as {
          accountName: string
          month: string
          monthEnd?: string
          compareMonth?: string
          subjectCount: number
          summaryCount?: number
          differenceCount?: number
          exportFile: { path: string; name: string }
        }
        expect(receipt.exportFile).toEqual({ path: file.path, name: file.name })
        resultSnapshot = JSON.stringify({ ...receipt, exportFile: { publishedXlsx: true } }, null, 2)
      }
      await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-balances/${scenario}-result.expected.md`, import.meta.url)), resultSnapshot, webSnapshotMode())
      const page = await browser.newPage({ locale: 'zh-CN' })
      await page.addInitScript((sessionId) => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId })) }, handle.agent.session.id)
      await page.goto(scaffold.authenticatedUrl)
      const selector = '[data-chat-call-id="balance-query"]'
      await revealToolCallCard(page, selector)
      await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-balances/${scenario}-card.expected.md`, import.meta.url)), await captureStableAria(page, selector, scaffold.workspaceCwd), webSnapshotMode())
      const standard = await ctx.agents.create({ sessionId: SessionId('balance-standard'), setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined) })
      try { expect(ctx.tools.schemas(standard.agent).some(tool => tool.name === 'finance_balances')).toBe(false) }
      finally { await standard.dispose() }
    } finally { await handle.dispose() }
  } finally { vi.unstubAllGlobals(); await browser.close(); await scaffold.close() }
}, 90_000)
