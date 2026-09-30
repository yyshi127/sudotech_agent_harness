/** Shipped Finance composition: mandatory master-data approval, recorded results and read-only recovery. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import { ToolCallId, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-xiaojing-finance-domain'
import type {} from '@deepseek-ai/dsh-tools'
import { MasterDataRecords, type PreparedMasterDataId, type MasterDataProposal } from '../../../packages/xiaojing/xiaojing-finance-domain/src/master-data-records.ts'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, revealToolCallCard, webClientProfile, webSnapshotMode } from './scaffold.ts'
import { financePresetDefinition } from './xiaojing-agent-presets.ts'

class MasterDataAdapter extends LlmAdapter {
  calls = 0
  preparedId = ''
  constructor(readonly kind: 'subject' | 'auxiliary-item', readonly root = false,
    readonly accounting?: 'auxiliary' | 'currency') { super() }
  get subjectCode(): string { return this.root ? '1099' : this.accounting === 'auxiliary' ? '100294' : this.accounting === 'currency' ? '100293' : '100297' }
  get proposal(): MasterDataProposal {
    return this.kind === 'subject' ? { kind: 'subject', input: { subjectCode: this.subjectCode, subjectName: '基础资料测试科目', parentCode: this.root ? null : '1002',
      subjectCategory: '1', subjectType: '流动资产', direction: 'debit', status: 'enabled', documentMaker: '施', numberUnit: null,
      ...this.accounting === undefined ? {} : { accounting: { auxiliaryCategoryCodes: this.accounting === 'auxiliary' ? ['02'] : [],
        currencyCodes: this.accounting === 'currency' ? ['USD'] : [] } } } }
      : { kind: 'auxiliary-item', input: { categoryCode: '02', itemCode: 'F3A02', itemName: '基础资料测试供应商', documentMaker: '施', status: 'enabled' } }
  }
  get revised(): MasterDataProposal {
    const value = this.proposal
    return value.kind === 'subject' ? { ...value, input: { ...value.input, subjectName: '修改后测试科目' } }
      : { ...value, input: { ...value.input, itemName: '修改后测试供应商' } }
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.calls > 0 && this.preparedId === '') {
      const result = options.messages.flatMap(message => message.content)
        .find(block => block.type === 'tool-result' && block.toolCallId === `${this.kind}-1`)
      const text = result?.type === 'tool-result' ? result.content.find(block => block.type === 'text') : undefined
      if (text?.type !== 'text') throw new Error('Missing actual preview')
      const value: unknown = JSON.parse(text.text)
      if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string') throw new Error(text.text)
      this.preparedId = value.id
    }
    const requests = [
      { name: 'finance_prepare_master_data', args: { action: 'prepare', ...this.proposal } },
      { name: 'finance_prepare_master_data', args: { action: 'revise', id: this.preparedId, version: 1, ...this.revised } },
      { name: 'finance_create_master_data', args: { id: this.preparedId, version: 1 } },
      { name: 'finance_create_master_data', args: { id: this.preparedId, version: 2 } },
      { name: 'finance_create_master_data', args: { id: this.preparedId, version: 2 } },
      { name: 'finance_prepare_master_data', args: { action: 'inspect', id: this.preparedId } },
      { name: 'finance_create_master_data', args: { id: this.preparedId, version: 2 } },
    ]
    const request = requests[this.calls++]
    if (request !== undefined) {
      const id = ToolCallId(`${this.kind}-${this.calls}`)
      const args = JSON.stringify(request.args)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: request.name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: request.name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = '已保留原发送记录。匹配内容不等于确认请求来源；未知结果不重发，辅助启用状态未核验。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it.skipIf(webClientProfile() !== 'xiaojing')('confirms exact master-data previews and preserves accepted or lost writes in the real UI', async () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  const scaffold = await launchWebScaffold({ agentPresets: { default: 'standard', definitions: [financePresetDefinition()] } })
  const browser = await chromium.launch()
  const originalFetch = globalThis.fetch
  const outputs = []
  try {
    const ctx = scaffold.ctx
    const workspacePath = join(scaffold.workspaceCwd, 'master-data-client')
    await mkdir(workspacePath)
    const created = await ctx.xiaojingFinanceDomain.create({ expectedRevision: 0, workspacePath,
      client: { legalName: '基础资料测试企业', shortName: '基础资料测试', taxpayerType: 'general-vat', registeredRegion: '上海', accountingStandard: 'enterprise',
        chartMappings: [], externalSystemRefs: [],
        financeSystem: { system: 'youcheng', environment: 'test', accountCode: '35616', appKey: 'snapshot-key' } },
      credentialInput: { youchengAppSecret: 'snapshot-secret' },
    })
    for (const scenario of ['subject', 'root-subject', 'auxiliary-item', 'auxiliary-subject', 'currency-subject'] as const) {
      const kind = scenario === 'auxiliary-item' ? 'auxiliary-item' : 'subject'
      const adapter = new MasterDataAdapter(kind, scenario === 'root-subject',
        scenario === 'auxiliary-subject' ? 'auxiliary' : scenario === 'currency-subject' ? 'currency' : undefined)
      const provider = `master-${scenario}-test`
      ctx.effect(() => ctx.llm.registerAdapter([provider], adapter))
      const handle = await ctx.agents.create({ sessionId: SessionId(`finance-master-${scenario}`),
        meta: { cwd: workspacePath, agentPreset: 'finance' }, agentOptions: { provider, model: provider },
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'finance').then(() => undefined),
      })
      const records = () => new MasterDataRecords(join(scaffold.harnessHome, 'finance/master-data-preparations'),
        `${created.client.id}/${handle.agent.session.id}`, 131072)
      let writes = 0
      let approvals = 0
      vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.origin !== 'https://cwdata.yiqiyun.com') return originalFetch(input, init)
        if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'snapshot-token' })
        if (url.pathname === '/finance/auxiliary/queryAccountList.rjson') return Response.json({ result: 100, data: [{ id: '35616', sobName: '基础资料演示账套' }] })
        if (url.pathname.includes('queryAuxiliaryCategoryList')) return Response.json({ result: 100, data: [{ id: '473815', categoryCode: '02', categoryName: '供应商' }] })
        if (url.pathname.includes('queryAuxiliaryItemList')) return Response.json({ result: 100, data: writes === 0 ? []
          : [{ id: '191568', categoryId: '473815', itemCode: 'F3A02', itemName: '修改后测试供应商' }] })
        if (url.pathname.includes('querySubjectInfoList')) {
          const fields = { subjectType: '流动资产', numberUnit: '', enableStatus: 1, balanceDirection: 0, auxiliaryList: [], currencyList: [] }
          return Response.json({ result: 100, data: [{ ...fields, subjectCode: '1002', subjectName: '银行存款', hasChild: true },
            ...adapter.accounting === 'currency' ? [{ ...fields, subjectCode: '100299', subjectName: '已有美元科目', hasChild: false,
              currencyList: [{ currencyCode: 'USD', currencyName: '美元' }] }] : [],
            ...writes === 0 ? [] : [{ ...fields, subjectCode: adapter.subjectCode, subjectName: '修改后测试科目', parentSubjectCode: adapter.root ? '' : '1002', hasChild: false,
              auxiliaryList: adapter.accounting === 'auxiliary' ? [{ id: '473815', categoryCode: '02', categoryName: '供应商' }] : [],
              currencyList: adapter.accounting === 'currency' ? [{ currencyCode: 'USD', currencyName: '美元' }] : [] }]] })
        }
        expect(url.pathname).toBe(kind === 'subject' ? '/finance/subject/add.rjson' : '/finance/auxiliary/add.rjson')
        expect(approvals).toBe(2)
        expect(writes).toBe(0)
        expect(await records().read(adapter.preparedId as PreparedMasterDataId)).toMatchObject({ phase: 'outcome-unknown', version: 2, proposal: adapter.revised })
        if (adapter.accounting !== undefined) {
          if (typeof init?.body !== 'string') throw new Error('Expected accounting JSON request')
          expect(JSON.parse(init.body)).toMatchObject({ subjectCode: adapter.subjectCode,
            auxiliaryCategorySimpleList: adapter.accounting === 'auxiliary' ? [{ categoryCode: '02', checked: true }] : [],
            foreignCurrencySimpleList: adapter.accounting === 'currency' ? [{ currencyCode: 'USD', checked: true }] : [],
            subjectAuxiliary: adapter.accounting === 'auxiliary' })
        }
        if (adapter.root) {
          if (typeof init?.body !== 'string') throw new Error('Expected root JSON request')
          expect(JSON.parse(init.body)).toEqual({ subjectCode: '1099', subjectName: '修改后测试科目',
            subjectCategory: '1', subjectType: '流动资产', balanceDirection: false, enableStatus: 1, documentMaker: '施',
            accountName: '基础资料演示账套', auxiliaryCategorySimpleList: [], foreignCurrencySimpleList: [], subjectAuxiliary: false })
        }
        writes++
        if (kind === 'auxiliary-item') throw new TypeError('Lost response', { cause: { code: 'ECONNRESET' } })
        return Response.json({ result: 100, data: '' })
      }))
      const page = await browser.newPage({ locale: 'zh-CN' })
      try {
        const workspace = await ctx.workspaceRegistry.resolveByPath(workspacePath)
        if (workspace === undefined) throw new Error('Missing workspace')
        await workspace.attachSession(handle.agent.session.id)
        await ctx.xiaojingFinanceDomain.stage(handle.agent, { mode: 'client', clientId: created.client.id })
        await page.addInitScript((sessionId) => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId })) }, handle.agent.session.id)
        await page.goto(scaffold.authenticatedUrl)
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: kind === 'subject'
          ? adapter.root ? '新建一个普通一级科目，先给我看看，改名后再确认，不改旧科目。'
            : adapter.accounting === 'auxiliary' ? '在银行存款下建供应商辅助核算科目，先预览，改名后确认。'
              : adapter.accounting === 'currency' ? '在银行存款下建美元核算科目，先预览，改名后确认，不自动添加本位币。'
                : '在银行存款下建一个普通测试科目，先给我看看，改名后再确认，不改旧科目。' : '新增测试供应商，先预览，修改名称后再确认；如果没收到结果不要重发。' }], source: { kind: 'user' } }))
        const panel = page.locator('[data-approval-key]')
        const normalize = (text: string) => text.replaceAll(adapter.preparedId, '<prepared-id>').replaceAll(created.client.id, '<client-id>')
        let previousKey: string | null = null
        for (const label of [/^(拒绝|Reject)$/, /^(允许一次|Allow once)$/]) {
          await panel.waitFor()
          await expect.poll(() => panel.getAttribute('data-approval-key')).not.toBe(previousKey)
          previousKey = await panel.getAttribute('data-approval-key')
          const approvalText = await panel.textContent()
          for (const value of ['基础资料演示账套', kind === 'subject' ? '会计科目' : '辅助核算项目', '修改后测试']) {
            expect(approvalText).toContain(value)
          }
          if (adapter.root) {
            expect(approvalText).toContain('一级科目')
            expect(approvalText).toContain('1099')
          }
          if (adapter.accounting !== undefined) {
            expect(approvalText).toContain(adapter.accounting === 'currency' ? '外币核算：美元（USD）' : '辅助核算：供应商')
          }
          expect(approvalText).not.toMatch(/"version"|"proposal"|"references"|prepared-id|snapshot-key|snapshot-secret/)
          expect(writes).toBe(0)
          expect(await records().read(adapter.preparedId as PreparedMasterDataId)).toMatchObject({ phase: 'prepared', version: 2 })
          if (approvals === 0 && kind === 'subject') {
            const assembly = await handle.agent.ctx.systemPrompt.assemble({ agent: handle.agent, scope: handle.agent })
            const rules = assembly.sections.find(section => section.name === 'xiaojing:finance-read-evidence')?.text
            expect(rules).toContain('不能调用报销模块的users/staff接口来核实财务成员')
            if (rules === undefined) throw new Error('Missing actual Finance context')
            await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-master-data-preparation/context.expected.md', import.meta.url)),
              rules, webSnapshotMode())
          }
          if (approvals === 0) await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-master-data-preparation/${scenario}-approval.expected.md`, import.meta.url)),
            normalize(await captureStableAria(page, '[data-approval-key]', scaffold.workspaceCwd)), webSnapshotMode())
          approvals++
          await panel.getByRole('button', { name: label }).click()
          await expect.poll(() => handle.agent.session.snapshotEvents().filter(event => event.type === 'approval/decided').length).toBe(approvals)
        }
        await handle.agent.whenIdle()
        expect(adapter.calls).toBe(8)
        expect(writes).toBe(1)
        const results = handle.agent.session.snapshotEvents().filter(event => event.type === 'tool/result').map(event => event.data.message.content)
        expect(results).toHaveLength(7)
        expect(JSON.stringify(results[2])).toContain('版本')
        expect(JSON.stringify(results[3])).toContain('未获得')
        expect(JSON.stringify(results[6])).toContain('发送记录')
        const durable = await records().read(adapter.preparedId as PreparedMasterDataId)
        expect(durable).toMatchObject({ phase: kind === 'subject' ? 'accepted' : 'outcome-unknown', version: 2 })
        const text = results[5]?.flatMap(block => block.type === 'tool-result' ? block.content : []).find(block => block.type === 'text')
        if (text?.type !== 'text') throw new Error('Missing actual readback')
        expect(JSON.parse(text.text)).toMatchObject({ phase: durable.phase, complete: kind === 'subject', readback: { content: 'matched' } })
        expect(JSON.stringify(results)).not.toMatch(/snapshot-key|snapshot-secret|snapshot-token|configurationDigest/)
        const selector = `[data-chat-call-id="${kind}-5"]`
        const card = page.locator(selector)
        await revealToolCallCard(page, selector)
        await expect.poll(() => card.textContent()).toContain(kind === 'subject' ? '已完成并核对' : '结果待确认')
        await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/finance-master-data-preparation/${scenario}-result-card.expected.md`, import.meta.url)),
          normalize(await captureStableAria(page, selector, scaffold.workspaceCwd)), webSnapshotMode())
        outputs.push({ kind, ...adapter.root ? { root: true } : {},
          ...adapter.accounting === undefined ? {} : { accounting: adapter.accounting }, writes,
          results: JSON.parse(normalize(JSON.stringify(results))) as unknown })
      } finally { await page.close(); await handle.dispose() }
    }
    await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-master-data-preparation/results.expected.md', import.meta.url)),
      JSON.stringify(outputs, null, 2), webSnapshotMode())
    const standard = await ctx.agents.create({ sessionId: SessionId('master-standard'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined) })
    try { expect(ctx.tools.schemas(standard.agent).some(tool => ['finance_prepare_master_data', 'finance_create_master_data'].includes(tool.name))).toBe(false) }
    finally { await standard.dispose() }
  } finally {
    vi.unstubAllGlobals()
    await browser.close()
    await scaffold.close()
    vi.unstubAllEnvs()
  }
}, 120_000)
