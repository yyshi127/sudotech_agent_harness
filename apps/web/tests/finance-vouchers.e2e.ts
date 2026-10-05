/** Real shipped Finance preset, tool execution, durable result, and browser card with only network/model mocked. */
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Locator, type Page } from 'playwright'
import { expect, it, vi } from 'vitest'
import { ToolCallId, createUserMessage, LlmAdapter, type GenerateOptions, type LlmModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-xiaojing-finance-domain'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session-title'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, revealToolCallCard, webClientProfile, webSnapshotMode } from './scaffold.ts'
import { financePresetDefinition } from './xiaojing-agent-presets.ts'

/** Require painted headings and data, then select and copy an actual exported cell. */
async function expectVoucherPreview(page: Page, excel: Locator): Promise<void> {
  await excel.locator('.luckysheet-sheets-item-name').getByText('凭证分录', { exact: true }).waitFor()
  await expect.poll(() => excel.evaluate((node) => {
    const canvas = node.querySelector('canvas')!
    const bounds = canvas.getBoundingClientRect()
    const scale = canvas.width / bounds.width
    const columnHeader = node.querySelector<HTMLElement>('.fortune-col-header')!
    const rowHeader = node.querySelector<HTMLElement>('.fortune-row-header')!
    const left = Number.parseFloat(rowHeader.style.width) + 1.5
    const top = Number.parseFloat(columnHeader.style.height) + 1.5
    const context = canvas.getContext('2d')!
    const ink = (x: number, y: number, width: number, height: number): number => {
      const pixels = context.getImageData(Math.round(x * scale), Math.round(y * scale),
        Math.round(width * scale), Math.round(height * scale)).data
      let count = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i]! < 120 && pixels[i + 1]! < 120 && pixels[i + 2]! < 120 && pixels[i + 3]! > 0) count += 1
      }
      return count / scale ** 2
    }
    // Exclude grid lines and the selection outline: only dark text counts.
    return { heading: ink(left + 8, top + 3, 70, 14) > 10,
      firstDate: ink(left + 8, top + 23, 70, 14) > 10, rowNumber: ink(12, top + 3, 16, 14) > 2 }
  }), { timeout: 15_000 }).toEqual({ heading: true, firstDate: true, rowNumber: true })
  const origin = await excel.evaluate((node) => {
    const left = Number.parseFloat(node.querySelector<HTMLElement>('.fortune-row-header')!.style.width) + 1.5
    const top = Number.parseFloat(node.querySelector<HTMLElement>('.fortune-col-header')!.style.height) + 1.5
    return { left, top }
  })
  const overlay = excel.locator('.fortune-sheet-overlay')
  await overlay.click({ position: { x: origin.left + 35, y: origin.top + 30 } })
  await expect.poll(() => excel.locator('.fortune-name-box').innerText()).toBe('A2')
  await expect.poll(() => excel.locator('.fortune-fx-input').innerText()).toBe('2022-01-01')
  await page.keyboard.press('ControlOrMeta+C')
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).trim())).toBe('2022-01-01')
}

class VoucherAdapter extends LlmAdapter {
  constructor(readonly beyondLastPage = false, readonly withDetail = false,
    readonly networkFailure = false, readonly exportExcel = false) { super() }
  calls = 0
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: 'voucher-test', name: 'voucher-test' }])
  }
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
        const receipt = options.messages.filter(message => message.role === 'tool')
          .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
        expect(receipt).toContain('"voucherCount":21')
        expect(receipt).toContain('"rowCount":42')
        expect(receipt).not.toMatch(/sha256|pageSize|pagesRead|notice|hashMatchesBytes/)
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
    default: 'standard', definitions: [financePresetDefinition()],
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
      const page = await browser.newPage({ locale: 'zh-CN', ...exportExcel ? { viewport: { width: 1680, height: 1000 } } : {} })
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
      if (exportExcel) expect(events.filter(event => event.type === 'turn/end').at(-1)?.data.reason).toEqual({ kind: 'completed' })
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
        const blocks = results.flat()
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
      if (exportExcel) {
        const file = events.find(event => event.type === 'finance/file-published')!.data.file
        const evidence = fileURLToPath(new URL('../../../tmp/voucher-preview-regression/', import.meta.url))
        await mkdir(evidence, { recursive: true })
        try {
          const delivery = page.locator('[data-finance-published-file]').getByRole('button')
          await expect.poll(() => delivery.textContent()).toBe(`打开财务成果 · ${file.name}`)
          await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin })
          await delivery.click()
          const preview = page.locator('[data-textpreview-url]')
          await expect.poll(async () => decodeURI(await preview.getAttribute('data-textpreview-url') ?? '')).toContain(file.name)
          const excel = preview.locator('[data-excel-preview]')
          await expectVoucherPreview(page, excel)
          await page.locator('[data-dockkit-tab-close]').click()
          await excel.waitFor({ state: 'hidden' })
          await delivery.click()
          await expectVoucherPreview(page, excel)
        } catch (error) {
          await page.screenshot({ path: join(evidence, `failure-${process.pid}.png`), fullPage: true })
          throw error
        }
        await page.screenshot({ path: join(evidence, `success-${process.pid}.png`), fullPage: true })
        expect(createHash('sha256').update(await readFile(file.path)).digest('hex')).toBe(file.sha256)
      }
      const standard = await ctx.agents.create({ sessionId: SessionId('voucher-standard'), setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined) })
      try { expect(ctx.tools.schemas(standard.agent).some(tool => tool.name === 'finance_vouchers')).toBe(false) }
      finally { await standard.dispose() }
    } finally { await handle.dispose() }
  } finally { vi.unstubAllGlobals(); await browser.close(); await scaffold.close() }
}, 90_000)
