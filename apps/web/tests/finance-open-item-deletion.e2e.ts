/** Shipping Finance composition verifies AR/AP deletion previews, confirmation and scoped recovery. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import { ToolCallId, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { OpenItemDeletionRecords, type OpenItemDeletionId } from '../../../packages/xiaojing/xiaojing-finance-domain/src/open-item-deletion-records.ts'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, revealToolCallCard, webClientProfile, webSnapshotMode } from './scaffold.ts'

class DeletionPreviewAdapter extends LlmAdapter {
  calls = 0
  operationId = ''
  constructor(readonly direction: 'receivable' | 'payable', readonly openItemId: number, readonly execution = false) { super() }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.calls > 0 && this.operationId === '') {
      const result = options.messages.flatMap(message => message.content)
        .find(block => block.type === 'tool-result' && block.toolCallId === 'open-deletion-1')
      const text = result?.type === 'tool-result' ? result.content.find(block => block.type === 'text') : undefined
      if (text?.type !== 'text') throw new Error('Missing actual AR/AP deletion preview')
      const value: unknown = JSON.parse(text.text)
      if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string') {
        throw new Error('Missing actual operation ID')
      }
      this.operationId = value.id
    }
    const target = { openItemId: String(this.openItemId), direction: this.direction, periodStart: '2022-01', periodEnd: '2022-01' }
    const previews = [
      { name: 'finance_prepare_open_item_deletion', args: { action: 'prepare', ...target } },
      { name: 'finance_prepare_open_item_deletion', args: { action: 'revise', id: this.operationId, version: 1, ...target } },
      { name: 'finance_prepare_open_item_deletion', args: { action: 'revise', id: this.operationId, version: 1, ...target } },
      { name: 'finance_prepare_open_item_deletion', args: { action: 'inspect', id: this.operationId } },
    ]
    const requests = this.execution ? [previews[0]!, previews[1]!,
      { name: 'finance_delete_open_item', args: { id: this.operationId, version: 1 } },
      { name: 'finance_delete_open_item', args: { id: this.operationId, version: 2 } },
      { name: 'finance_delete_open_item', args: { id: this.operationId, version: 2 } },
      { name: 'finance_delete_open_item', args: { id: this.operationId, version: 2 } }, previews[3]!] : previews
    const request = requests[this.calls++]
    if (request !== undefined) {
      const id = ToolCallId(`open-deletion-${this.calls}`)
      const args = JSON.stringify(request.args)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: request.name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: request.name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = this.execution ? '删除发送结果以原方向和期间的独立回查为准；响应丢失时不能重发。'
        : '已核对这笔往来。删除的完整关联影响还未核实，未执行删除；没有提供的信息不当作零或无关联。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it.skipIf(webClientProfile() !== 'xiaojing')('shows direction-specific deletion restrictions through the real Finance preset', async () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  const scaffold = await launchWebScaffold({ agentPresets: { default: 'standard', roots: [
    { path: fileURLToPath(new URL('../../cli/config/agent-presets', import.meta.url)), trust: 'system' },
    { path: fileURLToPath(new URL('../../cli/config/xiaojing-agent-presets', import.meta.url)), trust: 'system' },
  ] } })
  const browser = await chromium.launch()
  const originalFetch = globalThis.fetch
  try {
    const ctx = scaffold.ctx
    const workspacePath = join(scaffold.workspaceCwd, 'open-item-deletion-client')
    await mkdir(workspacePath)
    const created = await ctx.xiaojingFinanceDomain.create({ expectedRevision: 0, workspacePath,
      client: { legalName: '往来删除检查企业', shortName: '往来删除检查', taxpayerType: 'general-vat', registeredRegion: '上海', accountingStandard: 'enterprise',
        chartMappings: [], externalSystemRefs: [], financeSystem: { system: 'youcheng', environment: 'test',
          accountCode: '35616', appKey: 'snapshot-key' } }, credentialInput: { youchengAppSecret: 'snapshot-secret' } })
    for (const scenario of ['receivable', 'payable', 'receivable-execute', 'payable-execute',
      'receivable-execute-lost', 'payable-execute-lost', 'receivable-execute-foreign', 'payable-execute-foreign',
      'receivable-execute-balance-change', 'payable-execute-balance-change'] as const) {
      const direction = scenario.startsWith('receivable') ? 'receivable' : 'payable'
      const execution = scenario.includes('-execute')
      const lost = scenario.endsWith('-lost')
      const foreign = scenario.endsWith('-foreign')
      const balanceChange = scenario.endsWith('-balance-change')
      const openItemId = execution ? (lost ? 82614 : foreign ? 82616 : balanceChange ? 82618 : 82612)
        + (direction === 'payable' ? 1 : 0) : 72604
      const adapter = new DeletionPreviewAdapter(direction, openItemId, execution)
      const provider = `open-deletion-${scenario}`
      ctx.effect(() => ctx.llm.registerAdapter([provider], adapter))
      const handle = await ctx.agents.create({ sessionId: SessionId(`finance-open-deletion-${scenario}`),
        meta: { cwd: workspacePath, agentPreset: 'finance' }, agentOptions: { provider, model: provider },
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'finance').then(() => undefined) })
      const records = new OpenItemDeletionRecords(join(scaffold.harnessHome, 'finance/open-item-deletions'),
        `${created.client.id}/test/35616`, 262144, join(scaffold.harnessHome, 'finance/open-item-target-claims'))
      const routes: string[] = []
      let writes = 0
      let approvals = 0
      const raw = { id: openItemId, setOfBooksId: 35616, subjectId: direction === 'receivable' ? 174626 : 174624, accountStatus: 0,
        date: '2022-01-01', abstractStr: '删除检查专用', subjectCode: '', subjectName: '往来账户',
        auxiliaryItemIds: '191501', auxiliaryItemName: '测试往来单位', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
        money: 0.01, balance: 0.01, thisMoney: 0, badMoney: 0, hedgeMoney: 0, returnMoney: 0,
        ...execution ? { otherMoney: 0 } : {},
        initialBalance: false, isFinish: false, categoryName: '其他收支', remark: '', attachList: [],
        certificateWordAndCode: !execution && direction === 'payable' ? '记-1' : '', orderCode: '' }
      const survivor = { ...raw, id: openItemId + 100, abstractStr: '删除后保留记录', money: 0.19, balance: 0.19,
        currencyCode: foreign ? 'USD' : 'RMB' }
      let rows = execution ? [raw, survivor] : [raw]
      vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.origin !== 'https://cwdata.yiqiyun.com') return originalFetch(input, init)
        routes.push(url.pathname)
        if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'snapshot-token' })
        if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100,
          data: [{ id: '35616', sobName: '往来删除演示账套' }] })
        if (typeof init?.body !== 'string') throw new Error('Expected JSON request')
        if (url.pathname === '/finance/cashjournal/getCashierList') {
          const request = JSON.parse(init.body) as { page: number; direction: number }
          expect(request.direction).toBe(direction === 'receivable' ? 0 : 1)
          return Response.json({ result: 100, data: { count: rows.length, list: request.page === 1 ? rows : [] } })
        }
        expect(url.pathname).toBe('/finance/cashier/account/management/delete.rjson')
        expect(approvals).toBe(5)
        expect(writes).toBe(0)
        expect(JSON.parse(init.body)).toEqual({ booksName: '往来删除演示账套', managementId: openItemId })
        expect(await records.read(adapter.operationId as OpenItemDeletionId)).toMatchObject({ phase: 'outcome-unknown', version: 2 })
        writes++
        rows = [{ ...survivor, balance: balanceChange ? 0.18 : 0.19 }]
        if (lost) throw new TypeError('Response lost after accepted deletion', { cause: { code: 'ECONNRESET' } })
        return Response.json({ result: 100 })
      }))
      const page = await browser.newPage({ locale: 'zh-CN' })
      try {
        const workspace = await ctx.workspaceRegistry.resolveByPath(workspacePath)
        if (workspace === undefined) throw new Error('Missing workspace')
        await workspace.attachSession(handle.agent.session.id)
        await ctx.xiaojingFinanceDomain.stage(handle.agent, { mode: 'client', clientId: created.client.id })
        await page.addInitScript((sessionId) => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId })) }, handle.agent.session.id)
        await page.goto(scaffold.authenticatedUrl)
        const prompt = execution
          ? direction === 'receivable' ? '删除那笔一分钱应收记录，先给我准确版本确认。' : '删除那笔一分钱应付记录，先给我准确版本确认。'
          : direction === 'receivable' ? '一月那笔一分钱别人欠我们的记录，先看看删掉会影响什么，别直接删。'
            : '一月那笔一分钱我们欠别人的记录，先检查删除限制。'
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
        if (execution) {
          const panel = page.locator('[data-approval-key]')
          let previousKey: string | null = null
          const allow = /^(允许一次|Allow once)$/
          const confirmations = [
            { label: allow, detailed: false }, { label: allow, detailed: false },
            { label: /^(拒绝|Reject)$/, detailed: true }, { label: allow, detailed: false },
            { label: allow, detailed: true }, { label: allow, detailed: false },
          ]
          for (const confirmation of confirmations) {
            await panel.waitFor()
            await expect.poll(() => panel.getAttribute('data-approval-key')).not.toBe(previousKey)
            previousKey = await panel.getAttribute('data-approval-key')
            const text = await panel.textContent()
            if (confirmation.detailed) {
              for (const value of ['往来删除演示账套', '0.01', '测试往来单位',
                direction === 'receivable' ? '应收' : '应付', '可能连带影响关联对冲、核销或收入记录']) expect(text).toContain(value)
              expect(text).not.toMatch(new RegExp(`${openItemId}|确认版本|"version"`))
            } else expect(text).toContain('删除操作必须进行本次二次确认')
            expect(writes).toBe(approvals === 5 ? 1 : 0)
            if (approvals === 2) await compareOrRefreshGolden(fileURLToPath(new URL(
              `./snapshots/finance-open-item-deletion/${scenario}-approval.expected.md`, import.meta.url)),
            (await captureStableAria(page, '[data-approval-key]', scaffold.workspaceCwd))
              .replaceAll(adapter.operationId, '<deletion-id>'), webSnapshotMode())
            approvals++
            await panel.getByRole('button', { name: confirmation.label }).click()
            await expect.poll(() => handle.agent.session.snapshotEvents().filter(event => event.type === 'approval/decided').length).toBe(approvals)
          }
        }
        await handle.agent.whenIdle()
        const results = handle.agent.session.snapshotEvents().filter(event => event.type === 'tool/result').map(event => event.data.message.content)
        if (execution) {
          expect(results).toHaveLength(7)
          expect(JSON.stringify(results[2])).toContain('版本')
          expect(JSON.stringify(results[3])).toContain('未获得')
          expect(JSON.stringify(results[5])).toContain('不得重发')
          for (const index of [4, 6]) {
            const block = results[index]?.find(value => value.type === 'tool-result')
            const text = block?.type === 'tool-result' ? block.content.find(value => value.type === 'text') : undefined
            if (text?.type !== 'text') throw new Error('Missing AR/AP deletion execution or recovery result')
            expect(JSON.parse(text.text)).toMatchObject({ phase: lost ? 'outcome-unknown' : 'accepted',
              readback: { target: 'not-observed', content: 'matched',
                remainingBalances: balanceChange ? 'mismatch' : foreign ? 'unavailable' : 'matched',
                scope: 'selected-direction-periods', balances: {
                  original: { state: balanceChange ? 'mismatch' : 'matched' },
                  base: { state: balanceChange ? 'mismatch' : foreign ? 'unavailable' : 'matched',
                    changes: [{ basis: foreign ? 'unavailable' : 'same-currency' }] },
                } } })
            const value: unknown = JSON.parse(text.text)
            expect(value).toMatchObject({ readback: { balances: { original: { changes: foreign
              ? [{ currencyCode: 'RMB', before: '0.01', after: '0.00', removed: '0.01' },
                { currencyCode: 'USD', before: '0.19', after: '0.19', removed: '0.00' }]
              : [{ currencyCode: 'RMB', before: '0.20', after: balanceChange ? '0.18' : '0.19',
                removed: '0.01', expectedAfter: '0.19', state: balanceChange ? 'mismatch' : 'matched' }],
            } } } })
          }
          expect(writes).toBe(1)
          expect(approvals).toBe(6)
          expect(routes.filter(path => path === '/finance/cashier/account/management/delete.rjson')).toHaveLength(1)
          expect(await records.read(adapter.operationId as OpenItemDeletionId)).toMatchObject({ version: 2,
            phase: lost ? 'outcome-unknown' : 'accepted', inventory: { selection: { direction } } })
          expect(JSON.stringify(results)).not.toMatch(/snapshot-key|snapshot-secret|snapshot-token|configurationDigest|ownerDigest/)
          await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-open-item-deletion/${scenario}-results.expected.md`,
            import.meta.url)), JSON.stringify(results, null, 2).replaceAll(adapter.operationId, '<deletion-id>'), webSnapshotMode())
          continue
        }
        expect(results).toHaveLength(4)
        expect(JSON.stringify(results[2])).toContain('版本')
        expect(JSON.stringify(results[3])).toContain('present')
        expect(JSON.stringify(results)).toContain('公开接口的完整关联影响未核实')
        expect(JSON.stringify(results)).not.toMatch(/snapshot-key|snapshot-secret|snapshot-token|configurationDigest|ownerDigest/)
        expect(handle.agent.session.snapshotEvents().some(event => event.type === 'approval/asked')).toBe(false)
        expect(routes.length).toBeGreaterThan(0)
        expect(routes.every(path => ['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson',
          '/finance/cashjournal/getCashierList'].includes(path))).toBe(true)
        expect(await records.read(adapter.operationId as OpenItemDeletionId)).toMatchObject({ phase: 'prepared', version: 2,
          inventory: { selection: { direction } } })
        const cardSelector = '[data-chat-call-id="open-deletion-2"]'
        const card = page.locator(cardSelector)
        await revealToolCallCard(page, cardSelector)
        await expect.poll(() => card.textContent()).toContain(direction === 'payable'
          ? '当前条件不足，未执行' : '已准备，等待确认')
        expect(await card.textContent()).toContain('摘要：删除检查专用')
        expect(await card.textContent()).not.toMatch(/公开接口|unverified|fingerprint|版本|72604/)
        await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-open-item-deletion/${direction}-card.expected.md`,
          import.meta.url)), await captureStableAria(page, cardSelector, scaffold.workspaceCwd), webSnapshotMode())
        await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-open-item-deletion/${direction}-results.expected.md`,
          import.meta.url)), JSON.stringify(results, null, 2).replaceAll(adapter.operationId, '<deletion-id>'), webSnapshotMode())
      } finally { await page.close(); await handle.dispose() }
    }
  } finally { vi.unstubAllGlobals(); await browser.close(); await scaffold.close(); vi.unstubAllEnvs() }
}, 120_000)
