import { afterEach, expect, it, vi } from 'vitest'
import { projectReferences, referenceQuerySchema, type ReferenceQuery } from '../src/references.ts'
import { YouchengConnection } from '../src/youcheng.ts'

const account = { id: '35601', name: '测试账套' }
const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'private-key', accountCode: account.id }
const urls = { test: 'https://cwdata.yiqiyun.com', production: 'https://cwdata.yiqiyun.com' }
const signal = new AbortController().signal
const reply = (data: unknown) => Response.json({ result: 100, data })
const subject = { subjectCode: '1001', subjectName: '现金', parentSubjectCode: '', hasChild: false, enableStatus: '1', balanceDirection: '0' }
afterEach(() => vi.unstubAllGlobals())

it('retains only returned subject types without inferring missing classifications', () => {
  const result = projectReferences([
    { ...subject, subjectType: '流动资产' },
    { ...subject, subjectCode: '1002', subjectType: null },
    { ...subject, subjectCode: '1003' },
    { ...subject, subjectCode: '1004', subjectType: '' },
  ], { kind: 'subjects' }, account, 1000, 5000)
  expect(result.rows[0]).toHaveProperty('subjectType', '流动资产')
  expect(result.rows[1]).not.toHaveProperty('subjectType')
  expect(result.rows[2]).not.toHaveProperty('subjectType')
  expect(result.rows[3]).toHaveProperty('subjectType', '')
  for (const subjectType of [42, {}, '字'.repeat(501)]) {
    expect(() => projectReferences([{ ...subject, subjectType }],
      { kind: 'subjects' }, account, 1000, 5000)).toThrow()
  }
  expect(result.notice).toContain('subjectType 是返回的科目类型名称；缺失或空白时不推断类型')
})

it('explains qualified subject flags without inventing missing directions or mixing receipt flags', () => {
  const subjects = projectReferences([subject, { ...subject, subjectCode: '1002', balanceDirection: '1' },
    { subjectCode: '1003', subjectName: '未返回方向' }], { kind: 'subjects' }, account, 1000, 5000)
  expect(subjects.rows[0]?.directionRaw).toBe('0')
  expect(subjects.rows[1]?.directionRaw).toBe('1')
  expect(subjects.rows[2]).not.toHaveProperty('directionRaw')
  expect(subjects.notice).toContain('本次科目 directionRaw：0借1贷')
  expect(subjects.notice).toContain('未返回方向时不能根据名称或会计惯例推断')
  expect(subjects.notice).not.toMatch(/未核验|0收1支/)
  expect(projectReferences([], { kind: 'cash-accounts' }, account, 1000, 5000).notice).toContain('本次出纳账户 directionRaw：0借1贷')
  expect(projectReferences([], { kind: 'cash-categories' }, account, 1000, 5000).notice).toContain('本次收支类别 directionRaw：0收1支')
  expect(projectReferences([], { kind: 'auxiliary-categories' }, account, 1000, 5000).notice).not.toContain('directionRaw')
})

it('retains hierarchy, stopped subjects and every same-name candidate without selecting one', () => {
  const result = projectReferences([subject, { ...subject, subjectCode: '100101', parentSubjectCode: '1001', enableStatus: '0' }],
    { kind: 'subjects', name: '现金' }, account, 1000, 5000)
  expect(result).toMatchObject({ coverage: 'unverified', returnedCount: 2, selection: 'ambiguous', rows: [
    { code: '1001', status: 'enabled', parentCode: '', directionRaw: '0' },
    { code: '100101', status: 'disabled', parentCode: '1001' },
  ] })
})

it('returns a requested subject tree from the complete returned parent graph without name sampling', () => {
  const result = projectReferences([
    { ...subject, subjectCode: '1001', subjectName: '库存现金', parentSubjectCode: '' },
    { ...subject, subjectCode: '1002', subjectName: '银行存款', parentSubjectCode: '', hasChild: true },
    { ...subject, subjectCode: '100201', subjectName: '工商银行', parentSubjectCode: '1002', hasChild: true },
    { ...subject, subjectCode: '10020101', subjectName: '基本户', parentSubjectCode: '100201' },
    { ...subject, subjectCode: '100202', subjectName: '招商银行', parentSubjectCode: '1002' },
  ], { kind: 'subjects', subjectTreeRootCode: '1002' }, account, 1000, 10000)
  expect(result).toMatchObject({ subjectTreeRootCode: '1002', returnedCount: 5, selection: 'tree-returned' })
  expect(result.rows.map(row => row.code)).toEqual(['1002', '100201', '10020101', '100202'])
  expect(result.notice).toContain('包含树根及其全部已返回后代，不按名称抽样')
})

it.each([
  ['auxiliary-categories', [{ id: 'cat', categoryCode: '01', categoryName: '客户' }], { code: '01', status: 'unknown' }],
  ['auxiliary-items', [{ id: 'item', itemCode: '01', itemName: '客户甲', categoryId: 'cat' }], { name: '客户甲', status: 'unknown' }],
  ['cash-accounts', [{ accountId: 10, accountName: '银行', subjectCode: '1002', status: 1, direction: false, currencyId: 20 }], { id: '10', status: 'disabled', directionRaw: '0', currencyId: '20' }],
  ['cash-categories', [{ id: 10, code: '01', name: '销售', type: true, corpId: 'not-returned' }], { name: '销售', directionRaw: '1', status: 'unknown' }],
] as const)('projects %s using its own status and direction fields', (kind, rows, expected) => {
  const result = projectReferences(rows, { kind }, account, 1000, 5000, 'cat')
  expect(result.rows[0]).toMatchObject(expected)
  expect(JSON.stringify(result)).not.toContain('not-returned')
})

it('distinguishes a missing match from empty vendor rows without claiming whole-ledger absence', () => {
  expect(projectReferences([subject], { kind: 'subjects', code: 'missing' }, account, 1, 5000))
    .toMatchObject({ rows: [], returnedCount: 1, selection: 'not-found-in-returned', coverage: 'unverified' })
  expect(projectReferences([], { kind: 'subjects' }, account, 1000, 5000))
    .toMatchObject({ rows: [], returnedCount: 0, selection: 'not-requested' })
  expect(projectReferences([{ subjectCode: '1', subjectName: '甲' }], { kind: 'subjects' }, account, 1000, 5000).rows[0]?.status).toBe('unknown')
})

it('rejects invalid, duplicate, oversized and cross-category data before filtering', () => {
  for (const data of [null, {}, [subject, subject], [{ ...subject, enableStatus: 'bad' }], [{ ...subject, subjectName: null }]]) {
    expect(() => projectReferences(data, { kind: 'subjects', code: 'missing' }, account, 1000, 5000)).toThrow()
  }
  expect(() => projectReferences([subject], { kind: 'subjects' }, account, 0, 5000)).toThrow()
  const result = projectReferences([subject], { kind: 'subjects' }, account, 1000, 5000)
  const bytes = Buffer.byteLength(JSON.stringify(result))
  expect(() => projectReferences([subject], { kind: 'subjects' }, account, 1000, bytes)).not.toThrow()
  expect(() => projectReferences([subject], { kind: 'subjects' }, account, 1000, bytes - 1)).toThrow()
  expect(() => projectReferences([{ id: 'i', itemCode: '1', itemName: '甲', categoryId: 'other' }],
    { kind: 'auxiliary-items', categoryCode: '01' }, account, 1000, 5000, 'cat')).toThrow()
})

it.each([
  {}, { kind: 'reimbursement' }, { kind: 'subjects', accountId: 'other' },
  { kind: 'auxiliary-items' }, { kind: 'subjects', categoryCode: '01' },
  { kind: 'cash-accounts', subjectTreeRootCode: '1002' },
  { kind: 'subjects', subjectTreeRootCode: '1002', name: '银行存款' },
])('rejects unsupported query fields %#', (query) => {
  expect(referenceQuerySchema.safeParse(query).success).toBe(false)
})

it('verifies the ledger and category before querying items, using only fixed read endpoints', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply('private-token'))
    .mockResolvedValueOnce(reply([{ id: account.id, sobName: account.name }]))
    .mockResolvedValueOnce(reply([{ id: 'cat', categoryCode: '01', categoryName: '客户' }]))
    .mockResolvedValueOnce(reply([{ id: 'item', itemCode: '001', itemName: '甲', categoryId: 'cat' }]))
  vi.stubGlobal('fetch', fetcher)
  const result = await new YouchengConnection(urls, 1000).queryReferences(config, 'private-secret',
    { kind: 'auxiliary-items', categoryCode: '01' }, signal, 1000, 5000)
  expect(result.rows).toEqual([{ id: 'item', code: '001', name: '甲', status: 'unknown' }])
  expect(fetcher.mock.calls[3]?.[1]).toMatchObject({ method: 'POST', redirect: 'error',
    body: JSON.stringify({ setOfBooksId: account.id, sobName: account.name, pageSize: 1000, categoryCode: '01' }) })
  expect(JSON.stringify(result)).not.toMatch(/private-key|private-token|private-secret/)
})

it.each([
  { ledgers: [] }, { ledgers: [{ id: 'other', sobName: account.name }] },
  { ledgers: [{ id: account.id, sobName: account.name }, { id: 'other', sobName: account.name }] },
])('rejects an unavailable or ambiguous ledger before querying references %#', async ({ ledgers }) => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply('token')).mockResolvedValueOnce(reply(ledgers))
  vi.stubGlobal('fetch', fetcher)
  await expect(new YouchengConnection(urls, 1000).queryReferences(config, 'secret', { kind: 'subjects' }, signal, 1000, 5000))
    .rejects.toThrow('account-unavailable')
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('does not query items when the category was not uniquely returned', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply('token')).mockResolvedValueOnce(reply([{ id: account.id, sobName: account.name }]))
    .mockResolvedValueOnce(reply([]))
  vi.stubGlobal('fetch', fetcher)
  await expect(new YouchengConnection(urls, 1000).queryReferences(config, 'secret', { kind: 'auxiliary-items', categoryCode: '01' }, signal, 1000, 5000))
    .rejects.toThrow('account-query')
  expect(fetcher).toHaveBeenCalledTimes(3)
})

it('rejects oversized or credential-bearing responses without echoing them', async () => {
  for (const data of [[{ ...subject, subjectName: 'private-secret' }], [{ ...subject, subjectName: '汉'.repeat(2000) }]]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply('private-token'))
      .mockResolvedValueOnce(reply([{ id: account.id, sobName: account.name }])).mockResolvedValueOnce(reply(data)))
    await expect(new YouchengConnection(urls, 1000).queryReferences(config, 'private-secret', { kind: 'subjects' }, signal, 1000, 5000))
      .rejects.toThrow('invalid-response')
  }
})

it('rejects invalid direct requests before authentication', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(new YouchengConnection(urls, 1000).queryReferences(config, 'secret', { kind: 'bad' } as unknown as ReferenceQuery, signal, 1000, 5000)).rejects.toThrow('参数')
  expect(fetcher).not.toHaveBeenCalled()
})

it('bounds a stalled reference response and respects cancellation without leaking network details', async () => {
  const fetcher = vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
    if (init.signal?.aborted) { reject(new Error('private-token')); return }
    init.signal?.addEventListener('abort', () => { reject(new Error('private-token')) }, { once: true })
  }))
  vi.stubGlobal('fetch', fetcher)
  const adapter = new YouchengConnection(urls, 10)
  await expect(adapter.queryReferences(config, 'private-secret', { kind: 'subjects' }, signal, 1000, 5000)).rejects.toThrow('timeout')
  const stopped = new AbortController()
  stopped.abort()
  await expect(adapter.queryReferences(config, 'private-secret', { kind: 'subjects' }, stopped.signal, 1000, 5000)).rejects.toThrow('已取消')
})
