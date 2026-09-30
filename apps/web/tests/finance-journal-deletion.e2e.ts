/** Real Finance preset and confirmation UI with keyless journal responses; no live business mutations. */
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import { ToolCallId, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { JournalDeletionRecords, type JournalDeletionId } from '../../../packages/xiaojing/xiaojing-finance-domain/src/journal-deletion-records.ts'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, webClientProfile, webSnapshotMode } from './scaffold.ts'
import { financePresetDefinition } from './xiaojing-agent-presets.ts'

class JournalDeletionAdapter extends LlmAdapter {
  calls = 0
  deletionId = ''
  constructor(readonly journalId: string, readonly changedConfirmation = false) { super() }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.calls > 0 && this.deletionId === '') {
      const result = options.messages.find(message => message.role === 'tool' && message.source.callId === 'journal-deletion-1')
      const text = result?.content.find(block => block.type === 'text')
      if (text?.type !== 'text') throw new Error('Missing actual journal deletion preview')
      const value: unknown = JSON.parse(text.text)
      if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string') {
        throw new Error('Missing journal deletion operation ID')
      }
      this.deletionId = value.id
    }
    const target = { journalId: this.journalId, cashAccountId: '174622', month: '2022-01' }
    const requests = [
      { name: 'finance_prepare_journal_deletion', args: { action: 'prepare', ...target } },
      { name: 'finance_prepare_journal_deletion', args: { action: 'revise', id: this.deletionId, version: 1, ...target } },
      { name: 'finance_delete_journal', args: { id: this.deletionId, version: 1 } },
      { name: 'finance_delete_journal', args: { id: this.deletionId, version: 2 } },
      { name: 'finance_delete_journal', args: { id: this.deletionId, version: 2 } },
      { name: 'finance_delete_journal', args: { id: this.deletionId, version: 2 } },
      { name: 'finance_prepare_journal_deletion', args: { action: 'inspect', id: this.deletionId } },
    ]
    if (this.changedConfirmation) requests.splice(5, 1)
    const request = requests[this.calls++]
    if (request !== undefined) {
      const id = ToolCallId(`journal-deletion-${this.calls}`)
      const args = JSON.stringify(request.args)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: request.name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: request.name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = '仅在原月份和账户回查。接口接收不等于核验完成，结果未知只查原记录，不重新发送。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it.skipIf(webClientProfile() !== 'xiaojing')('confirms journal deletion versions and retains scoped recovery in the real UI', async () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  const scaffold = await launchWebScaffold({ agentPresets: { default: 'standard', definitions: [financePresetDefinition()] } })
  const browser = await chromium.launch()
  const originalFetch = globalThis.fetch
  try {
    const ctx = scaffold.ctx
    const workspacePath = join(scaffold.workspaceCwd, 'journal-deletion-client')
    await mkdir(workspacePath)
    const created = await ctx.xiaojingFinanceDomain.create({ expectedRevision: 0, workspacePath,
      client: { legalName: '流水删除测试企业', shortName: '流水删除测试', taxpayerType: 'general-vat', registeredRegion: '上海', accountingStandard: 'enterprise',
        chartMappings: [], externalSystemRefs: [], financeSystem: { system: 'youcheng', environment: 'test',
          accountCode: '35616', appKey: 'snapshot-key' } }, credentialInput: { youchengAppSecret: 'snapshot-secret' } })
    for (const scenario of ['accepted', 'lost', 'changed-confirmation'] as const) {
      const changedConfirmation = scenario === 'changed-confirmation'
      const journalId = scenario === 'accepted' ? '123' : scenario === 'lost' ? '124' : '125'
      const adapter = new JournalDeletionAdapter(journalId, changedConfirmation)
      const provider = `journal-delete-${scenario}`
      ctx.effect(() => ctx.llm.registerAdapter([provider], adapter))
      const handle = await ctx.agents.create({ sessionId: SessionId(`finance-journal-deletion-${scenario}`),
        meta: { cwd: workspacePath, agentPreset: 'finance' }, agentOptions: { provider, model: provider },
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'finance').then(() => undefined) })
      const records = new JournalDeletionRecords(join(scaffold.harnessHome, 'finance/journal-deletions'),
        `${created.client.id}/test/35616`, 262144)
      let writes = 0
      let approvals = 0
      const fields = { accountCode: '', accountName: '库存现金', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
        categoryName: '收-其他收入', keeperName: '测试', loan: null, baseLoan: null }
      const raw = { ...fields, id: journalId, date: '2022-01-01', abstractStr: '删除专用测试', subjectId: 174622,
        borrow: '0.01', balance: '0.01', baseBorrow: '0.01', baseBalance: '0.01', reviewStatus: 0,
        reviewUser: '', reviewUserId: '', accountStatus: 0, channel: 'ADD', certificateWordAndCode: '',
        cashManagementId: '', auxiliaryItemIds: '', orderCode: '', relationOrderCodeList: [],
        attachList: [], attachIdList: [], canWriteOffAmount: '0.01' }
      vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.origin !== 'https://cwdata.yiqiyun.com') return originalFetch(input, init)
        if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'snapshot-token' })
        if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100,
          data: [{ id: '35616', sobName: '流水删除演示账套' }] })
        if (url.pathname === '/finance/cashjournal/getAccountList.rjson') return Response.json({ result: 100, data: [{ accountId: 174622 }] })
        if (typeof init?.body !== 'string') throw new Error('Missing journal request')
        if (url.pathname === '/finance/cashjournal/getListPage.rjson') {
          const request = JSON.parse(init.body) as { page: number }
          const sum = writes === 0 ? '0.01' : '0.00'
          return Response.json({ result: 100, count: writes === 0 ? 1 : 0, data: [
            { ...fields, date: '', abstractStr: '初始余额', borrow: null, baseBorrow: null, balance: '0.00', baseBalance: '0.00' },
            ...writes === 0 && request.page === 1 ? [raw] : [],
            { ...fields, date: '', abstractStr: '合计', borrow: sum, baseBorrow: sum, balance: sum, baseBalance: sum },
          ] })
        }
        expect(url.pathname).toBe('/finance/cashjournal/delete.rjson')
        expect(approvals).toBe(5)
        expect(writes).toBe(0)
        expect(JSON.parse(init.body)).toEqual({ id: Number(journalId), accountName: '流水删除演示账套' })
        expect(await records.read(adapter.deletionId as JournalDeletionId)).toMatchObject({ phase: 'outcome-unknown', version: 2 })
        writes++
        if (scenario === 'lost') throw new TypeError('Lost response', { cause: { code: 'ECONNRESET' } })
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
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '把刚才那条一分钱现金测试流水删掉，先给我看清楚再确认。' }],
          source: { kind: 'user' } }))
        const panel = page.locator('[data-approval-key]')
        const normalize = (value: string) => value.replaceAll(adapter.deletionId, '<deletion-id>')
        let previousKey: string | null = null
        const allow = /^(允许一次|Allow once)$/
        const confirmations = [
          { label: allow, detailed: false }, { label: allow, detailed: false },
          { label: /^(拒绝|Reject)$/, detailed: true }, { label: allow, detailed: false },
          { label: allow, detailed: true }, { label: allow, detailed: false },
        ]
        if (changedConfirmation) confirmations.pop()
        for (const confirmation of confirmations) {
          await panel.waitFor()
          await expect.poll(() => panel.getAttribute('data-approval-key')).not.toBe(previousKey)
          previousKey = await panel.getAttribute('data-approval-key')
          const text = await panel.textContent()
          if (confirmation.detailed) {
            for (const value of ['流水删除演示账套', '库存现金', '删除专用测试', '0.01', '无法自动撤销']) expect(text).toContain(value)
            expect(text).not.toMatch(new RegExp(`${journalId}|确认版本|"version"`))
          } else expect(text).toContain('删除操作必须进行本次二次确认')
          expect(writes).toBe(approvals === 5 ? 1 : 0)
          if (approvals === 2) await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-journal-deletion/${scenario}-approval.expected.md`,
            import.meta.url)), normalize(await captureStableAria(page, '[data-approval-key]', scaffold.workspaceCwd)), webSnapshotMode())
          if (changedConfirmation && approvals === 4) {
            const record = await records.read(adapter.deletionId as JournalDeletionId)
            record.inventory.notice = 'Fixture: evidence replaced while confirmation was open'
            const owner = createHash('sha256').update(`${created.client.id}/test/35616`).digest('hex')
            await writeFile(join(scaffold.harnessHome, 'finance/journal-deletions', owner, `${adapter.deletionId}.json`),
              JSON.stringify(record))
          }
          approvals++
          await panel.getByRole('button', { name: confirmation.label }).click()
          await expect.poll(() => handle.agent.session.snapshotEvents().filter(event => event.type === 'approval/decided').length).toBe(approvals)
        }
        await handle.agent.whenIdle()
        expect(writes).toBe(changedConfirmation ? 0 : 1)
        expect(await records.read(adapter.deletionId as JournalDeletionId)).toMatchObject({
          phase: changedConfirmation ? 'prepared' : scenario === 'lost' ? 'outcome-unknown' : 'accepted', version: 2 })
        const results = handle.agent.session.snapshotEvents().filter(event => event.type === 'tool/result').map(event => event.data.message.content)
        expect(results).toHaveLength(changedConfirmation ? 6 : 7)
        expect(JSON.stringify(results[2])).toContain('版本')
        expect(JSON.stringify(results[3])).toContain('未获得')
        if (changedConfirmation) {
          expect(JSON.stringify(results[4])).toContain('内容已变化')
          expect(JSON.stringify(results[5])).toContain('not-checked')
          expect(JSON.stringify(results[5])).toContain('prepared')
        } else {
          expect(JSON.stringify(results[5])).toContain('发送记录')
          expect(JSON.stringify(results[6])).toContain('not-observed')
          expect(JSON.stringify(results[6])).toContain('matched')
        }
        expect(JSON.stringify(results)).not.toMatch(/snapshot-key|snapshot-secret|snapshot-token|configurationDigest/)
        await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-journal-deletion/${scenario}-results.expected.md`, import.meta.url)),
          normalize(JSON.stringify(results, null, 2)), webSnapshotMode())
      } finally { await page.close(); await handle.dispose() }
    }
  } finally { vi.unstubAllGlobals(); await browser.close(); await scaffold.close(); vi.unstubAllEnvs() }
}, 120_000)
