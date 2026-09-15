import { afterEach, expect, it, vi } from 'vitest'
import { buildVoucherSubmission, classifyVoucherSubmission, matchesVoucherAccounting, compareVoucherAuxiliary, compareVoucherCurrency } from '../src/voucher-submission.ts'
import { projectVoucherDetail } from '../src/vouchers.ts'
import { YouchengConnection } from '../src/youcheng.ts'
import type { VoucherPreparationInput } from '../src/voucher-preparation.ts'

const input: VoucherPreparationInput = { date: '2026-09-09', documentMaker: '测试员', certificateCode: 35, sourcePaths: [], entries: [
  { summary: '取现测试', subjectCode: '1001', side: 'debit', amount: '0.30', auxiliary: [] },
  { summary: '取现测试', subjectCode: '100201', side: 'credit', amount: '0.30', auxiliary: [] },
] }
const limits = { maxEntries: 10, maxBytes: 65536 }
const identity = { accountName: '测试账套', appId: 'xiaojing-test', flowId: 'stable-flow', attachmentUrls: [] }
const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fixture-key', accountCode: '35616' }
afterEach(() => vi.unstubAllGlobals())

const returnedDetail = { accountId: '35616', certificateId: '270825', certificateWord: '记', certificateCode: 35,
  certificateDate: input.date, periods: '2026-09', auditingStatus: false, settleStatus: false, documentMaker: input.documentMaker,
  certificateLists: input.entries.map(row => ({ currencyCode: '', abstractName: row.summary, subjectCode: row.subjectCode, subjectName: '测试科目',
    direction: row.side === 'debit' ? 0 : 1, borrorMoneyStr: row.side === 'debit' ? row.amount : '0.00',
    loanMoneyStr: row.side === 'credit' ? row.amount : '0.00' })),
}
const account = { id: '35616', name: identity.accountName }

it('compares reserved accounting fields without relying on entry order or dropping duplicates', () => {
  const detail = projectVoucherDetail(returnedDetail, '270825', account, limits.maxBytes)
  expect(matchesVoucherAccounting({ ...detail, rows: [...detail.rows].reverse() }, input, account, '270825')).toBe(true)
  for (const changed of [
    { ...detail, accountName: 'renamed' }, { ...detail, accountId: 'other' }, { ...detail, voucherId: 'other' },
    { ...detail, date: '2026-09-08' }, { ...detail, period: '2026-08' }, { ...detail, number: '记-36' },
    { ...detail, documentMaker: 'other' }, { ...detail, audited: true }, { ...detail, settled: true },
    { ...detail, rows: [...detail.rows, ...detail.rows] },
    { ...detail, rows: detail.rows.map(row => ({ ...row, summary: 'changed' })) },
    { ...detail, rows: detail.rows.map(row => ({ ...row, subjectCode: 'other' })) },
    { ...detail, rows: detail.rows.map(row => ({ ...row, debit: row.credit, credit: row.debit })) },
  ]) expect(matchesVoucherAccounting(changed, input, account, '270825')).toBe(false)
})

it('reads an accepted submission without writes and never labels the partial comparison complete', async () => {
  const paths: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    paths.push(url.pathname)
    if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'fixture-token' })
    if (url.pathname === '/finance/auxiliary/queryAccountList.rjson') return Response.json({ result: 100,
      data: [{ id: account.id, sobName: account.name }] })
    expect(url.pathname).toBe('/finance/certificate/info.rjson')
    return Response.json({ result: 100, data: returnedDetail })
  }))
  const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)
  const reserved = { accountId: account.id, accountName: account.name, voucherId: '270825', input }
  const signal = new AbortController().signal
  await expect(adapter.querySubmittedVoucher(config, 'fixture-secret', { ...reserved, accountId: 'other' }, signal, limits.maxBytes))
    .rejects.toThrow('账套')
  expect(paths).toHaveLength(0)
  await expect(adapter.querySubmittedVoucher(config, 'fixture-secret', reserved, signal, limits.maxBytes))
    .resolves.toEqual({ accounting: 'matched', auxiliary: 'unavailable', currency: 'unavailable', complete: false })
  expect(paths).toEqual(['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson', '/finance/certificate/info.rjson'])
})

it('marks only fully compared base-currency vouchers complete, independently of F2 project acceptance', async () => {
  let body = { ...returnedDetail, certificateLists: returnedDetail.certificateLists.map(row => ({ ...row, auxiliaryList: [] })) }
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'fixture-token' })
    if (url.pathname === '/finance/auxiliary/queryAccountList.rjson') return Response.json({ result: 100,
      data: [{ id: account.id, sobName: account.name }] })
    expect(url.pathname).toBe('/finance/certificate/info.rjson')
    return Response.json({ result: 100, data: body })
  }))
  const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)
  const inspect = (proposal = input) => adapter.querySubmittedVoucher(config, 'fixture-secret',
    { accountId: account.id, accountName: account.name, voucherId: '270825', input: proposal }, new AbortController().signal,
    limits.maxBytes, { expected: [], options: { hosts: [], maxBytes: 100, timeoutMs: 1000 } })
  expect(await inspect()).toMatchObject({ complete: true, accounting: 'matched', auxiliary: 'matched',
    originals: { association: 'not-required' } })
  expect(await inspect({ ...input, sourcePaths: ['missing-original.pdf'] })).toMatchObject({ complete: false })
  expect(await inspect({ ...input, entries: input.entries.map(row => ({ ...row,
    foreignCurrency: { code: 'USD', amount: row.amount, exchangeRate: '1' } })) })).toMatchObject({ complete: false })
  body = { ...body, certificateCode: 36 }
  expect(await inspect()).toMatchObject({ complete: false, accounting: 'mismatch' })
})

it('compares direct currency amounts/rates, retaining entry and auxiliary associations', () => {
  const proposed = { ...input, entries: input.entries.map((row, index) => ({ ...row,
    auxiliary: [{ categoryCode: '01', itemCode: String(index) }],
    foreignCurrency: { code: 'USD', amount: index === 0 ? '0.20' : '0.10', exchangeRate: index === 0 ? '1.50' : '3' },
  })) }
  const raw = { ...returnedDetail, certificateLists: returnedDetail.certificateLists.map((row, index) => ({ ...row,
    currencyCode: 'USD', originalCurrencyAmount: index === 0 ? 0.2 : 0.1, exchangeRate: index === 0 ? 1.5 : 3,
    auxiliaryList: [{ auxiliaryCategoryTypeId: '01', auxiliaryCategoryId: String(index) }], foreignCurrencySimpleList: [],
  })) }
  const compare = (data: unknown, expected = proposed) => compareVoucherCurrency(data,
    projectVoucherDetail(data, '270825', account, limits.maxBytes), expected)
  expect(compare(raw)).toBe('matched')
  expect(compare({ ...raw, certificateLists: [...raw.certificateLists].reverse() })).toBe('matched')
  expect(compare({ ...raw, certificateLists: raw.certificateLists.map(row => ({ ...row, currencyCode: 'EUR' })) })).toBe('mismatch')
  expect(compare({ ...raw, certificateLists: raw.certificateLists.map(row => ({ ...row, exchangeRate: 1.51 })) })).toBe('mismatch')
  expect(compare({ ...raw, certificateLists: raw.certificateLists.map(row => ({ ...row, originalCurrencyAmount: '0.2000', exchangeRate: '1.5000' })) },
    { ...proposed, entries: proposed.entries.map(row => ({ ...row, foreignCurrency: { code: 'USD', amount: '0.20', exchangeRate: '1.5' } })) })).toBe('matched')
  for (const bad of [undefined, null, '', 'NaN', -1, 1.2345678901234567]) {
    expect(compare({ ...raw, certificateLists: raw.certificateLists.map(row => ({ ...row, exchangeRate: bad })) })).toBe('unavailable')
  }
  expect(compare({ ...raw, certificateLists: raw.certificateLists.map(row => ({ ...row, currencyCode: undefined })) })).toBe('unavailable')
  expect(compare({ ...raw, certificateLists: raw.certificateLists.map(row => ({ ...row, auxiliaryList: null })) })).toBe('unavailable')
  // Identical accounting values must not permit swapping currencies between different auxiliary items.
  const repeated = { ...raw, certificateLists: raw.certificateLists.map(row => ({ ...raw.certificateLists[0]!,
    auxiliaryList: row.auxiliaryList,
    originalCurrencyAmount: row.originalCurrencyAmount, exchangeRate: row.exchangeRate })) }
  const sameEntries = { ...proposed, entries: proposed.entries.map(row => ({ ...proposed.entries[0]!, auxiliary: row.auxiliary,
    foreignCurrency: row.foreignCurrency })) }
  expect(compare(repeated, sameEntries)).toBe('matched')
  expect(compare({ ...repeated, certificateLists: repeated.certificateLists.map((row, index) => ({ ...row,
    auxiliaryList: repeated.certificateLists[1 - index]!.auxiliaryList })) }, sameEntries)).toBe('mismatch')
})

it('keeps currency evidence unavailable when fields are absent and rejects unexpected foreign values', () => {
  const raw = { ...returnedDetail, certificateLists: returnedDetail.certificateLists.map(row => ({ ...row, auxiliaryList: [] })) }
  const detail = projectVoucherDetail(raw, '270825', account, limits.maxBytes)
  expect(compareVoucherCurrency(raw, detail, input)).toBe('matched')
  expect(compareVoucherCurrency({}, detail, input)).toBe('unavailable')
  expect(compareVoucherCurrency({ ...raw, certificateLists: [] }, detail, input)).toBe('unavailable')
  expect(compareVoucherCurrency({ ...raw, certificateLists: raw.certificateLists.map(row => ({ ...row,
    originalCurrencyAmount: 1 })) }, detail, input)).toBe('mismatch')
  const tiny = { ...input, entries: input.entries.map(row => ({ ...row,
    foreignCurrency: { code: 'USD', amount: '3000000.00', exchangeRate: '0.0000001' } })) }
  expect(compareVoucherCurrency({ ...raw, certificateLists: raw.certificateLists.map(row => ({ ...row,
    currencyCode: 'USD', originalCurrencyAmount: 3000000, exchangeRate: 1e-7 })) }, detail, tiny)).toBe('matched')
})

it('compares auxiliary codes on their own entries and distinguishes absent arrays from empty ones', () => {
  const prepared = { ...input, entries: input.entries.map((row, index) => ({ ...row,
    auxiliary: [{ categoryCode: '01', itemCode: index === 0 ? '03' : '04' }] })) }
  const returned = { ...returnedDetail, certificateLists: returnedDetail.certificateLists.map((row, index) => ({ ...row,
    auxiliaryList: [{ auxiliaryCategoryTypeId: '01', auxiliaryCategoryId: index === 0 ? '03' : '04' }],
  })) }
  const compare = (data: typeof returned | typeof returnedDetail, proposal = prepared) =>
    compareVoucherAuxiliary(data, projectVoucherDetail(data, '270825', account, limits.maxBytes), proposal)
  expect(compare(returned)).toBe('matched')
  expect(compare({ ...returned, certificateLists: [...returned.certificateLists].reverse() })).toBe('matched')
  expect(compare(returnedDetail)).toBe('unavailable')
  expect(compare({ ...returned, certificateLists: returned.certificateLists.map(row => ({ ...row, auxiliaryList: [] })) })).toBe('mismatch')
  expect(compare({ ...returned, certificateLists: returned.certificateLists.map(row => ({ ...row,
    auxiliaryList: [{ auxiliaryCategoryTypeId: '473814', auxiliaryCategoryId: '191501' }],
  })) })).toBe('mismatch')
  expect(compare({ ...returned, certificateLists: returned.certificateLists.map((row, index) => ({ ...row,
    auxiliaryList: [{ auxiliaryCategoryTypeId: '01', auxiliaryCategoryId: index === 0 ? '04' : '03' }],
  })) })).toBe('mismatch')
  const empty = { ...returned, certificateLists: returned.certificateLists.map(row => ({ ...row, auxiliaryList: [] })) }
  expect(compareVoucherAuxiliary(empty, projectVoucherDetail(empty, '270825', account, limits.maxBytes), input)).toBe('matched')
  expect(compareVoucherAuxiliary({ certificateLists: [{ auxiliaryList: null }] },
    projectVoucherDetail(returned, '270825', account, limits.maxBytes), input)).toBe('unavailable')
})

it('maps exact preview fields without populating the opposite amount or audit fields', () => {
  const payload = buildVoucherSubmission(input, identity, limits)
  expect(payload).toMatchObject({ accountName: identity.accountName, certificateCode: 35, flowId: 'stable-flow',
    attachmentUrlList: [], entryList: [{ direction: 0, borrorMoney: 0.3 }, { direction: 1, loanMoney: 0.3 }] })
  expect(JSON.stringify(payload)).not.toMatch(/auditingUser|accountId|appSecret|sourcePaths/)
  expect(Object.keys((payload as { entryList: object[] }).entryList[0]!)).not.toContain('loanMoney')
  expect(Object.keys((payload as { entryList: object[] }).entryList[1]!)).not.toContain('borrorMoney')
})

it('requires a previewed number, matched originals, exact numeric representation and complete byte bounds', () => {
  const { certificateCode: _number, ...withoutNumber } = input
  expect(() => buildVoucherSubmission(withoutNumber, identity, limits)).toThrow('凭证号')
  expect(() => buildVoucherSubmission({ ...input, sourcePaths: ['invoice.pdf'] }, identity, limits)).toThrow('一一对应')
  expect(() => buildVoucherSubmission(input, { ...identity, attachmentUrls: ['https://example.test/a'] }, limits)).toThrow('一一对应')
  expect(() => buildVoucherSubmission({ ...input, entries: input.entries.map(row => ({ ...row, amount: '9007199254740993.00' })) },
    identity, limits)).toThrow('无损')
  const length = Buffer.byteLength(JSON.stringify(buildVoucherSubmission(input, identity, limits)))
  expect(() => buildVoucherSubmission(input, identity, { ...limits, maxBytes: length - 1 })).toThrow('大小限制')
})

it('retains exact foreign numeric values including scientific JSON spelling after conversion checks', () => {
  const foreign = { ...input, entries: input.entries.map(row => ({ ...row,
    foreignCurrency: { code: 'USD', amount: '3000000.00', exchangeRate: '0.0000001' },
  })) }
  expect(buildVoucherSubmission(foreign, identity, limits)).toMatchObject({ entryList: [
    { currencyCode: 'USD', originalCurrencyAmount: 3000000, exchangeRate: 1e-7 },
    { currencyCode: 'USD', originalCurrencyAmount: 3000000, exchangeRate: 1e-7 },
  ] })
  expect(() => buildVoucherSubmission({ ...foreign, entries: foreign.entries.map(row => ({ ...row,
    foreignCurrency: { ...row.foreignCurrency, exchangeRate: '0.0000001000000000000000001' },
  })) }, identity, limits)).toThrow('无损')
})

it.each([
  [{ result: 100, data: '270825' }, true, { state: 'accepted', voucherId: '270825' }],
  [{ result: 200, message: 'private explanation' }, true, { state: 'rejected', code: 200 }],
  [{ result: 300 }, true, { state: 'outcome-unknown' }],
  [{ result: 100, data: {} }, true, { state: 'outcome-unknown' }],
  [{ result: 100, data: '270825' }, false, { state: 'outcome-unknown' }],
  [null, true, { state: 'outcome-unknown' }],
] as const)('classifies provider response without equating acceptance with verification', (value, ok, outcome) => {
  expect(classifyVoucherSubmission(value, ok)).toEqual(outcome)
})

it.each(['response-loss', 'cancel-after-send', 'accepted', 'wrong-account', 'config-changed'] as const)(
  'never retries the creation endpoint with transient read retries enabled: %s', async (mode) => {
    const stopped = new AbortController()
    const writes: object[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'fixture-token' })
      if (url.pathname === '/finance/auxiliary/queryAccountList.rjson') return Response.json({ result: 100,
        data: [{ id: mode === 'wrong-account' ? 'other' : '35616', sobName: identity.accountName }] })
      expect(url.pathname).toBe('/finance/certificate/createCertificate.rjson')
      expect(typeof init.body).toBe('string')
      const payload: unknown = JSON.parse(init.body as string)
      if (typeof payload !== 'object' || payload === null) throw new Error('Missing payload')
      writes.push(payload)
      if (mode === 'cancel-after-send') stopped.abort()
      if (mode === 'response-loss' || mode === 'cancel-after-send') {
        throw new TypeError('private fixture-token', { cause: { code: 'ECONNRESET' } })
      }
      return Response.json({ result: 100, data: '270825' })
    }))
    const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000, true)
    const outcome = await adapter.sendReservedVoucher(config, 'fixture-secret', input, identity, stopped.signal, limits, async () => {
      if (mode === 'config-changed') throw new Error('Configuration changed during authentication')
    })
    const notSent = mode === 'wrong-account' || mode === 'config-changed'
    expect(writes).toHaveLength(notSent ? 0 : 1)
    expect(outcome.state).toBe(notSent ? 'not-sent' : mode === 'accepted' ? 'accepted' : 'outcome-unknown')
    expect(JSON.stringify(outcome)).not.toContain('fixture')
  },
)
