/** Real Finance composition with mocked vendor transfers, versioned approval and durable recovery. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import { ToolCallId, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-xiaojing-finance-domain'
import type {} from '@deepseek-ai/dsh-tools'
import { VoucherRecords, type PreparedVoucherId } from '../../../packages/xiaojing/xiaojing-finance-domain/src/voucher-records.ts'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, revealToolCallCard, webClientProfile, webSnapshotMode } from './scaffold.ts'
import { financePresetDefinition } from './xiaojing-agent-presets.ts'

const proposal = { date: '2026-09-09', documentMaker: '测试员', sourcePaths: [], entries: [
  { summary: '银行取现', subjectCode: '1001', side: 'debit', amount: '0.30', auxiliary: [] },
  { summary: '银行取现', subjectCode: '1002', side: 'credit', amount: '0.30', auxiliary: [] },
] }
const foreignProposal = { ...proposal, entries: proposal.entries.map((row, index) => index === 0
  ? { ...row, subjectCode: '100299', foreignCurrency: { code: 'USD', amount: '0.20', exchangeRate: '1.5' } } : row) }
type CreationMode = 'accepted' | 'response-loss' | 'changed-preview' | 'read-failed' | 'originals' | 'upload-failed' | 'foreign' | 'cancel-after-send'

class PreparationAdapter extends LlmAdapter {
  calls = 0
  recovering = false
  creating: CreationMode | undefined
  recoveryRun = 0
  preparedId = ''
  expectedSkill = ''
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const messages = JSON.stringify(options.messages)
    if (this.calls === 0 && !this.recovering && this.creating === undefined) {
      expect(this.expectedSkill).not.toBe('')
      expect(options.messages.flatMap(message => message.content)
        .some(block => block.type === 'text' && block.text.includes(this.expectedSkill))).toBe(true)
    }
    if (this.calls > 0 && this.preparedId === '') {
      const result = options.messages.find(message => message.role === 'tool' && message.source.callId === (this.creating ? `creation-${this.creating}-1` : 'preparation-1'))
      const preview = result?.content.find(block => block.type === 'text')
      if (preview?.type !== 'text') throw new Error('Missing actual preparation result')
      const value: unknown = JSON.parse(preview.text)
      if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string') {
        throw new Error('Missing actual preparation ID')
      }
      this.preparedId = value.id
    }
    const requests = this.creating ? [
      { action: 'prepare', input: { ...(this.creating === 'foreign' ? foreignProposal : proposal), certificateCode: 36,
        sourcePaths: this.creating === 'originals' || this.creating === 'upload-failed' ? ['invoice.pdf', 'invoice.png'] : [] } },
      { id: this.preparedId, version: 1 },
      { id: this.preparedId, version: 1 },
      this.creating === 'upload-failed' ? { action: 'inspect', id: this.preparedId } : { id: this.preparedId, version: 1 },
    ] : this.recovering ? [{ action: 'inspect', id: this.preparedId }] : [
      { action: 'prepare', input: proposal },
      { action: 'revise', id: this.preparedId, version: 1, input: { ...proposal, documentMaker: '已更正制单人', certificateCode: 35 } },
      { action: 'revise', id: this.preparedId, version: 1, input: proposal },
      { action: 'inspect', id: this.preparedId },
      { action: 'submit', id: this.preparedId },
    ]
    const request = requests[this.calls++]
    if (request !== undefined) {
      const args = JSON.stringify(request)
      const id = ToolCallId(this.creating ? `creation-${this.creating}-${this.calls}`
        : this.recovering ? `recovery-${this.recoveryRun}-${this.calls}` : `preparation-${this.calls}`)
      const name = this.creating && this.calls > 1 && !(this.creating === 'upload-failed' && this.calls === 4)
        ? 'finance_create_voucher' : 'finance_prepare_voucher'
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      expect(messages).toContain('已更正制单人')
      expect(messages).toContain('未创建有成凭证')
      const text = this.creating ? '仅按已确认版本处理，原发送记录不能重发；接收和完整核验是不同状态。'
        : this.recovering ? '已查看原提交记录，没有重新发送；完整核验仍未完成。'
          : '本地预览已更新为第2版，借贷均为0.30；旧版本修改已拒绝。尚未创建有成凭证，期间和原件等检查仍待完成。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it.skipIf(webClientProfile() !== 'xiaojing')('prepares, confirms and recovers vouchers with originals and no duplicate sending', async () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  const scaffold = await launchWebScaffold({ agentPresets: { default: 'standard', definitions: [financePresetDefinition()] } })
  const browser = await chromium.launch()
  const originalFetch = globalThis.fetch
  const paths: string[] = []
  let failReadback = false
  let createMode: CreationMode | undefined
  let createdNumber = 35
  let beforeCreate: (() => Promise<void>) | undefined
  let beforeUpload: (() => void) | undefined
  let cancelAfterSend: (() => void) | undefined
  let uploaded: Uint8Array[] = []
  const originalBytes = [Buffer.from('%PDF-1.4\nF2 original fixture'), Buffer.from('89504e470d0a1a0a', 'hex')]
  vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.origin === 'https://yiqicai.oss-cn-zhangjiakou.aliyuncs.com') {
      expect(createMode).toBe('originals')
      expect(init?.method).toBe('GET')
      expect(init?.redirect).toBe('error')
      return new Response(originalBytes[url.pathname === '/one.pdf' ? 0 : 1])
    }
    if (url.origin === 'https://attachments.example.com') {
      if (beforeUpload === undefined) throw new Error('Unexpected OSS request')
      beforeUpload()
      expect(init?.method).toBe('PUT')
      expect(init?.redirect).toBe('error')
      expect(url.searchParams.get('x-oss-signature-version')).toBe('OSS4-HMAC-SHA256')
      if (!(init?.body instanceof Uint8Array)) throw new Error('Expected original bytes')
      expect(new Headers(init.headers).get('Content-Type')).toBe(uploaded.length === 0 ? 'application/pdf' : 'image/png')
      uploaded.push(init.body)
      return new Response(null, { status: createMode === 'upload-failed' && uploaded.length === 2 ? 403 : 200 })
    }
    if (url.origin !== 'https://cwdata.yiqiyun.com') return originalFetch(input, init)
    paths.push(url.pathname)
    if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'snapshot-token' })
    if (url.pathname === '/finance/auxiliary/queryAccountList.rjson') {
      return Response.json({ result: 100, data: [{ id: 'prepare-ledger', sobName: '凭证准备演示' }] })
    }
    if (url.pathname === '/finance/certificate/info.rjson' && failReadback) return Response.json({ result: 200 })
    if (url.pathname === '/finance/certificate/createCertificate.rjson') {
      if (beforeCreate === undefined) throw new Error('Unexpected write without pre-send assertion')
      await beforeCreate()
      expect(typeof init?.body).toBe('string')
      expect(JSON.parse(init!.body as string)).toMatchObject({ certificateCode: 36, accountName: '凭证准备演示', appId: 'xiaojing-accounting' })
      if (createMode === 'foreign') expect(JSON.parse(init!.body as string)).toMatchObject({ entryList: [
        { subjectCode: '100299', borrorMoney: 0.3, currencyCode: 'USD', originalCurrencyAmount: 0.2, exchangeRate: 1.5 },
        { subjectCode: '1002', loanMoney: 0.3 },
      ] })
      if (createMode === 'originals') {
        const payload = JSON.parse(init!.body as string) as { attachmentUrlList: string[] }
        expect(payload.attachmentUrlList).toHaveLength(2)
        for (const [index, link] of payload.attachmentUrlList.entries()) {
          const url = new URL(link)
          const extension = index === 0 ? 'pdf' : 'png'
          expect(decodeURIComponent(url.pathname)).toMatch(new RegExp(`/invoice\\.${extension}$`, 'u'))
          expect(url.searchParams.has('OSSAccessKeyId')).toBe(true)
          expect(url.searchParams.has('x-oss-credential')).toBe(false)
          expect(url.searchParams.has('response-content-type')).toBe(false)
          const decoded = decodeURIComponent(url.href)
          expect(decoded.slice(decoded.lastIndexOf('/') + 1)).toMatch(new RegExp(`\\.${extension}$`, 'u'))
        }
      }
      createdNumber = 36
      if (createMode === 'response-loss') throw new TypeError('Lost response', { cause: { code: 'ECONNRESET' } })
      if (createMode === 'cancel-after-send') {
        if (cancelAfterSend === undefined) throw new Error('Missing cancellation at response receipt')
        cancelAfterSend()
      }
      return Response.json({ result: 100, data: '270826' })
    }
    if (url.pathname === '/finance/certificate/info.rjson') return Response.json({ result: 100, data: {
      accountId: 'prepare-ledger', certificateId: createdNumber === 35 ? '270825' : '270826', certificateWord: '记', certificateCode: createdNumber,
      certificateDate: proposal.date, periods: '2026-09', auditingStatus: false, settleStatus: false,
      documentMaker: createdNumber === 35 ? '已更正制单人' : '测试员', certificateLists: (createMode === 'foreign' ? foreignProposal : proposal).entries.map(row => ({
        auxiliaryList: [], currencyCode: 'foreignCurrency' in row ? 'USD' : '',
        ...'foreignCurrency' in row ? { originalCurrencyAmount: 0.2, exchangeRate: 1.5 } : {},
        abstractName: row.summary, subjectCode: row.subjectCode, subjectName: '测试科目', direction: row.side === 'debit' ? 0 : 1,
        borrorMoneyStr: row.side === 'debit' ? row.amount : '0.00', loanMoneyStr: row.side === 'credit' ? row.amount : '0.00',
      })),
      attachmentList: createMode === 'originals' ? [
        { downloadUrl: 'https://yiqicai.oss-cn-zhangjiakou.aliyuncs.com/one.pdf', fileName: 'x-oss-signature=PRIVATE', fileSize: '0' },
        { downloadUrl: 'https://yiqicai.oss-cn-zhangjiakou.aliyuncs.com/two.png', fileSize: '0' },
      ] : [],
    } })
    expect(url.pathname).toBe('/finance/auxiliary/querySubjectInfoList.rjson')
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body')
    expect(JSON.parse(init.body)).toMatchObject({ setOfBooksId: 'prepare-ledger', sobName: '凭证准备演示' })
    return Response.json({ result: 100, data: [
      { subjectCode: '1001', subjectName: '库存现金', enableStatus: '1', hasChild: false, auxiliaryList: [], currencyList: [] },
      { subjectCode: '1002', subjectName: '银行存款', enableStatus: '1', hasChild: false, auxiliaryList: [], currencyList: [] },
      { subjectCode: '100299', subjectName: '外币测试', enableStatus: '1', hasChild: false, auxiliaryList: [],
        currencyList: [{ currencyCode: 'USD', currencyName: '美元' }] },
    ] })
  }))
  try {
    const ctx = scaffold.ctx
    const workspacePath = join(scaffold.workspaceCwd, 'preparation-client')
    await mkdir(workspacePath)
    const created = await ctx.xiaojingFinanceDomain.create({ expectedRevision: 0, workspacePath,
      client: { legalName: '凭证准备测试企业', shortName: '凭证准备测试', taxpayerType: 'general-vat', registeredRegion: '上海', accountingStandard: 'enterprise',
        chartMappings: [], externalSystemRefs: [],
        financeSystem: { system: 'youcheng', environment: 'test', accountCode: 'prepare-ledger', appKey: 'snapshot-key' } },
      credentialInput: { youchengAppSecret: 'snapshot-secret' },
    })
    const adapter = new PreparationAdapter()
    ctx.effect(() => ctx.llm.registerAdapter(['preparation-test'], adapter))
    const handle = await ctx.agents.create({ sessionId: SessionId('finance-preparation-chat'),
      meta: { cwd: workspacePath, agentPreset: 'finance' }, agentOptions: { provider: 'preparation-test', model: 'preparation-test' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'finance').then(() => undefined),
    })
    try {
      cancelAfterSend = () => { handle.agent.cancel({ kind: 'user' }) }
      const workspace = await ctx.workspaceRegistry.resolveByPath(workspacePath)
      if (workspace === undefined) throw new Error('Missing workspace')
      await workspace.attachSession(handle.agent.session.id)
      await ctx.xiaojingFinanceDomain.stage(handle.agent, { mode: 'client', clientId: created.client.id })
      const skill = await ctx.skills.get('finance-voucher-draft', { scope: handle.agent })
      if (skill === undefined) throw new Error('Missing shipped voucher skill')
      adapter.expectedSkill = skill.content
      await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-voucher-preparation/skill.expected.md', import.meta.url)),
        skill.content, webSnapshotMode())
      const before = await readFile(join(scaffold.harnessHome, 'finance/clients-v1.json'), 'utf8')
      handle.agent.followup(createUserMessage({ content: [{ type: 'text',
        text: '/finance-voucher-draft\n先拟一张今天银行取现三毛钱的凭证，制单人测试员，没附件，别提交。' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      expect(adapter.calls).toBe(6)
      const events = handle.agent.session.snapshotEvents()
      const results = events.filter(event => event.type === 'tool/result').map(event => event.data.message.content)
      expect(results).toHaveLength(5)
      const first = results[0]?.find(block => block.type === 'text')
      if (first?.type !== 'text') throw new Error('Missing preview')
      expect(JSON.parse(first.text)).toMatchObject({ id: adapter.preparedId, version: 1, totalDebit: '0.30', phase: 'prepared' })
      expect(JSON.parse(first.text)).toMatchObject({ missingFields: ['certificateCode'] })
      expect(JSON.stringify(results[2])).toContain('版本')
      expect(JSON.stringify(results[3])).toContain('已更正制单人')
      const inspected = results[3]?.find(block => block.type === 'text')
      if (inspected?.type !== 'text') throw new Error('Missing updated preview')
      expect(JSON.parse(inspected.text)).toMatchObject({ version: 2, missingFields: [], input: { certificateCode: 35 } })
      expect(JSON.stringify(results)).not.toMatch(/snapshot-key|snapshot-secret|snapshot-token|configurationDigest/)
      expect(paths.length).toBeGreaterThan(0)
      expect(await readFile(join(scaffold.harnessHome, 'finance/clients-v1.json'), 'utf8')).toBe(before)
      const normalize = (value: string) => value.replaceAll(adapter.preparedId, '<prepared-id>')
      await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-voucher-preparation/result.expected.md', import.meta.url)),
        normalize(JSON.stringify(results, null, 2)), webSnapshotMode())
      const page = await browser.newPage({ locale: 'zh-CN' })
      await page.addInitScript((sessionId) => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId })) }, handle.agent.session.id)
      await page.goto(scaffold.authenticatedUrl)
      const card = page.locator('[data-chat-call-id="preparation-1"]')
      await revealToolCallCard(page, '[data-chat-call-id="preparation-1"]')
      await expect.poll(() => card.textContent()).toContain('已准备，等待确认')
      await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-voucher-preparation/card.expected.md', import.meta.url)),
        normalize(await captureStableAria(page, '[data-chat-call-id="preparation-1"]', scaffold.workspaceCwd)), webSnapshotMode())
      const records = new VoucherRecords(join(scaffold.harnessHome, 'finance/voucher-preparations'),
        `${created.client.id}/${handle.agent.session.id}`, { maxEntries: 100, maxBytes: 131072 })
      const record = await records.read(adapter.preparedId as PreparedVoucherId)
      await records.reserve(record.id, record.version, record.configurationDigest, async () => ({ accountId: 'prepare-ledger',
        identity: { accountName: '凭证准备演示', appId: 'snapshot-source', flowId: record.id, attachmentUrls: [] } }))
      const recoveryResults = []
      for (const state of ['unknown', 'accepted', 'read-failed'] as const) {
        if (state === 'accepted') await records.recordOutcome(record.id, record.version, { state: 'accepted', voucherId: '270825' })
        failReadback = state === 'read-failed'
        adapter.calls = 0
        adapter.recovering = true
        adapter.recoveryRun++
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '查看刚才的提交记录，不要重发。' }], source: { kind: 'user' } }))
        await handle.agent.whenIdle()
        expect(adapter.calls).toBe(2)
        const result = handle.agent.session.snapshotEvents().filter(event => event.type === 'tool/result').at(-1)
        if (result?.type !== 'tool/result') throw new Error('Missing recovery result')
        const content = result.data.message.content
        const recovered = content
          .find(block => block.type === 'text')
        if (recovered?.type !== 'text') throw new Error('Missing structured recovery output')
        if (state === 'read-failed') {
          expect(recovered.text).toContain('失败不等于凭证不存在')
          expect(await records.read(record.id)).toMatchObject({ phase: 'accepted', outcome: { voucherId: '270825' } })
        } else {
          expect(JSON.parse(recovered.text)).toMatchObject({ complete: state === 'accepted', version: 2,
            phase: state === 'unknown' ? 'outcome-unknown' : 'accepted' })
          expect(recovered.text).toContain(state === 'unknown' ? 'outcome-unknown' : 'matched')
        }
        expect(JSON.stringify(content)).not.toMatch(/snapshot-key|snapshot-secret|snapshot-token|configurationDigest|attachmentUrls/)
        recoveryResults.push(content)
      }
      await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-voucher-preparation/recovery.expected.md', import.meta.url)),
        normalize(JSON.stringify(recoveryResults, null, 2)), webSnapshotMode())
      expect(paths.every(path => !path.includes('createCertificate'))).toBe(true)
      const creationResults = []
      const fixturePaths = new Map<string, string>()
      await ctx.xiaojingFinanceDomain.saveAttachmentStorage({ expectedRevision: 0, config: {
        bucket: 'fixture-bucket', region: 'oss-cn-hangzhou', endpoint: 'https://attachments.example.com', prefix: 'fixture/' },
      accessKeyId: 'fixtureAccessKey123', accessKeySecret: 'fixtureSecret123' })
      await mkdir(ctx.xiaojingFinanceDomain.localUploadRoot(), { recursive: true })
      for (const [index, name] of ['invoice.pdf', 'invoice.png'].entries()) {
        const bytes = originalBytes[index]
        if (bytes === undefined) throw new Error('Missing original fixture')
        const path = join(ctx.xiaojingFinanceDomain.localUploadRoot(), name)
        await writeFile(path, bytes)
        const imported = await ctx.xiaojingFinanceDomain.importUpload(handle.agent, { path, originalName: name })
        fixturePaths.set(imported.path, `<workspace>/preparation-client/02-原始资料/${name}`)
      }
      const unsupportedSource = join(ctx.xiaojingFinanceDomain.localUploadRoot(), 'contract.docx')
      await writeFile(unsupportedSource, Buffer.from('unsupported fixture'))
      const unsupportedImported = await ctx.xiaojingFinanceDomain.importUpload(handle.agent,
        { path: unsupportedSource, originalName: 'contract.docx' })
      await expect(ctx.xiaojingFinanceDomain.prepareVoucher(handle.agent, { action: 'prepare', input: {
        ...proposal, sourcePaths: [unsupportedImported.path],
      } }, new AbortController().signal, { maxEntries: 100, maxBytes: 131072 }))
        .rejects.toThrow('来源文件仅支持 PDF、PNG、JPG 或 JPEG')
      for (const mode of ['accepted', 'response-loss', 'changed-preview', 'read-failed', 'originals', 'upload-failed', 'foreign', 'cancel-after-send'] as const) {
        createMode = mode
        failReadback = mode === 'read-failed'
        adapter.creating = mode
        adapter.recovering = false
        adapter.preparedId = ''
        adapter.calls = 0
        uploaded = []
        let approvals = 0
        const writesBefore = paths.filter(path => path.includes('createCertificate')).length
        const disposeApproval = mode === 'accepted' ? undefined : ctx.on('approval/request', async (req) => {
          expect(req.toolName).toBe('finance_create_voucher')
          for (const value of ['凭证准备演示', '凭证号：36', '借方合计：0.30', '贷方合计：0.30']) {
            expect(req.reason).toContain(value)
          }
          if (mode === 'foreign') {
            expect(req.reason).toContain('原币：USD；原币金额：0.20；汇率：1.5；本位币金额：0.30')
          }
          expect(req.reason).not.toMatch(/"version"|"certificateCode"|snapshot-key|snapshot-secret/)
          expect(paths.filter(path => path.includes('createCertificate'))).toHaveLength(writesBefore)
          approvals++
          if (approvals === 1) return 'rejected'
          if (mode === 'changed-preview') {
            await ctx.xiaojingFinanceDomain.prepareVoucher(handle.agent, { action: 'revise', id: adapter.preparedId, version: 1,
              input: { ...proposal, certificateCode: 37 } }, new AbortController().signal, { maxEntries: 100, maxBytes: 131072 })
          }
          return 'allowed-once'
        }, { prepend: true })
        beforeCreate = async () => {
          expect(approvals).toBe(2)
          expect(await records.read(adapter.preparedId as PreparedVoucherId)).toMatchObject({ phase: 'outcome-unknown', version: 1,
            submission: { identity: { flowId: adapter.preparedId }, payload: { certificateCode: 36 } } })
        }
        beforeUpload = () => { expect(approvals).toBe(2) }
        const eventsBefore = handle.agent.session.snapshotEvents().length
        try {
          handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '请创建刚才预览的凭证，需要确认时展示完整内容。' }], source: { kind: 'user' } }))
          if (mode === 'accepted') {
            const panel = page.locator('[data-approval-key]')
            let previousKey: string | null = null
            for (const choice of [
              { label: /^(拒绝|Reject)$/, outcome: 'rejected' },
              { label: /^(允许一次|Allow once)$/, outcome: 'allowed-once' },
            ] as const) {
              await panel.waitFor()
              await expect.poll(() => panel.getAttribute('data-approval-key')).not.toBe(previousKey)
              previousKey = await panel.getAttribute('data-approval-key')
              const previewText = await panel.textContent()
              for (const value of ['凭证准备演示', '凭证号：36', '借方合计：0.30', '贷方合计：0.30', '库存现金', '银行存款']) {
                expect(previewText).toContain(value)
              }
              expect(previewText).not.toMatch(/"version"|"certificateCode"|prepared-id|snapshot-key|snapshot-secret/)
              expect(paths.filter(path => path.includes('createCertificate'))).toHaveLength(writesBefore)
              expect(await records.read(adapter.preparedId as PreparedVoucherId)).toMatchObject({ phase: 'prepared', version: 1 })
              if (approvals === 0) {
                await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-voucher-preparation/approval.expected.md', import.meta.url)),
                  normalize(await captureStableAria(page, '[data-approval-key]', scaffold.workspaceCwd))
                    .replaceAll(created.client.id, '<client-id>'), webSnapshotMode())
              }
              approvals++
              await panel.getByRole('button', { name: choice.label }).click()
              await expect.poll(() => handle.agent.session.snapshotEvents().slice(eventsBefore)
                .filter(event => event.type === 'approval/decided').length).toBe(approvals)
              expect(JSON.stringify(handle.agent.session.snapshotEvents().slice(eventsBefore)
                .filter(event => event.type === 'approval/decided').at(-1))).toContain(choice.outcome)
            }
          }
          await handle.agent.whenIdle()
          if (mode === 'cancel-after-send') {
            expect(approvals).toBe(2)
            expect(paths.filter(path => path.includes('createCertificate'))).toHaveLength(writesBefore + 1)
            const retained = await records.read(adapter.preparedId as PreparedVoucherId)
            expect(retained).toMatchObject({ phase: 'accepted', outcome: { state: 'accepted', voucherId: '270826' } })
            const recovered = await ctx.xiaojingFinanceDomain.prepareVoucher(handle.agent,
              { action: 'inspect', id: retained.id }, new AbortController().signal, { maxEntries: 100, maxBytes: 131072 })
            expect(recovered).toMatchObject({ complete: true, outcome: { voucherId: '270826' } })
            await expect(ctx.xiaojingFinanceDomain.createVoucher(handle.agent, { id: retained.id, version: 1 },
              new AbortController().signal, { maxEntries: 100, maxBytes: 131072 })).rejects.toThrow('不得重复提交')
            expect(paths.filter(path => path.includes('createCertificate'))).toHaveLength(writesBefore + 1)
            creationResults.push({ mode, phase: retained.phase, outcome: retained.outcome, recovered: true, writes: 1 })
            continue
          }
          expect(adapter.calls).toBe(5)
          expect(approvals).toBe(2)
          const prevented = mode === 'changed-preview' || mode === 'upload-failed'
          expect(paths.filter(path => path.includes('createCertificate'))).toHaveLength(writesBefore + (prevented ? 0 : 1))
          const durable = await records.read(adapter.preparedId as PreparedVoucherId)
          expect(durable.phase).toBe(prevented ? 'prepared' : mode === 'response-loss' ? 'outcome-unknown' : 'accepted')
          const creationEvents = handle.agent.session.snapshotEvents().slice(eventsBefore)
          if (mode === 'accepted') {
            await expect.poll(() => page.locator('[data-approval-key]').count()).toBe(0)
            const submittedCard = page.locator('[data-chat-call-id="creation-accepted-3"]')
            await revealToolCallCard(page, '[data-chat-call-id="creation-accepted-3"]')
            await expect.poll(() => submittedCard.textContent()).toContain('已完成并核对')
            expect(await submittedCard.textContent()).not.toContain('270826')
            await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-voucher-preparation/submitted-card.expected.md', import.meta.url)),
              normalize(await captureStableAria(page, '[data-chat-call-id="creation-accepted-3"]', scaffold.workspaceCwd)), webSnapshotMode())
          }
          const outputs = creationEvents.filter(event => event.type === 'tool/result').map(event => event.data.message.content)
          expect(JSON.stringify(outputs[1])).toContain('未获得')
          expect(JSON.stringify(outputs[3])).toContain(mode === 'upload-failed' ? 'uploadedOriginals' : '不得重复提交')
          const submitted = outputs[2]?.find(block => block.type === 'text')
          if (submitted?.type !== 'text') throw new Error('Missing create outcome')
          if (mode === 'accepted' || mode === 'read-failed' || mode === 'originals' || mode === 'foreign') {
            const complete = mode === 'accepted' || mode === 'foreign'
            expect(JSON.parse(submitted.text)).toMatchObject({ complete, outcome: { state: 'accepted', voucherId: '270826' },
              readback: { accounting: mode === 'read-failed' ? 'unavailable' : 'matched', complete,
                ...mode === 'read-failed' ? {} : { auxiliary: 'matched', currency: 'matched' } } })
          }
          expect(JSON.stringify(outputs)).not.toMatch(/snapshot-key|snapshot-secret|snapshot-token|configurationDigest|attachmentUrls/)
          expect(JSON.stringify(outputs)).not.toMatch(/x-oss-signature|fixtureSecret123|fixtureAccessKey123/)
          expect(creationEvents.filter(event => event.type === 'approval/decided')).toHaveLength(2)
          let serialized = JSON.stringify(outputs).replaceAll(adapter.preparedId, `<${mode}-id>`).replaceAll(created.client.id, '<client-id>')
          if (mode === 'originals' || mode === 'upload-failed') {
            expect(uploaded.map(bytes => Buffer.from(bytes))).toEqual(originalBytes)
            expect(durable.originals).toHaveLength(mode === 'originals' ? 2 : 1)
            for (const receipt of durable.originals ?? []) {
              expect(receipt.expiresAt).toBeGreaterThan(Date.now())
              serialized = serialized.replaceAll(String(receipt.expiresAt), '1900000000000')
            }
          }
          if (mode === 'originals') {
            expect(JSON.parse(submitted.text)).toMatchObject({ readback: { originals:
              { association: 'matched', retention: 'pending', verifiedCount: 2, metadataWarning: true } } })
            expect(JSON.stringify(outputs)).not.toContain('PRIVATE')
          }
          for (const [path, stable] of fixturePaths) {
            const innerJsonPath = JSON.stringify(path).slice(1, -1)
            serialized = serialized.replaceAll(JSON.stringify(innerJsonPath).slice(1, -1), stable)
          }
          const normalized: unknown = JSON.parse(serialized)
          creationResults.push({ mode, results: normalized })
        } finally { disposeApproval?.() }
      }
      await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/finance-voucher-preparation/creation.expected.md', import.meta.url)),
        JSON.stringify(creationResults, null, 2), webSnapshotMode())
      const standard = await ctx.agents.create({ sessionId: SessionId('preparation-standard'),
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined) })
      try { expect(ctx.tools.schemas(standard.agent).some(tool => ['finance_prepare_voucher', 'finance_create_voucher'].includes(tool.name))).toBe(false) }
      finally { await standard.dispose() }
    } finally { await handle.dispose() }
  } finally {
    vi.unstubAllGlobals()
    await browser.close()
    await scaffold.close()
    vi.unstubAllEnvs()
  }
}, 120_000)
