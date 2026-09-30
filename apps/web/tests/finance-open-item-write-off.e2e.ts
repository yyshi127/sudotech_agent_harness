/** Shipping Finance composition verifies full-settlement previews and non-destructive recovery. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import { ToolCallId, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { OpenItemWriteOffRecords, type OpenItemWriteOffId } from '../../../packages/xiaojing/xiaojing-finance-domain/src/open-item-write-off-records.ts'
import type { OpenItemWriteOffReceiptId } from '../../../packages/xiaojing/xiaojing-finance-domain/src/open-item-write-off.ts'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, revealToolCallCard, webClientProfile, webSnapshotMode } from './scaffold.ts'
import { financePresetDefinition } from './xiaojing-agent-presets.ts'

class WriteOffPreviewAdapter extends LlmAdapter {
  calls = 0
  operationId = ''
  seedAccepted: (() => Promise<void>) | undefined
  constructor(readonly direction: 'receivable' | 'payable', readonly accepted: boolean, readonly openItemId: number,
    readonly execution = false) { super() }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.calls > 0 && this.operationId === '') {
      const result = options.messages.find(message => message.role === 'tool' && message.source.callId === 'write-off-1')
      const text = result?.content.find(block => block.type === 'text')
      if (text?.type !== 'text') throw new Error('Missing actual write-off preview')
      const value: unknown = JSON.parse(text.text)
      if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string') {
        throw new Error('Missing actual operation ID')
      }
      this.operationId = value.id
    }
    if (this.accepted && this.calls === 3) await this.seedAccepted?.()
    const input = { direction: this.direction, openItemId: String(this.openItemId), cashAccountId: '174622', amount: '0.19',
      currencyCode: 'RMB', date: '2022-01-09', keeperName: '测试记账人', sourceQuery: { direction: this.direction,
        periodStart: '2022-01', periodEnd: '2022-01', page: 1, pageSize: 100 } }
    const previews = [
      { action: 'prepare', input },
      { action: 'revise', id: this.operationId, version: 1, input: { ...input, date: '2022-01-10' } },
      { action: 'revise', id: this.operationId, version: 1, input },
      { action: 'inspect', id: this.operationId },
      { action: 'inspect', id: this.operationId },
    ].map(args => ({ name: 'finance_prepare_open_item_write_off', args }))
    const requests = this.execution ? [previews[0]!, previews[1]!,
      { name: 'finance_write_off_open_item', args: { id: this.operationId, version: 1 } },
      { name: 'finance_write_off_open_item', args: { id: this.operationId, version: 2 } },
      { name: 'finance_write_off_open_item', args: { id: this.operationId, version: 2 } },
      { name: 'finance_write_off_open_item', args: { id: this.operationId, version: 2 } }, previews[3]!] : previews
    const request = requests[this.calls++]
    if (request !== undefined) {
      const id = ToolCallId(`write-off-${this.calls}`)
      const args = JSON.stringify(request.args)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: request.name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: request.name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = this.execution ? '核销执行以原记录和独立回查为准；结果未知不能重发。这不是银行收付款。'
        : '已保存整笔核销方案，没有执行核销或付款。余额观察与原操作回执分开；执行条件尚未完整核实。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it.skipIf(webClientProfile() !== 'xiaojing')('shows write-off versions and independent observations through the real Finance preset', async () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  const scaffold = await launchWebScaffold({ agentPresets: { default: 'standard', definitions: [financePresetDefinition()] } })
  const browser = await chromium.launch()
  const originalFetch = globalThis.fetch
  try {
    const ctx = scaffold.ctx
    const workspacePath = join(scaffold.workspaceCwd, 'write-off-client')
    await mkdir(workspacePath)
    const created = await ctx.xiaojingFinanceDomain.create({ expectedRevision: 0, workspacePath,
      client: { legalName: '核销检查企业', shortName: '核销检查', taxpayerType: 'general-vat', registeredRegion: '上海', accountingStandard: 'enterprise',
        chartMappings: [], externalSystemRefs: [], financeSystem: { system: 'youcheng', environment: 'test',
          accountCode: '35616', appKey: 'snapshot-key' } }, credentialInput: { youchengAppSecret: 'snapshot-secret' } })
    for (const scenario of ['receivable', 'payable', 'receivable-accepted', 'payable-accepted',
      'receivable-accepted-identity-changed', 'payable-accepted-identity-changed',
      'receivable-execute', 'payable-execute', 'receivable-execute-lost', 'payable-execute-lost',
      'receivable-execute-preflight-failed', 'payable-execute-preflight-failed'] as const) {
      const direction = scenario.startsWith('receivable') ? 'receivable' : 'payable'
      const accepted = scenario.includes('-accepted')
      const identityChanged = scenario.endsWith('-identity-changed')
      const execution = scenario.includes('-execute')
      const lost = scenario.endsWith('-lost')
      const preflightFailed = scenario.endsWith('-preflight-failed')
      const openItemId = execution ? (preflightFailed ? 72620 : lost ? 72614 : 72612) + (direction === 'payable' ? 1 : 0)
        : identityChanged ? direction === 'receivable' ? 72608 : 72609 : direction === 'receivable' ? 72606 : 72607
      const receiptId = direction === 'receivable' ? '65833' : '65834'
      const journalId = direction === 'receivable' ? 141108 : 141109
      const adapter = new WriteOffPreviewAdapter(direction, accepted, openItemId, execution)
      const provider = `write-off-${scenario}`
      const records = new OpenItemWriteOffRecords(join(scaffold.harnessHome, 'finance/open-item-write-offs'),
        `${created.client.id}/test/35616`, 262144, join(scaffold.harnessHome, 'finance/open-item-target-claims'))
      // Test-owned accepted records exercise recovery; this does not provide a production execution or approval bypass.
      adapter.seedAccepted = async () => {
        const id = adapter.operationId as OpenItemWriteOffId
        const record = await records.read(id)
        await records.reserve(id, 2, record.configurationDigest, async () => {})
        await records.recordOutcome(id, 2, { state: 'accepted', receiptId: receiptId as OpenItemWriteOffReceiptId })
      }
      ctx.effect(() => ctx.llm.registerAdapter([provider], adapter))
      const handle = await ctx.agents.create({ sessionId: SessionId(`finance-write-off-${scenario}`),
        meta: { cwd: workspacePath, agentPreset: 'finance' }, agentOptions: { provider, model: provider },
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'finance').then(() => undefined) })
      const routes: string[] = []
      let writes = 0
      let approvals = 0
      vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.origin !== 'https://cwdata.yiqiyun.com') return originalFetch(input, init)
        routes.push(url.pathname)
        if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'snapshot-token' })
        if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35616', sobName: '核销演示账套' }] })
        if (url.pathname === '/finance/cashjournal/getAccountList.rjson') return Response.json({ result: 100,
          data: [{ accountId: 174622, accountName: '库存现金', status: 0, direction: 0, currencyId: '1',
            ...execution ? { subjectCode: '1001' } : {} }] })
        if (url.pathname === '/finance/auxiliary/querySubjectInfoList.rjson') return Response.json({ result: 100,
          data: [{ subjectCode: '1001', subjectName: '库存现金', enableStatus: 1, hasChild: false, currencyList: [] }] })
        if (url.pathname === '/finance/cashier/account/management/writeOff.rjson') {
          if (typeof init?.body !== 'string') throw new Error('Expected write-off JSON')
          expect(approvals).toBe(2)
          expect(writes).toBe(0)
          expect(JSON.parse(init.body)).toEqual({ booksName: '核销演示账套', direction: direction === 'payable',
            money: 0.19, accountManagementId: openItemId, accountId: 174622, date: '2022-01-10', resource: 1, type: 1, keeperName: '测试记账人' })
          expect(await records.read(adapter.operationId as OpenItemWriteOffId)).toMatchObject({ phase: 'outcome-unknown', version: 2 })
          writes++
          if (lost) throw new Error('Response lost after accepted write')
          return Response.json({ result: 100, data: receiptId })
        }
        if (url.pathname === '/finance/cashjournal/getListPage.rjson') {
          if (typeof init?.body !== 'string') throw new Error('Expected journal JSON')
          const query = JSON.parse(init.body) as { page: number }
          return Response.json({ result: 100, count: 1, data: query.page > 1 ? [] : [{ id: journalId, relationId: Number(receiptId),
            channel: 'WRITE_OFF', subjectId: 174622, auxiliaryItemIds: '191501', date: '2022-01-10', abstractStr: '核销关联流水',
            accountCode: '1001', accountName: '库存现金', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
            borrow: direction === 'receivable' ? 0.19 : 0, loan: direction === 'payable' ? 0.19 : 0,
            balance: 0, baseBalance: 0, categoryName: '其他收支', keeperName: '测试记账人' }] })
        }
        expect(url.pathname).toBe('/finance/cashjournal/getCashierList')
        if (preflightFailed && adapter.operationId
          && (await records.read(adapter.operationId as OpenItemWriteOffId)).phase === 'outcome-unknown') {
          return Response.json({ result: 201 })
        }
        if (!execution && adapter.calls === 5) return Response.json({ result: 201 })
        if (typeof init?.body !== 'string') throw new Error('Expected JSON request')
        expect((JSON.parse(init.body) as { direction: number }).direction).toBe(direction === 'receivable' ? 0 : 1)
        const settled = execution ? writes === 1 : adapter.calls >= 4
        return Response.json({ result: 100, data: { count: 1, list: [{ id: openItemId, setOfBooksId: 35616,
          subjectId: identityChanged && settled ? 999999 : direction === 'receivable' ? 174626 : 174624,
          accountStatus: 0, certificateWordAndCode: '', orderCode: '',
          date: '2022-01-01', abstractStr: '整笔核销检查专用', subjectCode: '', subjectName: '往来账户',
          auxiliaryItemIds: '191501', auxiliaryItemName: '测试往来单位', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
          money: 0.19, balance: settled ? 0 : 0.19, thisMoney: settled ? 0.19 : 0,
          badMoney: 0, hedgeMoney: 0, returnMoney: 0, initialBalance: false, isFinish: settled, categoryName: '其他收支', remark: '',
        }] } })
      }))
      const page = await browser.newPage({ locale: 'zh-CN' })
      try {
        const workspace = await ctx.workspaceRegistry.resolveByPath(workspacePath)
        if (workspace === undefined) throw new Error('Missing workspace')
        await workspace.attachSession(handle.agent.session.id)
        await ctx.xiaojingFinanceDomain.stage(handle.agent, { mode: 'client', clientId: created.client.id })
        await page.addInitScript((sessionId) => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId })) }, handle.agent.session.id)
        await page.goto(scaffold.authenticatedUrl)
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: direction === 'receivable'
          ? execution ? '那笔一毛九欠款已收齐，登记到现金，先给我确认再核销。' : '那笔一毛九的欠款收齐了，先帮我准备登记方案，别直接处理。'
          : execution ? '欠人家的一毛九已用现金付清，给我确认后整笔核销。' : '欠人家的那笔一毛九已经付清，先看看整笔核销该怎么登记。' }], source: { kind: 'user' } }))
        if (execution) {
          const panel = page.locator('[data-approval-key]')
          let previousKey: string | null = null
          for (const label of [/^(拒绝|Reject)$/, /^(允许一次|Allow once)$/]) {
            await panel.waitFor()
            await expect.poll(() => panel.getAttribute('data-approval-key')).not.toBe(previousKey)
            previousKey = await panel.getAttribute('data-approval-key')
            const text = await panel.textContent()
            for (const value of ['核销演示账套', '0.19', '测试往来单位', '库存现金',
              direction === 'receivable' ? '应收' : '应付']) expect(text).toContain(value)
            expect(text).not.toMatch(new RegExp(`${openItemId}|版本 2|期间锁定状态未提供|"version"`))
            expect(writes).toBe(0)
            if (approvals === 0) await compareOrRefreshGolden(fileURLToPath(new URL(
              `./snapshots/finance-open-item-write-off/${scenario}-approval.expected.md`, import.meta.url)),
            (await captureStableAria(page, '[data-approval-key]', scaffold.workspaceCwd)).replaceAll(adapter.operationId, '<write-off-id>'), webSnapshotMode())
            approvals++
            await panel.getByRole('button', { name: label }).click()
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
          const text = results[6]?.find(value => value.type === 'text')
          if (text?.type !== 'text') throw new Error('Missing final execution readback')
          expect(JSON.parse(text.text)).toMatchObject({ phase: preflightFailed ? 'not-sent' : lost ? 'outcome-unknown' : 'accepted',
            readback: { settlement: preflightFailed ? 'mismatch' : 'matched', businessAccount: 'matched',
              operation: lost || preflightFailed ? 'unverified' : 'matched' } })
          expect(writes).toBe(preflightFailed ? 0 : 1)
          expect(await records.read(adapter.operationId as OpenItemWriteOffId)).toMatchObject({ version: 2,
            phase: preflightFailed ? 'not-sent' : lost ? 'outcome-unknown' : 'accepted' })
          if (preflightFailed) expect(JSON.parse(text.text)).toMatchObject({ outcome: {
            state: 'not-sent', reason: 'preflight-failed' } })
          expect(JSON.stringify(results)).not.toMatch(/snapshot-key|snapshot-secret|snapshot-token|configurationDigest|ownerDigest/)
          await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-open-item-write-off/${scenario}-results.expected.md`,
            import.meta.url)), JSON.stringify(results, null, 2).replaceAll(adapter.operationId, '<write-off-id>'), webSnapshotMode())
          continue
        }
        expect(results).toHaveLength(5)
        expect(JSON.stringify(results[2])).toContain('版本')
        expect(JSON.stringify(results[3])).toContain('matched')
        if (accepted) {
          const text = results[3]?.find(value => value.type === 'text')
          if (text?.type !== 'text') throw new Error('Missing accepted recovery result')
          expect(JSON.parse(text.text)).toMatchObject({ phase: 'accepted', outcome: { state: 'accepted', receiptId },
            readback: { operation: identityChanged ? 'unverified' : 'matched',
              businessAccount: identityChanged ? 'mismatch' : 'matched',
              journalLink: identityChanged ? { state: 'unavailable' } : { state: 'matched', receiptId, journalId: String(journalId) } } })
        } else expect(JSON.stringify(results[3])).toContain('unverified')
        expect(JSON.stringify(results[4])).toContain('unavailable')
        expect(JSON.stringify(results)).not.toMatch(/snapshot-key|snapshot-secret|snapshot-token|configurationDigest|ownerDigest/)
        expect(handle.agent.session.snapshotEvents().some(event => event.type === 'approval/asked')).toBe(false)
        expect(routes.length).toBeGreaterThan(0)
        expect(routes.every(path => ['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson',
          '/finance/cashjournal/getCashierList', '/finance/cashjournal/getAccountList.rjson', '/finance/cashjournal/getListPage.rjson'].includes(path))).toBe(true)
        expect(await records.read(adapter.operationId as OpenItemWriteOffId)).toMatchObject({ phase: accepted ? 'accepted' : 'prepared', version: 2,
          evidence: { businessAccountId: direction === 'receivable' ? '174626' : '174624',
            input: { direction, date: '2022-01-10' }, source: { rows: [{ balance: '0.19' }] } } })
        if (accepted) expect(await records.read(adapter.operationId as OpenItemWriteOffId))
          .toMatchObject({ outcome: { state: 'accepted', receiptId } })
        const cardSelector = '[data-chat-call-id="write-off-2"]'
        const card = page.locator(cardSelector)
        await revealToolCallCard(page, cardSelector)
        await expect.poll(() => card.textContent()).toContain('当前条件不足，未执行')
        expect(await card.textContent()).toContain(direction === 'receivable' ? '业务类型：应收' : '业务类型：应付')
        expect(await card.textContent()).toContain('资金账户的本位币科目配置尚未核实，不能执行核销')
        expect(await card.textContent()).not.toMatch(/unverified|sourceQuery|fingerprint|版本/)
        await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-open-item-write-off/${scenario}-card.expected.md`,
          import.meta.url)), await captureStableAria(page, cardSelector, scaffold.workspaceCwd), webSnapshotMode())
        await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-open-item-write-off/${scenario}-results.expected.md`,
          import.meta.url)), JSON.stringify(results, null, 2).replaceAll(adapter.operationId, '<write-off-id>'), webSnapshotMode())
      } finally { await page.close(); await handle.dispose() }
    }
  } finally { vi.unstubAllGlobals(); await browser.close(); await scaffold.close(); vi.unstubAllEnvs() }
}, 120_000)
