/** Shipped Finance tools, real approval UI and durable journal recovery with a keyless vendor fixture. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import { ToolCallId, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-xiaojing-finance-domain'
import type {} from '@deepseek-ai/dsh-tools'
import { JournalRecords, type PreparedJournalId } from '../../../packages/xiaojing/xiaojing-finance-domain/src/journal-records.ts'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, revealToolCallCard, webClientProfile, webSnapshotMode } from './scaffold.ts'

class JournalAdapter extends LlmAdapter {
  calls = 0
  preparedId = ''
  constructor(readonly scenario: 'income' | 'expense' | 'currency-change') { super() }
  get direction() { return this.scenario === 'expense' ? 'expense' : 'income' }
  get proposal() {
    return { cashAccountId: '174622', date: '2022-01-01', direction: this.direction,
      amount: this.direction === 'income' ? '0.11' : '0.07', summary: '日记账闭环测试', keeperName: '小兢测试',
      categoryId: this.direction === 'income' ? '578250' : '578260' }
  }
  get revised() { return { ...this.proposal, amount: this.direction === 'income' ? '0.12' : '0.08' } }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.calls > 0 && this.preparedId === '') {
      const result = options.messages.flatMap(message => message.content)
        .find(block => block.type === 'tool-result' && block.toolCallId === `${this.direction}-1`)
      const text = result?.type === 'tool-result' ? result.content.find(block => block.type === 'text') : undefined
      if (text?.type !== 'text') throw new Error('Missing actual journal preview')
      const value: unknown = JSON.parse(text.text)
      if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string') {
        throw new Error('Missing actual local journal ID')
      }
      this.preparedId = value.id
    }
    const requests = [
      { name: 'finance_prepare_journal', args: { action: 'prepare', input: this.proposal } },
      { name: 'finance_prepare_journal', args: { action: 'revise', id: this.preparedId, version: 1, input: this.revised } },
      { name: 'finance_create_journal', args: { id: this.preparedId, version: 1 } },
      { name: 'finance_create_journal', args: { id: this.preparedId, version: 2 } },
      { name: 'finance_create_journal', args: { id: this.preparedId, version: 2 } },
      { name: 'finance_prepare_journal', args: { action: 'inspect', id: this.preparedId } },
      { name: 'finance_create_journal', args: { id: this.preparedId, version: 2 } },
    ]
    const request = this.calls < (this.scenario === 'currency-change' ? 6 : requests.length) ? requests[this.calls] : undefined
    this.calls++
    if (request !== undefined) {
      const id = ToolCallId(`${this.direction}-${this.calls}`)
      const args = JSON.stringify(request.args)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: request.name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: request.name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = this.scenario === 'currency-change'
        ? '账户资料已变化，本次未发送；请重新预览后确认。'
        : '已保留原发送记录；未知结果不重发。日记账记载不代表实际收付款。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it.skipIf(webClientProfile() !== 'xiaojing')('requires the exact journal revision in the real UI and never resends accepted or lost results', async () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  const scaffold = await launchWebScaffold({ agentPresets: { default: 'standard', roots: [
    { path: fileURLToPath(new URL('../../cli/config/agent-presets', import.meta.url)), trust: 'system' },
    { path: fileURLToPath(new URL('../../cli/config/xiaojing-agent-presets', import.meta.url)), trust: 'system' },
  ] } })
  const browser = await chromium.launch()
  const originalFetch = globalThis.fetch
  const outputs = []
  try {
    const ctx = scaffold.ctx
    const workspacePath = join(scaffold.workspaceCwd, 'journal-client')
    await mkdir(workspacePath)
    const created = await ctx.xiaojingFinanceDomain.create({ expectedRevision: 0, workspacePath,
      client: { legalName: '日记账测试企业', shortName: '日记账测试', taxpayerType: 'general-vat', registeredRegion: '上海', accountingStandard: 'enterprise',
        chartMappings: [], externalSystemRefs: [],
        financeSystem: { system: 'youcheng', environment: 'test', accountCode: '35616', appKey: 'snapshot-key' } },
      credentialInput: { youchengAppSecret: 'snapshot-secret' },
    })
    for (const scenario of ['income', 'expense', 'currency-change'] as const) {
      const adapter = new JournalAdapter(scenario)
      const direction = adapter.direction
      const provider = `journal-${scenario}-test`
      ctx.effect(() => ctx.llm.registerAdapter([provider], adapter))
      const handle = await ctx.agents.create({ sessionId: SessionId(`finance-journal-${scenario}`),
        meta: { cwd: workspacePath, agentPreset: 'finance' }, agentOptions: { provider, model: provider },
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'finance').then(() => undefined),
      })
      const records = new JournalRecords(join(scaffold.harnessHome, 'finance/journal-preparations'),
        `${created.client.id}/${handle.agent.session.id}`, 131072)
      let writes = 0
      let approvals = 0
      let currencyId = '120455'
      vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.origin !== 'https://cwdata.yiqiyun.com') return originalFetch(input, init)
        if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'snapshot-token' })
        if (url.pathname === '/finance/auxiliary/queryAccountList.rjson') return Response.json({ result: 100,
          data: [{ id: '35616', sobName: '日记账演示账套' }] })
        if (url.pathname === '/finance/cashjournal/getAccountList.rjson') return Response.json({ result: 100,
          data: [{ accountId: 174622, accountName: '库存现金', subjectCode: '1001', status: 0, currencyId, type: 1, direction: 0 }] })
        if (url.pathname === '/finance/cashjournal/getCategoryList.rjson') return Response.json({ result: 100, data: [
          { id: 578250, code: '06', name: '其他收入', type: 0 }, { id: 578260, code: '16', name: '其他支出', type: 1 },
        ] })
        if (url.pathname === '/finance/cashjournal/getListPage.rjson') return Response.json({ result: 100, data: writes === 0 ? [] : [{
          id: 141053, date: adapter.revised.date, abstractStr: adapter.revised.summary, keeperName: adapter.revised.keeperName,
          subjectId: 174622, accountCode: '', accountName: '', subjectName: '库存现金', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
          borrow: direction === 'income' ? 0.12 : null, loan: direction === 'expense' ? 0.08 : null,
          categoryId: Number(adapter.revised.categoryId), categoryName: direction === 'income' ? '收-其他收入' : '支-其他支出',
          preId: 0, reviewStatus: 0, reviewUser: '', reviewUserId: '', certificateWordAndCode: '', cashManagementId: '',
          auxiliaryItemIds: '', orderCode: '', relationOrderCodeList: [], attachList: [],
        }] })
        expect(url.pathname).toBe('/finance/cashjournal/add.rjson')
        expect(approvals).toBe(2)
        expect(writes).toBe(0)
        expect(await records.read(adapter.preparedId as PreparedJournalId)).toMatchObject({ phase: 'outcome-unknown', version: 2 })
        if (typeof init?.body !== 'string') throw new Error('Missing journal JSON')
        expect(JSON.parse(init.body)).toMatchObject({ subjectId: 174622, accountName: '日记账演示账套',
          borrow: direction === 'income' ? 0.12 : null, loan: direction === 'expense' ? 0.08 : null, preId: 0 })
        writes++
        if (direction === 'expense') throw new TypeError('Lost response', { cause: { code: 'ECONNRESET' } })
        return Response.json({ result: 100, data: '141053' })
      }))
      const page = await browser.newPage({ locale: 'zh-CN' })
      try {
        const workspace = await ctx.workspaceRegistry.resolveByPath(workspacePath)
        if (workspace === undefined) throw new Error('Missing workspace')
        await workspace.attachSession(handle.agent.session.id)
        await ctx.xiaojingFinanceDomain.stage(handle.agent, { mode: 'client', clientId: created.client.id })
        await page.addInitScript((sessionId) => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId })) }, handle.agent.session.id)
        await page.goto(scaffold.authenticatedUrl)
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: direction === 'income'
          ? '帮我记一笔现金收入一毛一，改成一毛二再确认，不要生成凭证。' : '现金花了七分，改成八分再确认，不要实际付款。' }], source: { kind: 'user' } }))
        const panel = page.locator('[data-approval-key]')
        const normalize = (text: string) => text.replaceAll(adapter.preparedId, '<prepared-id>').replaceAll(created.client.id, '<client-id>')
        let previousKey: string | null = null
        for (const label of [/^(拒绝|Reject)$/, /^(允许一次|Allow once)$/]) {
          await panel.waitFor()
          await expect.poll(() => panel.getAttribute('data-approval-key')).not.toBe(previousKey)
          previousKey = await panel.getAttribute('data-approval-key')
          const text = await panel.textContent()
          for (const value of ['日记账演示账套', adapter.revised.amount,
            direction === 'income' ? '收入' : '支出', '库存现金', '日记账闭环测试']) expect(text).toContain(value)
          expect(text).not.toMatch(/"version"|prepared-id|snapshot-key|snapshot-secret/)
          expect(writes).toBe(0)
          expect(await records.read(adapter.preparedId as PreparedJournalId)).toMatchObject({ phase: 'prepared', version: 2 })
          if (approvals === 0) await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-journal-preparation/${scenario}-approval.expected.md`, import.meta.url)),
            normalize(await captureStableAria(page, '[data-approval-key]', scaffold.workspaceCwd)), webSnapshotMode())
          if (scenario === 'currency-change' && approvals === 1) currencyId = '120456'
          approvals++
          await panel.getByRole('button', { name: label }).click()
          await expect.poll(() => handle.agent.session.snapshotEvents().filter(event => event.type === 'approval/decided').length).toBe(approvals)
        }
        await handle.agent.whenIdle()
        expect(adapter.calls).toBe(scenario === 'currency-change' ? 7 : 8)
        expect(writes).toBe(scenario === 'currency-change' ? 0 : 1)
        const results = handle.agent.session.snapshotEvents().filter(event => event.type === 'tool/result').map(event => event.data.message.content)
        expect(results).toHaveLength(scenario === 'currency-change' ? 6 : 7)
        expect(JSON.stringify(results[2])).toContain('版本')
        expect(JSON.stringify(results[3])).toContain('未获得')
        if (scenario === 'currency-change') expect(JSON.stringify(results[4])).toContain('资料或新增位置已变化')
        else expect(JSON.stringify(results[6])).toContain('发送记录')
        const durable = await new JournalRecords(join(scaffold.harnessHome, 'finance/journal-preparations'),
          `${created.client.id}/${handle.agent.session.id}`, 131072).read(adapter.preparedId as PreparedJournalId)
        expect(durable).toMatchObject({ phase: scenario === 'currency-change' ? 'prepared'
          : direction === 'income' ? 'accepted' : 'outcome-unknown', version: 2 })
        const text = results[4]?.flatMap(block => block.type === 'tool-result' ? block.content : []).find(block => block.type === 'text')
        if (text?.type !== 'text') throw new Error('Missing journal outcome')
        if (scenario !== 'currency-change') expect(JSON.parse(text.text), text.text).toMatchObject({ complete: direction === 'income' })
        expect(JSON.stringify(results)).not.toMatch(/snapshot-key|snapshot-secret|snapshot-token|configurationDigest/)
        const selector = `[data-chat-call-id="${direction}-5"]`
        const card = page.locator(selector)
        await revealToolCallCard(page, selector)
        await expect.poll(() => card.textContent()).toContain(scenario === 'currency-change'
          ? '资料或新增位置已变化'
          : scenario === 'expense' ? '结果待确认' : '已完成并核对')
        await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-journal-preparation/${scenario}-result-card.expected.md`, import.meta.url)),
          normalize(await captureStableAria(page, selector, scaffold.workspaceCwd)), webSnapshotMode())
        outputs.push({ scenario, direction, writes, results: JSON.parse(normalize(JSON.stringify(results))) as unknown })
      } finally { await page.close(); await handle.dispose() }
    }
    await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-journal-preparation/results.expected.md', import.meta.url)),
      JSON.stringify(outputs, null, 2), webSnapshotMode())
    const standard = await ctx.agents.create({ sessionId: SessionId('journal-standard'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined) })
    try { expect(ctx.tools.schemas(standard.agent).some(tool => ['finance_prepare_journal', 'finance_create_journal'].includes(tool.name))).toBe(false) }
    finally { await standard.dispose() }
  } finally {
    vi.unstubAllGlobals()
    await browser.close()
    await scaffold.close()
    vi.unstubAllEnvs()
  }
}, 120_000)
