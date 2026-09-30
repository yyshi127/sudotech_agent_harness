/** Shipped deletion tools, actual mandatory approval UI and durable single-send recovery with keyless vendor responses. */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import { ToolCallId, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { VoucherDeletionRecords, type VoucherDeletionId } from '../../../packages/xiaojing/xiaojing-finance-domain/src/voucher-deletion-records.ts'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, webClientProfile, webSnapshotMode } from './scaffold.ts'
import { financePresetDefinition } from './xiaojing-agent-presets.ts'

class DeletionAdapter extends LlmAdapter {
  calls = 0
  deletionId = ''
  constructor(readonly voucherId: string, readonly changedConfirmation = false) { super() }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.calls > 0 && this.deletionId === '') {
      const result = options.messages.flatMap(message => message.content)
        .find(block => block.type === 'tool-result' && block.toolCallId === 'deletion-1')
      const text = result?.type === 'tool-result' ? result.content.find(block => block.type === 'text') : undefined
      if (text?.type !== 'text') throw new Error('Missing actual deletion preview')
      const parsed: unknown = JSON.parse(text.text)
      if (typeof parsed !== 'object' || parsed === null || !('id' in parsed) || typeof parsed.id !== 'string') {
        throw new Error('Missing deletion operation ID')
      }
      this.deletionId = parsed.id
    }
    const source = { voucherId: this.voucherId }
    const requests = [
      { name: 'finance_prepare_voucher_deletion', args: { action: 'prepare', ...source } },
      { name: 'finance_prepare_voucher_deletion', args: { action: 'revise', id: this.deletionId, version: 1, ...source } },
      { name: 'finance_delete_voucher', args: { id: this.deletionId, version: 1 } },
      { name: 'finance_delete_voucher', args: { id: this.deletionId, version: 2 } },
      { name: 'finance_delete_voucher', args: { id: this.deletionId, version: 2 } },
      { name: 'finance_delete_voucher', args: { id: this.deletionId, version: 2 } },
      { name: 'finance_prepare_voucher_deletion', args: { action: 'inspect', id: this.deletionId } },
    ]
    if (this.changedConfirmation) requests.splice(5, 1)
    const request = requests[this.calls++]
    if (request !== undefined) {
      const id = ToolCallId(`deletion-${this.calls}`)
      const args = JSON.stringify(request.args)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: request.name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: request.name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = '已保留原删除记录；接口接收不等于完成，未知结果仅复查，不重新发送。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it.skipIf(webClientProfile() !== 'xiaojing')('confirms the exact deletion version in the real UI and preserves unknown outcomes', async () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  const scaffold = await launchWebScaffold({ agentPresets: { default: 'standard', definitions: [financePresetDefinition()] } })
  const browser = await chromium.launch()
  const originalFetch = globalThis.fetch
  try {
    const ctx = scaffold.ctx
    const workspacePath = join(scaffold.workspaceCwd, 'deletion-client')
    await mkdir(workspacePath)
    const config = { system: 'youcheng' as const, environment: 'test' as const, accountCode: '35616', appKey: 'snapshot-key' }
    const created = await ctx.xiaojingFinanceDomain.create({ expectedRevision: 0, workspacePath,
      client: { legalName: '删除测试企业', shortName: '删除测试', taxpayerType: 'general-vat', registeredRegion: '上海', accountingStandard: 'enterprise',
        chartMappings: [], externalSystemRefs: [], financeSystem: config }, credentialInput: { youchengAppSecret: 'snapshot-secret' } })
    for (const scenario of ['accepted', 'lost', 'changed-confirmation', 'attached'] as const) {
      const changedConfirmation = scenario === 'changed-confirmation'
      const attached = scenario === 'attached'
      const voucherId = scenario === 'accepted' ? '123' : scenario === 'lost' ? '124' : attached ? '126' : '125'
      const adapter = new DeletionAdapter(voucherId, changedConfirmation)
      const provider = `voucher-delete-${scenario}`
      ctx.effect(() => ctx.llm.registerAdapter([provider], adapter))
      const handle = await ctx.agents.create({ sessionId: SessionId(`finance-deletion-${scenario}`),
        meta: { cwd: workspacePath, agentPreset: 'finance' }, agentOptions: { provider, model: provider },
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'finance').then(() => undefined) })
      const account = { id: '35616', name: '删除演示账套' }
      const input = { date: '2022-01-01', certificateCode: 40, documentMaker: '测试', sourcePaths: attached ? ['/original.txt'] : [], entries: [
        { summary: '删除专用测试', subjectCode: '1001', side: 'debit', amount: '0.01', auxiliary: [] },
        { summary: '删除专用测试', subjectCode: '100201', side: 'credit', amount: '0.01', auxiliary: [] },
      ] }
      const records = new VoucherDeletionRecords(join(scaffold.harnessHome, 'finance/voucher-deletions'),
        `${created.client.id}/test/35616`, 131072)
      let writes = 0
      let approvals = 0
      const raw = { accountId: account.id, certificateId: voucherId, certificateWord: '记', certificateCode: 40,
        certificateDate: '2022-01-01', periods: '2022-01', documentMaker: '测试', auditingStatus: false, settleStatus: false,
        modified: '2026-09-10', channel: 'EXTERNAL_ACCESS', sysCreate: false, relationCode: '', adjustPeriodsStatus: 0,
        attachmentStatus: attached, attachmentList: attached ? [{ downloadUrl: 'https://vendor.invalid/private-copy' }] : [],
        corpBalanceSheetCertificateList: [], subjectCertificateWrites: [],
        certificateLists: input.entries.map(row => ({ abstractName: row.summary, subjectCode: row.subjectCode, subjectName: '测试科目',
          direction: row.side === 'debit' ? 0 : 1, borrorMoneyStr: row.side === 'debit' ? row.amount : '0.00',
          loanMoneyStr: row.side === 'credit' ? row.amount : '0.00', auxiliaryList: [], currencyCode: '' })),
      }
      vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        expect(url.hostname).not.toBe('vendor.invalid')
        if (url.origin !== 'https://cwdata.yiqiyun.com') return originalFetch(input, init)
        if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'snapshot-token' })
        if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: account.id, sobName: account.name }] })
        if (url.pathname === '/finance/certificate/info.rjson') return Response.json({ result: 100, data: raw })
        if (url.pathname === '/finance/certificate/list.rjson') return Response.json({ result: 100,
          data: { success: true, count: writes === 0 ? 1 : 0, list: writes === 0 ? [{ ...raw, entryList: raw.certificateLists }] : [] } })
        expect(url.pathname).toBe('/finance/certificate/delCertificate.rjson')
        expect(approvals).toBe(5)
        expect(writes).toBe(0)
        if (typeof init?.body !== 'string') throw new Error('Missing deletion payload')
        expect(JSON.parse(init.body)).toEqual({ accountName: account.name, cerInfoList: [{ cerId: voucherId }] })
        expect(await records.read(adapter.deletionId as VoucherDeletionId)).toMatchObject({ phase: 'outcome-unknown', version: 2 })
        writes++
        if (scenario === 'lost') throw new TypeError('Lost response', { cause: { code: 'ECONNRESET' } })
        return Response.json({ result: 100, data: {} })
      }))
      const page = await browser.newPage({ locale: 'zh-CN' })
      try {
        const workspace = await ctx.workspaceRegistry.resolveByPath(workspacePath)
        if (workspace === undefined) throw new Error('Missing workspace')
        await workspace.attachSession(handle.agent.session.id)
        await ctx.xiaojingFinanceDomain.stage(handle.agent, { mode: 'client', clientId: created.client.id })
        await page.addInitScript((sessionId) => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId })) }, handle.agent.session.id)
        await page.goto(scaffold.authenticatedUrl)
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '把刚才那张一分钱测试凭证删掉，先给我看清楚再确认。' }],
          source: { kind: 'user' } }))
        const panel = page.locator('[data-approval-key]')
        const normalize = (value: string) => value.replaceAll(adapter.deletionId, '<deletion-id>')
          .replaceAll(created.client.id, '<client-id>')
        let previousKey: string | null = null
        const allow = /^(允许一次|Allow once)$/
        const confirmations = [
          { label: allow, detailed: false },
          { label: allow, detailed: false },
          { label: /^(拒绝|Reject)$/, detailed: true },
          { label: allow, detailed: false },
          { label: allow, detailed: true },
          { label: allow, detailed: false },
        ]
        if (changedConfirmation) confirmations.pop()
        for (const confirmation of confirmations) {
          try { await panel.waitFor() }
          catch (error) {
            const results = handle.agent.session.snapshotEvents().filter(event => event.type === 'tool/result').map(event => event.data.message.content)
            throw new Error(`Deletion approval missing; calls=${adapter.calls}; results=${JSON.stringify(results)}`, { cause: error })
          }
          await expect.poll(() => panel.getAttribute('data-approval-key')).not.toBe(previousKey)
          previousKey = await panel.getAttribute('data-approval-key')
          const text = await panel.textContent()
          if (confirmation.detailed) {
            for (const value of ['删除演示账套', '记-40', '2022-01-01', '2 行']) expect(text).toContain(value)
            expect(text).not.toMatch(new RegExp(`${voucherId}|准确版本|"version"`))
            expect(text).toContain('原 OSS 文件不会随凭证删除')
          } else expect(text).toContain('删除操作必须进行本次二次确认')
          expect(writes).toBe(approvals === 5 ? 1 : 0)
          if (approvals === 2) await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-voucher-deletion/${scenario}-approval.expected.md`,
            import.meta.url)), normalize(await captureStableAria(page, '[data-approval-key]', scaffold.workspaceCwd)), webSnapshotMode())
          if (changedConfirmation && approvals === 4) {
            const record = await records.read(adapter.deletionId as VoucherDeletionId)
            record.previewJson = record.previewJson.replace('仅检查', '内容变化：仅检查')
            const owner = createHash('sha256').update(`${created.client.id}/test/35616`).digest('hex')
            await writeFile(join(scaffold.harnessHome, 'finance/voucher-deletions', owner, `${adapter.deletionId}.json`),
              JSON.stringify(record))
          }
          approvals++
          await panel.getByRole('button', { name: confirmation.label }).click()
          await expect.poll(() => handle.agent.session.snapshotEvents().filter(event => event.type === 'approval/decided').length).toBe(approvals)
        }
        await handle.agent.whenIdle()
        expect(writes).toBe(changedConfirmation ? 0 : 1)
        expect(await records.read(adapter.deletionId as VoucherDeletionId)).toMatchObject({
          phase: changedConfirmation ? 'prepared' : scenario === 'lost' ? 'outcome-unknown' : 'accepted', version: 2 })
        const results = handle.agent.session.snapshotEvents().filter(event => event.type === 'tool/result').map(event => event.data.message.content)
        expect(results).toHaveLength(changedConfirmation ? 6 : 7)
        expect(JSON.stringify(results[2])).toContain('版本')
        expect(JSON.stringify(results[3])).toContain('未获得')
        if (changedConfirmation) {
          expect(JSON.stringify(results[4])).toContain('内容已变化')
          expect(JSON.stringify(results[5])).toContain('prepared')
          expect(JSON.stringify(results[5])).toContain('not-checked')
        } else {
          expect(JSON.stringify(results[5])).toContain('发送记录')
          expect(JSON.stringify(results[6])).toContain('absent')
        }
        expect(JSON.stringify(results)).not.toMatch(
          /snapshot-key|snapshot-secret|snapshot-token|configurationDigest|original\.invalid|vendor\.invalid/)
        await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-voucher-deletion/${scenario}-results.expected.md`, import.meta.url)),
          normalize(JSON.stringify(results, null, 2)), webSnapshotMode())
      } finally { await page.close(); await handle.dispose() }
    }
  } finally {
    vi.unstubAllGlobals()
    await browser.close()
    await scaffold.close()
    vi.unstubAllEnvs()
  }
}, 120_000)
