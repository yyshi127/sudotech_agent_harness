/** Real shipped Finance preset, tool execution, durable result, and browser card with only network/model mocked. */
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
import type {} from '@deepseek-ai/dsh-session-title'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, revealToolCallCard, webClientProfile, webSnapshotMode } from './scaffold.ts'

class VoucherAdapter extends LlmAdapter {
  constructor(readonly beyondLastPage = false, readonly withDetail = false,
    readonly networkFailure = false, readonly exportExcel = false) { super() }
  calls = 0
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    if (this.calls === 1) {
      expect(JSON.stringify(options)).toContain('不是自然语言搜索框')
      const args = JSON.stringify(this.exportExcel ? { exportExcel: true, pageSize: 100 } : {
        month: '2022-01', monthEnd: '2022-03', summary: '销售', pageSize: 2,
        ...this.beyondLastPage ? { page: 3 } : {},
      })
      const id = ToolCallId('voucher-query')
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'finance_vouchers', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'finance_vouchers', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else if (this.withDetail && this.calls === 2) {
      expect(JSON.stringify(options.messages)).toContain('voucher-1')
      const id = ToolCallId('voucher-detail')
      const args = JSON.stringify({ voucherId: 'voucher-1' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'finance_voucher_detail', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'finance_voucher_detail', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else if (this.networkFailure) {
      expect(JSON.stringify(options.messages)).toContain('财务操作未完成')
      expect(JSON.stringify(options.messages)).not.toContain('private-transport-error')
      const text = '凭证列表请求发生网络错误，本次未取得有效结果，不能判断账套没有凭证。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } else {
      const messages = JSON.stringify(options.messages)
      if (this.exportExcel) {
        expect(messages).toContain('"voucherCount":21')
        expect(messages).toContain('"rowCount":42')
        expect(messages).not.toMatch(/sha256|pageSize|pagesRead|notice|hashMatchesBytes/)
      } else {
        expect(messages).toContain(this.beyondLastPage ? 'page\\":3' : '30000.00')
        if (this.beyondLastPage) expect(messages).toContain('voucherCount\\":0')
      }
      const text = this.exportExcel ? '已将全部 21 张凭证导出为一个 Excel 文件。'
        : this.beyondLastPage ? '本页没有记录，不代表账套为空；需回到第一页核对总数。'
          : '已从演示账套查询到凭证，明细见查询结果。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it.skipIf(webClientProfile() !== 'xiaojing').each([[false, false, false, false], [true, false, false, false], [false, true, false, false], [false, false, true, false], [false, false, false, true]])('queries vouchers without leaked credentials; beyondLastPage=%s, detail=%s, networkFailure=%s, export=%s', async (beyondLastPage, withDetail, networkFailure, exportExcel) => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  const scaffold = await launchWebScaffold({ toolsMode: 'native', agentPresets: {
    default: 'standard', roots: [
      { path: fileURLToPath(new URL('../../cli/config/agent-presets', import.meta.url)), trust: 'system' },
      { path: fileURLToPath(new URL('../../cli/config/xiaojing-agent-presets', import.meta.url)), trust: 'system' },
    ],
  } })
  const browser = await chromium.launch()
  const originalFetch = globalThis.fetch
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.origin !== 'https://cwdata.yiqiyun.com') return originalFetch(input, init)
    calls.push(url.pathname)
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'snapshot-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: 'ledger-2', sobName: '演示账套' }] })
    if (withDetail && url.pathname === '/finance/certificate/info.rjson') {
      if (typeof init?.body !== 'string') throw new Error('Expected JSON body')
      expect(JSON.parse(init.body)).toEqual({ accountName: '演示账套', certificateId: 'voucher-1' })
      return Response.json({ result: 100, data: {
        accountId: 'ledger-2', certificateId: 'voucher-1', certificateDate: '2022-01-01', certificateWord: '记', certificateCode: 1,
        periods: '2022-01', auditingStatus: false, settleStatus: false, documentMaker: '测试',
        certificateLists: [
          { abstractName: '销售商品', subjectCode: '1122', subjectName: '应收账款', direction: 0, borrorMoneyStr: '30000.00' },
          { abstractName: '销售商品', subjectCode: '5001', subjectName: '主营业务收入', direction: 1, loanMoneyStr: '30000.00' },
        ],
      } })
    }
    expect(url.pathname).toBe('/finance/certificate/list.rjson')
    if (networkFailure) throw new TypeError('private-transport-error snapshot-secret')
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body')
    const body = JSON.parse(init.body) as { page: number }
    expect(body).toEqual(exportExcel ? { accountName: '演示账套', page: body.page, pageSize: 20 }
      : { accountName: '演示账套', page: beyondLastPage ? 3 : 1, pageSize: 2,
        certificateDateMonthStart: '2022-01', certificateDateMonthEnd: '2022-03', abstractName: '销售' })
    if (beyondLastPage) return Response.json({ result: 100, data: { success: true, count: 0, list: [] } })
    if (exportExcel) {
      const first = (body.page - 1) * 20
      const length = body.page === 1 ? 20 : 1
      return Response.json({ result: 100, data: { success: true, count: 21,
        list: Array.from({ length }, (_, offset) => ({
          certificateId: `voucher-${first + offset + 1}`, certificateDate: '2022-01-01',
          certificateWord: '记', certificateCode: first + offset + 1,
          entryList: [
            { abstractName: '销售商品', subjectCode: '1122', subjectName: '应收账款', direction: 0, borrorMoneyStr: '30000.00', loanMoneyStr: '' },
            { abstractName: '销售商品', subjectCode: '5001', subjectName: '主营业务收入', direction: 1, loanMoneyStr: '30000.00', borrorMoneyStr: '' },
          ],
        })),
      } })
    }
    return Response.json({ result: 100, data: { success: true, count: 1, list: [{
      certificateId: 'voucher-1', certificateDate: '2022-01-01', certificateWord: '记', certificateCode: 1,
      entryList: [
        { abstractName: '销售商品', subjectCode: '1122', subjectName: '应收账款', direction: 0, borrorMoneyStr: '30000.00', loanMoneyStr: '' },
        { abstractName: '销售商品', subjectCode: '5001', subjectName: '主营业务收入', direction: 1, loanMoneyStr: '30000.00', borrorMoneyStr: '' },
      ],
    }] } })
  }))
  try {
    const ctx = scaffold.ctx
    const workspacePath = join(scaffold.workspaceCwd, 'voucher-client')
    await mkdir(workspacePath)
    const created = await ctx.xiaojingFinanceDomain.create({ expectedRevision: 0, workspacePath,
      client: { legalName: '凭证测试企业', shortName: '凭证测试', taxpayerType: 'general-vat', registeredRegion: '上海', accountingStandard: 'enterprise', chartMappings: [], externalSystemRefs: [],
        financeSystem: { system: 'youcheng', environment: 'test', accountCode: 'ledger-2', appKey: 'snapshot-key' } },
      credentialInput: { youchengAppSecret: 'snapshot-secret' },
    })
    const adapter = new VoucherAdapter(beyondLastPage, withDetail, networkFailure, exportExcel)
    ctx.effect(() => ctx.llm.registerAdapter(['voucher-test'], adapter))
    const handle = await ctx.agents.create({ sessionId: SessionId('finance-voucher-chat'), meta: { cwd: workspacePath, agentPreset: 'finance' },
      agentOptions: { provider: 'voucher-test', model: 'voucher-test' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'finance').then(() => undefined),
    })
    try {
      const workspace = await ctx.workspaceRegistry.resolveByPath(workspacePath)
      if (workspace === undefined) throw new Error('Client workspace missing')
      await workspace.attachSession(handle.agent.session.id)
      const page = await browser.newPage({ locale: 'zh-CN' })
      // A restored blank selection can outlive the Host's unlogged client staging.
      await page.addInitScript((sessionId) => {
        localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }))
      }, handle.agent.session.id)
      await page.goto(scaffold.authenticatedUrl)
      const mode = page.getByRole('button', { name: '选择咨询模式', exact: true })
      await mode.waitFor()
      expect(await mode.textContent()).toBe('咨询')
      await page.getByRole('treeitem', { name: '新会话', exact: true }).click()
      await expect.poll(() => ctx.xiaojingFinanceDomain.sessionContext(handle.agent)).toMatchObject({
        state: 'ready', clientId: created.client.id,
      })
      await expect.poll(() => mode.textContent(), { timeout: 10_000 }).toBe('账套')
      await page.getByRole('button', { name: 'Finance模式', exact: true }).click()
      await page.getByRole('menuitem', { name: /^标准模式/ }).click()
      await page.getByRole('button', { name: '标准模式', exact: true }).waitFor()
      await mode.waitFor({ state: 'hidden' })
      await page.getByRole('button', { name: '财务助手', exact: true }).click()
      await page.getByRole('treeitem', { name: /^凭证测试/ }).hover()
      await page.getByRole('button', { name: '在“凭证测试”中新建会话', exact: true }).click()
      await page.getByRole('button', { name: 'Finance模式', exact: true }).waitFor()
      await expect.poll(() => mode.textContent()).toBe('账套')
      const client = page.getByRole('button', { name: '选择账套', exact: true })
      await expect.poll(() => client.textContent()).toBe('凭证测试-已保存账套-ID ledger-2')
      await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-vouchers/selection.expected.md', import.meta.url)),
        JSON.stringify({ preset: await page.getByRole('button', { name: 'Finance模式', exact: true }).textContent(),
          context: await mode.textContent(), client: await client.textContent() }, null, 2), webSnapshotMode())
      await page.reload({ waitUntil: 'load' })
      const catalog = await readFile(join(scaffold.harnessHome, 'finance/clients-v1.json'), 'utf8')
      const selectedModel = await ctx.sessionController.selectModel({
        sessionId: handle.agent.session.id,
        provider: 'voucher-test',
        model: 'voucher-test',
      })
      expect(selectedModel.selected).toEqual({ provider: 'voucher-test', model: 'voucher-test' })
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: exportExcel ? '导出全部凭证' : '查询2022年1月至3月摘要含销售的凭证' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      expect(adapter.calls).toBe(withDetail ? 3 : 2)
      const events = handle.agent.session.snapshotEvents()
      expect(events.find(event => event.type === 'finance/client-bound')?.data).toMatchObject({ client: { id: created.client.id } })
      expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name))
        .toEqual(withDetail ? ['finance_vouchers', 'finance_voucher_detail'] : ['finance_vouchers'])
      const results = events.filter(event => event.type === 'tool/result').map(event => event.data.message.content)
      if (!exportExcel) {
        expect(JSON.stringify(results)).toContain(networkFailure ? '财务操作未完成'
          : beyondLastPage ? 'page\\":3' : '30000.00')
      }
      expect(JSON.stringify(results)).not.toMatch(/snapshot-key|snapshot-secret|snapshot-token/)
      expect(await readFile(join(scaffold.harnessHome, 'finance/clients-v1.json'), 'utf8')).toBe(catalog)
      const pageCalls = ['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson', '/finance/certificate/list.rjson']
      expect(calls).toEqual(exportExcel ? [...pageCalls, ...pageCalls] : [...pageCalls,
        ...withDetail ? ['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson', '/finance/certificate/info.rjson'] : []])
      let resultSnapshot = JSON.stringify(results, null, 2)
      if (exportExcel) {
        const published = events.filter(event => event.type === 'finance/file-published')
        expect(published).toHaveLength(1)
        const file = published[0]!.data.file
        const bytes = await readFile(file.path)
        expect(bytes.subarray(0, 2).toString()).toBe('PK')
        expect(bytes.length).toBe(file.size)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
        const blocks = results.flat().filter(block => block.type === 'tool-result').flatMap(block => block.content)
        const text = blocks.find(block => block.type === 'text')
        if (text?.type !== 'text') throw new Error('Missing exported voucher receipt')
        const receipt = JSON.parse(text.text) as {
          accountName: string
          month: string
          voucherCount: number
          rowCount: number
          exportFile: unknown
        }
        expect(receipt).toEqual({ accountName: '演示账套', month: '不限月份', voucherCount: 21, rowCount: 42,
          exportFile: { path: file.path, name: file.name } })
        expect(text.text).not.toMatch(/sha256|pageSize|pagesRead|notice/)
        resultSnapshot = JSON.stringify({ ...receipt, exportFile: { publishedXlsx: true } }, null, 2)
      }
      const prefix = exportExcel ? 'export-' : networkFailure ? 'network-error-' : withDetail ? 'detail-' : beyondLastPage ? 'empty-page-' : ''
      await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-vouchers/${prefix}result.expected.md`, import.meta.url)),
        resultSnapshot, webSnapshotMode())
      ctx.sessionTitle.rename(handle.agent.session, '凭证查询测试')
      const selector = `[data-chat-call-id="${withDetail ? 'voucher-detail' : 'voucher-query'}"]`
      await revealToolCallCard(page, selector)
      await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-vouchers/${prefix}card.expected.md`, import.meta.url)),
        await captureStableAria(page, selector, scaffold.workspaceCwd), webSnapshotMode())
      const standard = await ctx.agents.create({ sessionId: SessionId('voucher-standard'), setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined) })
      try { expect(ctx.tools.schemas(standard.agent).some(tool => tool.name === 'finance_vouchers')).toBe(false) }
      finally { await standard.dispose() }
    } finally { await handle.dispose() }
  } finally { vi.unstubAllGlobals(); await browser.close(); await scaffold.close() }
}, 90_000)
