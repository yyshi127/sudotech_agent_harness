import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { ReimbursementConnection, type ReimbursementApi } from '../src/reimbursement.ts'
import { ReimbursementDrafts, discoverReimbursement, reimbursementRequestSchema } from '../src/reimbursement-drafts.ts'
import { FinanceClientId } from '../src/types.ts'

const clientId = FinanceClientId('10000000-0000-4000-8000-000000000001')
afterEach(() => { vi.unstubAllGlobals() })

it('stores reimbursement separately, keeps secrets write-only, and authenticates against the reimbursement origin', async () => {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials).await()
  try {
    const financeKey = credentialKey('xiaojing-finance-domain', `client-${clientId}`)
    await ctx.credentials.modifyRecord(financeKey, () => Promise.resolve({ kind: 'api-key', key: 'finance-only-secret' }))
    const connection = new ReimbursementConnection(ctx.credentials, { apiUrl: 'https://yiqbdata.superboss.cc', timeoutMs: 1000, maxResponseBytes: 10000 })
    const request = { clientId, expectedRevision: 0, apiUrl: 'https://yiqbdata.superboss.cc', appKey: 'shared-example-key', appSecret: 'reimburse-example-secret' }
    const saved = await connection.save(request)
    expect(JSON.stringify(saved)).not.toContain(request.appSecret)
    expect(await ctx.credentials.readRecord(financeKey)).toMatchObject({ kind: 'api-key', key: 'finance-only-secret' })
    await expect(connection.save(request)).rejects.toThrow('已变更')
    await expect(connection.save({ ...request, expectedRevision: 1, apiUrl: 'https://example.com' })).rejects.toThrow('字段无效')
    await expect(connection.save({ clientId, expectedRevision: 1, apiUrl: request.apiUrl, appKey: 'another-example-key' })).rejects.toThrow('配套')
    await connection.save({ clientId, expectedRevision: 1, apiUrl: request.apiUrl, appKey: request.appKey })
    vi.stubGlobal('fetch', vi.fn(async (input: URL, init: RequestInit) => {
      expect(input.origin).toBe(request.apiUrl)
      if (input.pathname.startsWith('/auth')) {
        if (typeof init.body !== 'string') throw new Error('Expected a JSON body')
        expect(JSON.parse(init.body)).toEqual({ appKey: request.appKey, appSecret: request.appSecret })
        return Response.json({ result: 100, data: { accessToken: 'secret-token' } })
      }
      expect(input.searchParams.get('accessToken')).toBe('secret-token')
      return Response.json({ result: 201, message: `failure ${request.appSecret} secret-token https://private.example/?secret=hidden` })
    }))
    const api = await connection.connect(clientId, new AbortController().signal)
    await expect(api.call('departments', {})).rejects.toThrow('有成报销 201：failure [已隐藏] [已隐藏] [链接已隐藏]')
  } finally { await ctx.fiber.dispose() }
})

const c = (code: string, type: string, require = true) => ({ code, type, require, label: code })
const tree = [
  { templateCode: 'order', templateName: '日常报销', templateType: 1, orderTemplateType: 1, parentTemplateCode: '0', status: 0,
    components: [c('title', 'text'), c('proposer', 'staff'), c('department', 'department'), c('reimbursementDate', 'date'), c('amount', 'amount'), c('expenseInfo', 'importDetails'),
      { ...c('collectionInfo', 'payeeInfo'), configureObject: { multiple: { value: true } } }] },
  { templateCode: 'fee', templateName: '餐饮费', templateType: 2, parentTemplateCode: '0', status: 0,
    components: [c('consumptionMoney', 'amount'), c('invoice', 'invoice', false), c('invoiceNumber', 'number'), c('dateMerge', 'dateMerge')] },
]
const input = { action: 'create' as const, draft: { templateCode: 'order', submitterId: 'u1', departmentId: 'd1', title: '测试事由', date: '2026-09-04', payeeCardId: 1, fields: [],
  fees: [{ templateCode: 'fee', amount: '100.10', fields: [{ code: 'dateMerge', bindingVal: '2026-09-03' }], invoices: ['invoice.pdf'] }] } }

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'reimbursement-test-'))
  const bodies: { operation: string; body: object }[] = []
  let orderId = ''
  const api: ReimbursementApi = { revision: 1, call: vi.fn(async (operation: Parameters<ReimbursementApi['call']>[0], body: object) => {
    bodies.push({ operation, body })
    if (operation === 'templates') return tree
    if (operation === 'users') return [{ userId: 'u1', userName: '张三', corpId: 'corp1', accessToken: 'never-expose', phone: 'never-expose' }]
    if (operation === 'departments') return [{ deptId: 'd1', deptName: '研发', parentId: '0', status: 1 }]
    if (operation === 'payees') return [{ cardId: 1, bankCardNum: '1234567890', holdName: '张三', bankName: '测试银行' }]
    if (operation === 'create') { orderId = (body as { orderList: { id: string }[] }).orderList[0]!.id; return {} }
    if (operation === 'result') return [{ orderId, orderCode: 'BX001' }]
    return [{ orderCode: 'BX001', status: 1 }]
  }) }
  const owner = { id: 'client1/session1', label: '测试客户', approve: vi.fn(async () => {}), checkCurrent: vi.fn(async () => {}),
    upload: vi.fn(async (_path: string) => ({ name: 'invoice.pdf', objectKey: 'opaque/invoice.pdf', size: 12, expiresAt: 100,
      downloadUrl: 'https://private.example/invoice?signature=secret' })) }
  return {
    directory, api, owner, bodies, executor: new ReimbursementDrafts(directory),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}

it('projects people and bank cards without tokens, phones, or full account numbers', async () => {
  const f = await fixture()
  try {
    expect(await discoverReimbursement(f.api, { action: 'users', search: '张', page: 1 })).toEqual({ total: 1, page: 1, hasMore: false, items: [{ id: 'u1', name: '张三', corpId: 'corp1' }] })
    expect(JSON.stringify(await discoverReimbursement(f.api, { action: 'payees', search: '张', page: 1 }))).not.toContain('1234567890')
    expect(JSON.stringify(await discoverReimbursement(f.api, { action: 'template', code: 'order' }))).toContain('不代表不支持附件')
    expect(f.bodies).toContainEqual({ operation: 'templates', body: { needParentTemplate: true, templateCode: 'order' } })
  } finally { await f.cleanup() }
})

it('confirms before any write, supplies the documented attachment URL array, forces draft, and verifies status', async () => {
  const f = await fixture()
  try {
    f.owner.approve.mockImplementation(async () => { expect(f.owner.upload).not.toHaveBeenCalled(); expect(f.bodies.some(c => c.operation === 'create')).toBe(false) })
    const receipt = await f.executor.run(f.api, f.owner, input)
    expect(receipt).toMatchObject({ phase: 'draft', orderCode: 'BX001', attachmentNames: ['invoice.pdf'] })
    expect(f.owner.approve).toHaveBeenCalledWith(expect.stringContaining('corp1'))
    const body = f.bodies.find(c => c.operation === 'create')!.body as { orderList: Record<string, unknown>[] }
    expect(body.orderList[0]).toMatchObject({ pushOrderStatus: '1', submitAmount: 100.1 })
    expect(JSON.stringify(body)).toContain('\\"id\\":1,\\"amount\\":100.1')
    expect(body.orderList[0]?.orderComponentList).toContainEqual({ code: 'attachment', bindingVal: '["https://private.example/invoice?signature=secret"]' })
    expect(JSON.stringify(receipt)).not.toContain('signature')
    const saved = await readFile(join(f.directory, `${(receipt as { operationId: string }).operationId}.json`), 'utf8')
    expect(saved).not.toContain('private.example')
    await f.executor.run(f.api, f.owner, input)
    expect(f.bodies.filter(c => c.operation === 'create')).toHaveLength(1)
    expect(f.owner.upload).toHaveBeenCalledTimes(1)
  } finally { await f.cleanup() }
})

it('does not upload when confirmation is rejected or template requirements are missing', async () => {
  const f = await fixture()
  try {
    f.owner.approve.mockRejectedValue(new Error('rejected'))
    await expect(f.executor.run(f.api, f.owner, input)).rejects.toThrow('rejected')
    expect(f.owner.upload).not.toHaveBeenCalled()
    await expect(f.executor.run(f.api, f.owner, { ...input, draft: { ...input.draft, fees: [{ ...input.draft.fees[0]!, fields: [] }] } })).rejects.toThrow('dateMerge')
    expect(f.owner.upload).not.toHaveBeenCalled()
    expect(reimbursementRequestSchema.safeParse({ ...input, draft: { ...input.draft, pushOrderStatus: '3' } }).success).toBe(false)
  } finally { await f.cleanup() }
})

it('retains an unknown draft write and prevents blind retries, including after executor restart', async () => {
  const f = await fixture()
  const original = f.api.call.bind(f.api)
  let creations = 0
  f.api.call = async (operation, body) => { if (operation === 'create') { creations++; throw new Error('timeout') } return original(operation, body) }
  try {
    const receipt = await f.executor.run(f.api, f.owner, input)
    expect(receipt).toMatchObject({ phase: 'pushing', message: 'timeout' })
    await new ReimbursementDrafts(f.directory).run(f.api, f.owner, input)
    expect(f.owner.upload).toHaveBeenCalledTimes(1)
    expect(creations).toBe(1)
    await expect(f.executor.run(f.api, { ...f.owner, id: 'other/session' }, { action: 'status', operationId: (receipt as { operationId: string }).operationId })).rejects.toThrow('不属于')
  } finally { await f.cleanup() }
})

it('adds one attachment field whether the template omits it or explicitly declares it', async () => {
  const f = await fixture()
  const original = f.api.call.bind(f.api)
  f.api.call = async (operation, body) => operation === 'templates'
    ? [{ ...tree[0]!, components: [...tree[0]!.components, c('attachment', 'attachment')] }, tree[1]!]
    : original(operation, body)
  try {
    await f.executor.run(f.api, f.owner, input)
    const body = f.bodies.find(row => row.operation === 'create')!.body as { orderList: { orderComponentList: { code: string }[] }[] }
    expect(body.orderList[0]!.orderComponentList.filter(field => field.code === 'attachment')).toHaveLength(1)
  } finally { await f.cleanup() }
})

it('requires an explicit eligible employee when the selected form has a separate staff field', async () => {
  const f = await fixture()
  const original = f.api.call.bind(f.api)
  f.api.call = async (operation, body) => operation === 'templates'
    ? [{ ...tree[0]!, components: [...tree[0]!.components, c('staff', 'staff')] }, tree[1]!]
    : original(operation, body)
  try {
    await expect(f.executor.run(f.api, f.owner, input)).rejects.toThrow('staff')
    await expect(f.executor.run(f.api, f.owner, { ...input, draft: { ...input.draft, employeeId: 'unknown' } })).rejects.toThrow('员工')
    expect(f.owner.upload).not.toHaveBeenCalled()
    await f.executor.run(f.api, f.owner, { ...input, draft: { ...input.draft, employeeId: 'u1' } })
    expect(f.owner.approve).toHaveBeenCalledWith(expect.stringContaining('员工：张三'))
    expect(JSON.stringify(f.bodies.find(row => row.operation === 'create')?.body)).toContain('"code":"staff","bindingVal":"u1"')
  } finally { await f.cleanup() }
})

it.each([false, true])('attaches originals to their own fee rows when the fee attachment is required=%s', async (required) => {
  const f = await fixture()
  const original = f.api.call.bind(f.api)
  f.api.call = async (operation, body) => operation === 'templates'
    ? [tree[0]!, { ...tree[1]!, components: [...tree[1]!.components, c('attachment', 'attachment', required)] }]
    : original(operation, body)
  f.owner.upload.mockImplementation(async path => ({ name: path, objectKey: `opaque/${path}`, size: 12, expiresAt: 100, downloadUrl: `https://private.example/${path}?signature=secret` }))
  try {
    await f.executor.run(f.api, f.owner, { ...input, draft: { ...input.draft, fees: [input.draft.fees[0]!, { ...input.draft.fees[0]!, invoices: ['return.png'] }] } })
    const order = (f.bodies.find(row => row.operation === 'create')!.body as { orderList: { feeList: { feeComponentList: { code: string; bindingVal: string }[] }[] }[] }).orderList[0]!
    expect(order.feeList.map(fee => fee.feeComponentList.filter(field => field.code === 'attachment'))).toEqual([
      [{ code: 'attachment', bindingVal: '["https://private.example/invoice.pdf?signature=secret"]' }],
      [{ code: 'attachment', bindingVal: '["https://private.example/return.png?signature=secret"]' }],
    ])
    expect(f.owner.upload.mock.calls).toEqual([['invoice.pdf'], ['return.png']])
  } finally { await f.cleanup() }
})

it('blocks a changed request while another write in the same session is unresolved', async () => {
  const f = await fixture()
  const original = f.api.call.bind(f.api)
  f.api.call = async (operation, body) => { if (operation === 'create') throw new Error('timeout'); return original(operation, body) }
  try {
    const pending = await f.executor.run(f.api, f.owner, input)
    const retry = await new ReimbursementDrafts(f.directory).run(f.api, f.owner, { ...input, draft: { ...input.draft, title: 'changed title' } })
    expect(retry).toMatchObject({ operationId: (pending as { operationId: string }).operationId, phase: 'pushing' })
    expect(f.owner.upload).toHaveBeenCalledTimes(1)
    expect(f.owner.approve).toHaveBeenCalledTimes(1)
  } finally { await f.cleanup() }
})

it('does not create a bill after a failed upload and permits a confirmed retry of that request', async () => {
  const f = await fixture()
  try {
    f.owner.upload.mockRejectedValueOnce(new Error('附件上传失败'))
    expect(await f.executor.run(f.api, f.owner, input)).toMatchObject({ phase: 'uploading', message: '附件上传失败' })
    expect(f.bodies.some(row => row.operation === 'create')).toBe(false)
    expect(await f.executor.run(f.api, f.owner, input)).toMatchObject({ phase: 'draft' })
    expect(f.owner.approve).toHaveBeenCalledTimes(2)
    expect(f.bodies.filter(row => row.operation === 'create')).toHaveLength(1)
  } finally { await f.cleanup() }
})

it('serializes simultaneous same-session creates across executor instances', async () => {
  const f = await fixture()
  try {
    const results = await Promise.all([
      f.executor.run(f.api, f.owner, input),
      new ReimbursementDrafts(f.directory).run(f.api, f.owner, input),
    ])
    expect(results).toEqual([expect.objectContaining({ phase: 'draft' }), expect.objectContaining({ phase: 'draft' })])
    expect(f.owner.approve).toHaveBeenCalledTimes(1)
    expect(f.owner.upload).toHaveBeenCalledTimes(1)
    expect(f.bodies.filter(row => row.operation === 'create')).toHaveLength(1)
  } finally { await f.cleanup() }
})

it('keeps required invoice-ledger association blocking even though ordinary attachments are supported', async () => {
  const f = await fixture()
  const original = f.api.call.bind(f.api)
  f.api.call = async (operation, body) => operation === 'templates'
    ? [tree[0]!, { ...tree[1]!, components: [c('invoice', 'invoice')] }] : original(operation, body)
  try {
    await expect(f.executor.run(f.api, f.owner, input)).rejects.toThrow('发票台账')
    expect(f.owner.upload).not.toHaveBeenCalled()
    expect(f.owner.approve).not.toHaveBeenCalled()
  } finally { await f.cleanup() }
})
