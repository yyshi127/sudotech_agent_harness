import { afterEach, expect, it, vi } from 'vitest'
import { classifyJournalSubmission } from '../src/journal-submission.ts'
import { validateJournalPreparation } from '../src/journal-preparation.ts'
import { YouchengConnection } from '../src/youcheng.ts'

const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: '35616' }
const input = validateJournalPreparation({ cashAccountId: '174622', date: '2022-01-01', direction: 'expense',
  amount: '0.20', summary: '测试', keeperName: '测试' }, 10000)
const selection = { accountId: '35616', accountName: '测试账套', cashAccountId: input.cashAccountId,
  cashAccountCode: '1001', cashAccountName: '库存现金' }
const adapter = () => new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000, true)
afterEach(() => vi.unstubAllGlobals())

it('accepts only successful bounded string IDs and never returns vendor prose', () => {
  expect(classifyJournalSubmission({ result: 100, data: '253183', message: 'private' }, true))
    .toEqual({ state: 'accepted', journalId: '253183' })
  expect(classifyJournalSubmission({ result: 201, message: 'private' }, true)).toEqual({ state: 'rejected', code: 201 })
  for (const value of [{ result: 100, data: 253183 }, { result: 100, data: '0' }, { result: 100, data: '9'.repeat(201) },
    { result: 100, data: {} }, { result: 500 }, { result: '100', data: '253183' }]) {
    expect(classifyJournalSubmission(value, true)).toEqual({ state: 'outcome-unknown' })
  }
  expect(classifyJournalSubmission({ result: 100, data: '253183' }, false)).toEqual({ state: 'outcome-unknown' })
})

it.each(['accepted', 'lost', 'cancelled-after-response', 'http-error'] as const)('sends once with %s outcome even when read retries are enabled', async (mode) => {
  let writes = 0
  const stop = new AbortController()
  const before = vi.fn(async () => {})
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35616', sobName: '测试账套' }] })
    expect(url.pathname).toBe('/finance/cashjournal/add.rjson')
    expect(before).toHaveBeenCalledTimes(1)
    if (typeof init.body !== 'string') throw new Error('Expected JSON body')
    expect(JSON.parse(init.body)).toEqual({ accountName: '测试账套', subjectId: 174622, date: '2022-01-01',
      abstractStr: '测试', keeperName: '测试', borrow: null, loan: 0.2, preId: 0 })
    writes += 1
    if (mode === 'lost') throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })
    if (mode === 'cancelled-after-response') stop.abort()
    return Response.json({ result: 100, data: '253183' }, { status: mode === 'http-error' ? 500 : 200 })
  }))
  const result = await adapter().sendReservedJournal(config, 'fake-secret', input, selection, '0', stop.signal, 10000, before)
  expect(result).toEqual(mode === 'lost' || mode === 'http-error' ? { state: 'outcome-unknown' } : { state: 'accepted', journalId: '253183' })
  expect(writes).toBe(1)
})

it('does not dispatch when the ledger changed or the final preflight fails', async () => {
  const fetcher = vi.fn(async (url: URL) => {
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
    expect(url.pathname).toContain('queryAccountList')
    return Response.json({ result: 100, data: [{ id: '35616', sobName: '测试账套' }] })
  })
  vi.stubGlobal('fetch', fetcher)
  expect(await adapter().sendReservedJournal({ ...config, accountCode: '35601' }, 'fake-secret', input, selection, '0',
    new AbortController().signal, 10000, async () => {})).toEqual({ state: 'not-sent', reason: 'preflight-failed' })
  expect(fetcher).not.toHaveBeenCalled()
  expect(await adapter().sendReservedJournal(config, 'fake-secret', input, selection, '0', new AbortController().signal,
    10000, async () => { throw new Error('配置变化') })).toEqual({ state: 'not-sent', reason: 'preflight-failed' })
  expect(fetcher).toHaveBeenCalledTimes(2)
})
