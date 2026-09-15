import { afterEach, describe, expect, it, vi } from 'vitest'
import { balanceQuerySchema, projectBalances } from '../src/balances.ts'
import { YouchengConnection } from '../src/youcheng.ts'

const row = {
  subjectCode: '1001', subjectName: '库存现金', subjectLevel: 1, hasChild: false,
  periodInitialBorrow: '', periodInitialLoan: '', periodInitialBalance: '',
  periodThisBorrow: '25.50', periodThisLoan: '173.28', periodThisBalance: '-147.78',
  periodYearBorrow: '25.50', periodYearLoan: '173.28', periodYearBalance: '-147.78',
  periodFinalBorrow: '-147.78', periodFinalLoan: '', periodFinalBalance: '',
}
const query = { month: '2026-09' }
const account = { id: '35601', name: '测试账套' }
const project = (list: unknown[]) => projectBalances({ success: true, count: 0, list }, query, account, 100, 65536)
const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'test-key', accountCode: '35601' }
const adapter = () => new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)
afterEach(() => vi.unstubAllGlobals())

describe('balance report projection', () => {
  it('preserves negative debit amounts and blank cells even when count is zero', () => {
    const result = project([row])
    expect(result.rows[0]?.periodFinalBorrow).toBe('-147.78')
    expect(result.rows[0]?.periodFinalLoan).toBeNull()
    expect(result.rows[0]?.periodInitialBorrow).toBeNull()
    expect(result.coverage).toBe('unverified')
    expect(result.notice).toContain('null 在科目行和汇总行均写“未提供”')
    expect(result.notice).toContain('不从金额相同推断划转，不自行展开算式')
  })
  it('separates summaries without adding parents and children again', () => {
    const result = project([{ ...row, hasChild: true }, { ...row, subjectCode: '100101', subjectLevel: 2 }, { ...row, subjectCode: '', subjectName: '本期合计' }])
    expect(result.rows).toHaveLength(2)
    expect(result.summaries).toHaveLength(1)
    expect(result.summaries[0]?.periodThisBorrow).toBe('25.50')
  })
  it('keeps summary-only results distinct from a proven zero balance', () => {
    const result = project([{ ...row, subjectCode: '', subjectName: '本期合计' }])
    expect(result.rows).toEqual([])
    expect(result.coverage).toBe('unverified')
  })
  it('preserves an exact level selection and rejects subjects from another level', () => {
    const selected = { ...query, subjectLevel: 2 }
    const child = { ...row, subjectCode: '100101', subjectLevel: 2 }
    const result = projectBalances({ success: true, count: 0, list: [child, { ...row, subjectCode: '' }] }, selected, account, 100, 65536)
    expect(result).toMatchObject({ subjectLevel: 2, coverage: 'unverified', rows: [{ subjectCode: '100101', subjectLevel: 2 }] })
    expect(() => projectBalances({ success: true, count: 0, list: [row] }, selected, account, 100, 65536)).toThrow('层级')
    for (const subjectLevel of [0, -1, 1.5, 2147483648]) {
      expect(balanceQuerySchema.safeParse({ ...query, subjectLevel }).success).toBe(false)
    }
  })
  it('preserves large decimal strings without floating point conversion', () => {
    expect(project([{ ...row, periodInitialBorrow: '9007199254740993.01' }]).rows[0]?.periodInitialBorrow).toBe('9007199254740993.01')
  })
  it('rejects broken range relationships but allows children outside the requested end level', () => {
    const parent = { ...row, subjectInfoId: 1, parentSubjectId: 0, hasChild: true }
    const child = { ...row, subjectInfoId: 2, parentSubjectId: 1, subjectCode: '100101', subjectLevel: 2 }
    const selected = { ...query, subjectLevel: 1, subjectLevelEnd: 3 }
    const check = (list: unknown[]) => projectBalances({ success: true, count: 0, list }, selected, account, 100, 65536)
    for (const list of [[row], [parent], [parent, { ...child, subjectInfoId: 1 }],
      [parent, { ...child, parentSubjectId: 9 }], [{ ...parent, hasChild: false }, child],
      [parent, { ...child, subjectLevel: 3 }], [{ ...parent, parentSubjectId: 1 }, child]]) {
      expect(() => check(list)).toThrow()
    }
    expect(projectBalances({ success: true, count: 0, list: [parent] },
      { ...query, subjectLevel: 1, subjectLevelEnd: 1 }, account, 100, 65536).rows).toHaveLength(1)
    expect(check([parent, child]).rows[1]).toMatchObject({ subjectInfoId: 2, parentSubjectId: 1 })
    expect(check([parent, child, { ...row, subjectCode: '', subjectInfoId: -99999999999999999 }]).summaries[0])
      .not.toHaveProperty('subjectInfoId')
  })
  it('accepts a bounded level range without asserting full ledger coverage', () => {
    const selected = { ...query, subjectLevel: 1, subjectLevelEnd: 2 }
    const report = { success: true, count: 0, list: [
      { ...row, subjectInfoId: 1, parentSubjectId: 0, hasChild: true },
      { ...row, subjectCode: '100101', subjectLevel: 2, subjectInfoId: 2, parentSubjectId: 1 },
    ] }
    expect(projectBalances(report, selected, account, 100, 65536)).toMatchObject({ subjectLevel: 1, subjectLevelEnd: 2, coverage: 'unverified' })
    expect(() => projectBalances(report, { ...selected, subjectLevelEnd: 1 }, account, 100, 65536)).toThrow('层级')
    for (const input of [{ ...query, subjectLevelEnd: 2 }, { ...selected, subjectLevelEnd: 0 }, { ...selected, subjectLevel: 3 }]) {
      expect(balanceQuerySchema.safeParse(input).success).toBe(false)
    }
  })
  it.each([['1,000.00', '1000.00'], ['-1,234,567.8', '-1234567.80'], ['9,007,199,254,740,993.01', '9007199254740993.01']])('normalizes grouped decimal %s without floating point conversion', (input, expected) => {
    expect(project([{ ...row, periodInitialBorrow: input }]).rows[0]?.periodInitialBorrow).toBe(expected)
  })
  it('retains independent opening, current, yearly and closing credit fields without netting', () => {
    const credit = { ...row, subjectCode: '2202', subjectName: '应付账款',
      periodInitialBorrow: '', periodInitialLoan: '100.00', periodInitialBalance: '100.00',
      periodThisBorrow: '20.00', periodThisLoan: '50.00', periodThisBalance: '30.00',
      periodYearBorrow: '70.00', periodYearLoan: '200.00', periodYearBalance: '130.00',
      periodFinalBorrow: '', periodFinalLoan: '130.00', periodFinalBalance: '130.00',
    }
    expect(project([credit]).rows[0]).toEqual({ ...credit, periodInitialBorrow: null, periodFinalBorrow: null })
  })
  it.each([undefined, null, 12.5, 'not-money', '12.345', '1,00.00', '1000,000.00', ',100.00', '1,,000.00', '1,000.0,0'])('rejects missing or malformed amount %s', (value) => {
    expect(() => project([{ ...row, periodThisBorrow: value }])).toThrow()
  })
  it('rejects duplicates, row limits, byte limits and vendor failure', () => {
    expect(() => project([row, row])).toThrow()
    expect(() => projectBalances({ success: true, count: 0, list: [row] }, query, account, 0, 65536)).toThrow()
    expect(() => projectBalances({ success: true, count: 0, list: [row] }, query, account, 100, 1)).toThrow()
    expect(() => projectBalances({ success: false, count: 0, list: [] }, query, account, 100, 65536)).toThrow()
  })
  it('rejects invalid periods and model-supplied ledger overrides', () => {
    for (const input of [{ month: '2026-13' }, { month: '2026-09', monthEnd: '2026-08' }, { ...query, accountId: 'other' }]) {
      expect(balanceQuerySchema.safeParse(input).success).toBe(false)
    }
  })
})

it('uses the saved authorized numeric ledger and period request without accepting count as completeness', async () => {
  const paths: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    paths.push(url.pathname)
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'test-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35601', sobName: '测试账套' }] })
    if (typeof init.body !== 'string') throw new Error('Expected JSON body')
    expect(JSON.parse(init.body)).toEqual({ setOfBooksId: 35601, periodNumber: '2026-09', periodNumber2: '2026-09', pageNo: 1, pageSize: 100, isNeedPage: true })
    return Response.json({ result: 100, data: { success: true, count: 0, list: [{ ...row, subjectInfoId: 1, parentSubjectId: 0 }] } })
  }))
  const result = await adapter().queryBalances(config, 'test-secret', query, new AbortController().signal, 100, 65536)
  expect(result.rows).toHaveLength(1)
  expect(paths).toEqual(['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson', '/finance/subject/getList.rjson'])
})

it('requests an unpaginated base-currency range with disabled subjects included', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'test-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35601', sobName: '测试账套' }] })
    if (typeof init.body !== 'string') throw new Error('Expected JSON body')
    expect(JSON.parse(init.body)).toMatchObject({
      subjectLevelStart: 1, subjectLevelEnd: 1, parentSubjectId: 0, isNeedPage: false, currency: true, displayDisableSubject: true,
    })
    return Response.json({ result: 100, data: { success: true, count: 0, list: [{ ...row, subjectInfoId: 1, parentSubjectId: 0 }] } })
  }))
  expect(await adapter().queryBalances(config, 'test-secret', { ...query, subjectLevel: 1, subjectLevelEnd: 4 }, new AbortController().signal, 100, 65536)).toMatchObject({ subjectLevelEnd: 4 })
})

it.each(['missing-ledger', 'malformed', 'secret', 'network'])('rejects %s without leaking provider text', async (failure) => {
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'test-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: failure === 'missing-ledger' ? [] : [{ id: '35601', sobName: '测试账套' }] })
    if (failure === 'network') throw new TypeError('private-network test-secret')
    return Response.json({ result: 100, data: { success: true, count: 0, list: [{ ...row, subjectName: failure === 'secret' ? 'test-secret' : '测试', periodThisBorrow: failure === 'malformed' ? null : '25.50' }] } })
  }))
  let message = ''
  try { await adapter().queryBalances(config, 'test-secret', query, new AbortController().signal, 100, 65536) }
  catch (error) { message = String(error) }
  expect(message).toContain('查询失败')
  expect(message).not.toMatch(/test-secret|private-network/)
})
