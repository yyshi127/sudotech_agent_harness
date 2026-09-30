/** Real Finance composition and confirmation UI; public API fixtures cannot perform external writes. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import { ToolCallId, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-xiaojing-finance-domain'
import type {} from '@deepseek-ai/dsh-tools'
import { OpenItemRecords, type PreparedOpenItemId } from '../../../packages/xiaojing/xiaojing-finance-domain/src/open-item-records.ts'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, revealToolCallCard, webClientProfile, webSnapshotMode } from './scaffold.ts'
import { financePresetDefinition } from './xiaojing-agent-presets.ts'

class OpenItemAdapter extends LlmAdapter {
  calls = 0
  preparedId = ''
  constructor(readonly scenario: 'receivable' | 'payable' | 'lost') { super() }
  get direction() { return this.scenario === 'payable' ? 'payable' : 'receivable' }
  get query() { return { direction: this.direction, periodStart: '2022-01', periodEnd: '2022-01', page: 1, pageSize: 100 } }
  get proposal() {
    return { direction: this.direction, date: '2022-01-09', amount: '0.05', summary: '往来闭环测试', keeperName: '测试员',
      accountId: this.direction === 'payable' ? '174624' : '174626', categoryId: this.direction === 'payable' ? '578260' : '578250',
      auxiliaryCategoryCode: this.direction === 'payable' ? '02' : '01', auxiliaryItemId: '191501', accountReferenceQuery: this.query }
  }
  get revised() { return { ...this.proposal, amount: '0.06' } }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.calls >= 2 && this.preparedId === '') {
      const block = options.messages.flatMap(message => message.content)
        .find(item => item.type === 'tool-result' && item.toolCallId === 'open-item-2')
      const text = block?.type === 'tool-result' ? block.content.find(item => item.type === 'text') : undefined
      if (text?.type !== 'text') throw new Error('Missing open-item preview')
      const value: unknown = JSON.parse(text.text)
      if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string') {
        throw new Error('Missing persisted open-item ID')
      }
      this.preparedId = value.id
    }
    const requests = [
      { name: 'finance_open_item_accounts', args: this.query },
      { name: 'finance_prepare_open_item', args: { action: 'prepare', input: this.proposal } },
      { name: 'finance_prepare_open_item', args: { action: 'revise', id: this.preparedId, version: 1, input: this.revised } },
      { name: 'finance_create_open_item', args: { id: this.preparedId, version: 1 } },
      { name: 'finance_create_open_item', args: { id: this.preparedId, version: 2 } },
      { name: 'finance_create_open_item', args: { id: this.preparedId, version: 2 } },
      { name: 'finance_prepare_open_item', args: { action: 'inspect', id: this.preparedId } },
      { name: 'finance_create_open_item', args: { id: this.preparedId, version: 2 } },
    ]
    const request = requests[this.calls++]
    if (request !== undefined) {
      const id = ToolCallId(`open-item-${this.calls}`)
      const args = JSON.stringify(request.args)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: request.name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: request.name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = this.scenario === 'lost' ? '发送结果未知，保留原记录，不重发。' : '往来记录已核验；不代表实际收付款或核销。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it.skipIf(webClientProfile() !== 'xiaojing')('confirms exact open-item revisions in the real UI and retains single-send outcomes', async () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  const scaffold = await launchWebScaffold({ agentPresets: { default: 'standard', definitions: [financePresetDefinition()] } })
  const browser = await chromium.launch()
  const originalFetch = globalThis.fetch
  const outputs = []
  try {
    const ctx = scaffold.ctx
    const workspacePath = join(scaffold.workspaceCwd, 'open-item-client')
    await mkdir(workspacePath)
    const created = await ctx.xiaojingFinanceDomain.create({ expectedRevision: 0, workspacePath,
      client: { legalName: '往来测试企业', shortName: '往来测试', taxpayerType: 'general-vat', registeredRegion: '上海', accountingStandard: 'enterprise',
        chartMappings: [], externalSystemRefs: [],
        financeSystem: { system: 'youcheng', environment: 'test', accountCode: '35616', appKey: 'snapshot-key' } },
      credentialInput: { youchengAppSecret: 'snapshot-secret' },
    })
    for (const scenario of ['receivable', 'payable', 'lost'] as const) {
      const adapter = new OpenItemAdapter(scenario)
      const payable = adapter.direction === 'payable'
      const provider = `open-item-${scenario}-test`
      ctx.effect(() => ctx.llm.registerAdapter([provider], adapter))
      const handle = await ctx.agents.create({ sessionId: SessionId(`finance-open-item-${scenario}`),
        meta: { cwd: workspacePath, agentPreset: 'finance' }, agentOptions: { provider, model: provider },
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'finance').then(() => undefined),
      })
      const records = new OpenItemRecords(join(scaffold.harnessHome, 'finance/open-item-preparations'),
        `${created.client.id}/${handle.agent.session.id}`, 131072)
      let writes = 0
      let approvals = 0
      const row = (id: number) => ({ id, setOfBooksId: 35616, date: adapter.revised.date, abstractStr: adapter.revised.summary,
        money: '0.06', balance: '0.06', currencyCode: 'RMB', baseCurrencyCode: 'RMB', subjectCode: '',
        subjectName: payable ? '应付账款' : '应收账款', subjectId: Number(adapter.revised.accountId), accountStatus: 0, accountWb: false,
        auxiliaryItemIds: '191501', auxiliaryItemName: '往来测试', thisMoney: 0, badMoney: 0, hedgeMoney: 0, returnMoney: 0,
        initialBalance: false, isFinish: false, categoryName: payable ? '支-其他支出' : '收-其他收入',
        categoryId: Number(adapter.revised.categoryId), keeperName: '测试员', remark: '', attachList: [], certificateWordAndCode: '', orderCode: '' })
      vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.origin !== 'https://cwdata.yiqiyun.com') return originalFetch(input, init)
        if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'snapshot-token' })
        if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35616', sobName: '往来演示账套' }] })
        if (url.pathname.includes('getCategoryList')) return Response.json({ result: 100, data: [{ id: Number(adapter.revised.categoryId),
          code: '01', name: payable ? '其他支出' : '其他收入', type: payable ? 1 : 0 }] })
        if (url.pathname.includes('queryAuxiliaryCategoryList')) return Response.json({ result: 100,
          data: [{ id: 101, categoryCode: adapter.revised.auxiliaryCategoryCode, categoryName: payable ? '供应商' : '客户' }] })
        if (url.pathname.includes('queryAuxiliaryItemList')) return Response.json({ result: 100,
          data: [{ id: 191501, itemCode: '03', itemName: '往来测试', categoryId: 101 }] })
        if (url.pathname === '/finance/cashjournal/getCashierList') return Response.json({ result: 100,
          data: { count: writes === 0 ? 1 : 2, list: [row(70000), ...writes === 0 ? [] : [row(72595)]] } })
        expect(url.pathname).toBe('/finance/cashier/account/management/add.rjson')
        expect(approvals).toBe(2)
        expect(writes).toBe(0)
        expect(await records.read(adapter.preparedId as PreparedOpenItemId)).toMatchObject({ phase: 'outcome-unknown', version: 2 })
        if (typeof init?.body !== 'string') throw new Error('Missing open-item JSON')
        expect(JSON.parse(init.body)).toMatchObject({ booksName: '往来演示账套', money: 0.06, direction: payable,
          auxiliaryItemNames: `${payable ? '供应商' : '客户'}:往来测试`, accountId: Number(adapter.revised.accountId) })
        writes++
        if (scenario === 'lost') throw new TypeError('Lost response', { cause: { code: 'ECONNRESET' } })
        return Response.json({ result: 100, data: '72595' })
      }))
      const page = await browser.newPage({ locale: 'zh-CN' })
      try {
        const workspace = await ctx.workspaceRegistry.resolveByPath(workspacePath)
        if (workspace === undefined) throw new Error('Missing workspace')
        await workspace.attachSession(handle.agent.session.id)
        await ctx.xiaojingFinanceDomain.stage(handle.agent, { mode: 'client', clientId: created.client.id })
        await page.addInitScript((sessionId) => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId })) }, handle.agent.session.id)
        await page.goto(scaffold.authenticatedUrl)
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: payable
          ? '记一笔欠供应商五分钱，改为六分再确认，不要付款。' : '记一笔客户欠款五分钱，改为六分再确认，不要收款。' }], source: { kind: 'user' } }))
        const panel = page.locator('[data-approval-key]')
        const normalize = (text: string) => text.replaceAll(adapter.preparedId, '<prepared-id>').replaceAll(created.client.id, '<client-id>')
        let previousKey: string | null = null
        for (const label of [/^(拒绝|Reject)$/, /^(允许一次|Allow once)$/]) {
          await panel.waitFor()
          await expect.poll(() => panel.getAttribute('data-approval-key')).not.toBe(previousKey)
          previousKey = await panel.getAttribute('data-approval-key')
          const text = await panel.textContent()
          for (const value of ['往来演示账套', '0.06', payable ? '应付' : '应收',
            payable ? '供应商：往来测试' : '客户：往来测试', payable ? '应付账款' : '应收账款']) expect(text).toContain(value)
          expect(text).not.toMatch(/"version"|70000|不是完整账户目录|prepared-id|snapshot-key|snapshot-secret/)
          expect(writes).toBe(0)
          expect(await records.read(adapter.preparedId as PreparedOpenItemId)).toMatchObject({ phase: 'prepared', version: 2 })
          if (approvals === 0) await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-open-item-preparation/${scenario}-approval.expected.md`, import.meta.url)),
            normalize(await captureStableAria(page, '[data-approval-key]', scaffold.workspaceCwd)), webSnapshotMode())
          approvals++
          await panel.getByRole('button', { name: label }).click()
          await expect.poll(() => handle.agent.session.snapshotEvents().filter(event => event.type === 'approval/decided').length).toBe(approvals)
        }
        await handle.agent.whenIdle()
        expect(adapter.calls).toBe(9)
        expect(writes).toBe(1)
        const results = handle.agent.session.snapshotEvents().filter(event => event.type === 'tool/result').map(event => event.data.message.content)
        expect(results).toHaveLength(8)
        expect(JSON.stringify(results[3])).toContain('版本')
        expect(JSON.stringify(results[4])).toContain('未获得')
        expect(JSON.stringify(results[7])).toContain('发送记录')
        const durable = await new OpenItemRecords(join(scaffold.harnessHome, 'finance/open-item-preparations'),
          `${created.client.id}/${handle.agent.session.id}`, 131072).read(adapter.preparedId as PreparedOpenItemId)
        expect(durable).toMatchObject({ phase: scenario === 'lost' ? 'outcome-unknown' : 'accepted', version: 2 })
        const text = results[5]?.flatMap(block => block.type === 'tool-result' ? block.content : []).find(block => block.type === 'text')
        if (text?.type !== 'text') throw new Error('Missing open-item outcome')
        expect(JSON.parse(text.text)).toMatchObject({ complete: scenario !== 'lost' })
        expect(JSON.stringify(results)).not.toMatch(/snapshot-key|snapshot-secret|snapshot-token|configurationDigest/)
        const selector = '[data-chat-call-id="open-item-6"]'
        const card = page.locator(selector)
        await revealToolCallCard(page, selector)
        await expect.poll(() => card.textContent()).toContain(scenario === 'lost' ? '结果待确认' : '已完成并核对')
        await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-open-item-preparation/${scenario}-result-card.expected.md`, import.meta.url)),
          normalize(await captureStableAria(page, selector, scaffold.workspaceCwd)), webSnapshotMode())
        outputs.push({ scenario, writes, results: JSON.parse(normalize(JSON.stringify(results))) as unknown })
      } finally { await page.close(); await handle.dispose() }
    }
    await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-open-item-preparation/results.expected.md', import.meta.url)),
      JSON.stringify(outputs, null, 2), webSnapshotMode())
    const standard = await ctx.agents.create({ sessionId: SessionId('open-item-standard'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined) })
    try { expect(ctx.tools.schemas(standard.agent).some(tool =>
      ['finance_open_item_accounts', 'finance_prepare_open_item', 'finance_create_open_item'].includes(tool.name))).toBe(false) }
    finally { await standard.dispose() }
  } finally {
    vi.unstubAllGlobals()
    await browser.close()
    await scaffold.close()
    vi.unstubAllEnvs()
  }
}, 120_000)
