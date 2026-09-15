import { afterEach, expect, it, vi } from 'vitest'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { classifyOpenItemWriteOff, validateOpenItemWriteOff } from '../src/open-item-write-off.ts'
import { projectOpenItems } from '../src/open-items.ts'
import { projectReferences } from '../src/references.ts'
import { YouchengConnection } from '../src/youcheng.ts'

afterEach(() => vi.unstubAllGlobals())

const unsafeRawStates = {
  'disabled-business-account': { accountStatus: 1 },
  'missing-account-status': { accountStatus: undefined },
  'wrong-raw-ledger': { setOfBooksId: 35601 },
  'missing-business-account': { subjectId: undefined },
  'invalid-business-account': { subjectId: 0 },
  'changed-business-account': { subjectId: 999999 },
  'linked-voucher': { certificateId: 244058 },
  'linked-temp-voucher': { tempCertificateId: '244058' },
  'linked-voucher-text': { certificateWordAndCode: '记-1' },
  'linked-order': { orderCode: 'order-1' },
  'missing-link-state': { orderCode: undefined },
}
const safeLinkStates = {
  'empty-link-ids': { certificateId: '', tempCertificateId: '' },
  'zero-link-ids': { certificateId: 0, tempCertificateId: '0' },
  'omitted-link-ids': { certificateId: undefined, tempCertificateId: undefined },
}

it.each([
  [{ result: 100, data: '65833' }, true, { state: 'accepted', receiptId: '65833' }],
  [{ result: 199, data: '65834' }, true, { state: 'accepted', receiptId: '65834' }],
  [{ result: 201, message: 'vendor details' }, true, { state: 'rejected', code: 201 }],
  [{ result: 299 }, true, { state: 'rejected', code: 299 }],
  [{ result: 100, data: '65833' }, false, { state: 'outcome-unknown' }],
  [{ result: 100, data: 65833 }, true, { state: 'outcome-unknown' }],
  [{ result: 100, data: { journalId: '141108' } }, true, { state: 'outcome-unknown' }],
  [{ result: 100, data: '0' }, true, { state: 'outcome-unknown' }],
  [{ result: 100, data: '9'.repeat(201) }, true, { state: 'outcome-unknown' }],
  [{ result: 100 }, true, { state: 'outcome-unknown' }],
  [{ result: '100', data: '65833' }, true, { state: 'outcome-unknown' }],
  [{ result: 300 }, true, { state: 'outcome-unknown' }],
  [null, true, { state: 'outcome-unknown' }],
])('classifies write-off receipt %# without inventing journal linkage', (body, httpOk, expected) => {
  expect(classifyOpenItemWriteOff(body, httpOk)).toEqual(expected)
})

for (const direction of ['receivable', 'payable'] as const) {
  it.each(['accepted', 'rejected', 'lost', 'cancel-after', 'bad-json', 'http-error', 'secret-echo', 'oversized',
    'missing-secret', 'wrong-ledger', 'wrong-cash-ledger', 'wrong-cash-kind', 'disabled-cash', 'missing-currency', 'missing-cash',
    'changed-target', 'changed-cash', 'ambiguous-name', 'renamed-ledger', 'reservation-failed', 'cancel-before',
    'already-cancelled', 'mutated-input', 'mutated-config', 'partial', 'wrong-direction', 'missing-target', 'query-denied',
    'unbound-business-account', 'auth-denied', 'cash-query-denied', ...Object.keys(unsafeRawStates), ...Object.keys(safeLinkStates)])(
    `sends at most one full ${direction} settlement for %s`, async (mode) => {
      const ledger = { id: '35616', name: '测试账套' }
      const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: ledger.id }
      const limits = { maxRows: 100, maxBytes: 30000 }
      const raw = { id: 72606, setOfBooksId: 35616, date: '2022-01-01', abstractStr: '核销专用',
        subjectId: direction === 'receivable' ? 174626 : 174624, accountStatus: 0,
        certificateWordAndCode: '', orderCode: '', certificateId: null, tempCertificateId: null,
        subjectCode: '', subjectName: '往来账户', auxiliaryItemIds: '191501', auxiliaryItemName: '测试客户',
        currencyCode: 'RMB', baseCurrencyCode: 'RMB', money: 0.19, balance: 0.19,
        thisMoney: 0, badMoney: 0, hedgeMoney: 0, returnMoney: 0, initialBalance: false, isFinish: false, categoryName: '其他收入', remark: '' }
      const cash = { accountId: 174622, accountName: '库存现金', status: 0, direction: 0, currencyId: '1', type: 1, subjectCode: '1001' }
      const sourceQuery = { direction, periodStart: '2022-01', periodEnd: '2022-01', page: 1, pageSize: 100 }
      const input = validateOpenItemWriteOff({ direction, openItemId: '72606', cashAccountId: '174622', amount: '0.19',
        currencyCode: 'RMB', date: '2022-01-09', keeperName: '测试制单人', sourceQuery }, limits.maxBytes)
      const source = projectOpenItems({ count: 1, list: [raw] }, sourceQuery, ledger, limits.maxRows, limits.maxBytes)
      const cashAccounts = projectReferences([cash], { kind: 'cash-accounts' }, ledger, limits.maxRows, limits.maxBytes)
      const evidence = { input, source, cashAccounts,
        ...mode === 'unbound-business-account' ? {} : { businessAccountId: String(raw.subjectId) as Branded<'FinanceReferenceId'> } }
      if (mode === 'wrong-ledger') config.accountCode = '35601'
      if (mode === 'wrong-cash-ledger') cashAccounts.accountId = '35601'
      if (mode === 'wrong-cash-kind') cashAccounts.kind = 'subjects'
      if (mode === 'disabled-cash') cashAccounts.rows[0]!.status = 'disabled'
      if (mode === 'missing-currency') delete cashAccounts.rows[0]!.currencyId
      if (mode === 'missing-cash') cashAccounts.rows = []
      if (mode === 'missing-target') source.rows = []
      if (mode === 'partial') input.amount = '0.18'
      if (mode === 'wrong-direction') input.direction = direction === 'receivable' ? 'payable' : 'receivable'
      const controller = new AbortController()
      if (mode === 'already-cancelled') controller.abort()
      let writes = 0
      let reserved = false
      vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
        if (url.pathname === '/auth/getAccessToken.rjson') return Response.json(mode === 'auth-denied'
          ? { result: 201 } : { result: 100, data: 'fake-token' })
        if (url.pathname === '/finance/auxiliary/queryAccountList.rjson') return Response.json({ result: 100, data: [
          { id: ledger.id, sobName: mode === 'renamed-ledger' ? '新账套名' : ledger.name },
          ...mode === 'ambiguous-name' ? [{ id: '35601', sobName: ledger.name }] : [],
        ] })
        if (url.pathname === '/finance/cashjournal/getCashierList') {
          if (mode === 'query-denied') return Response.json({ result: 201 })
          return Response.json({ result: 100, data: { count: 1, list: [{ ...raw,
            ...unsafeRawStates[mode as keyof typeof unsafeRawStates],
            ...safeLinkStates[mode as keyof typeof safeLinkStates],
            ...mode === 'changed-target' ? { balance: 0.18 } : {} }] } })
        }
        if (url.pathname === '/finance/cashjournal/getAccountList.rjson') return Response.json(mode === 'cash-query-denied'
          ? { result: 201 } : { result: 100, data: [{ ...cash, ...mode === 'changed-cash' ? { status: 1 } : {} }] })
        expect(url.pathname).toBe('/finance/cashier/account/management/writeOff.rjson')
        expect(reserved).toBe(true)
        expect(init.redirect).toBe('error')
        if (typeof init.body !== 'string') throw new Error('Expected JSON request')
        expect(JSON.parse(init.body)).toEqual({ booksName: ledger.name, direction: direction === 'payable', money: 0.19,
          accountManagementId: 72606, accountId: 174622, date: '2022-01-09', resource: 1, type: 1, keeperName: '测试制单人' })
        writes++
        if (mode === 'lost') throw new Error('response lost')
        if (mode === 'cancel-after') { controller.abort(); throw new Error('cancelled after dispatch') }
        if (mode === 'bad-json') return new Response('broken')
        if (mode === 'oversized') return Response.json({ result: 100, data: '65833', message: 'x'.repeat(limits.maxBytes) })
        if (mode === 'secret-echo') return Response.json({ result: 100, data: '65833', message: 'fake-secret' })
        if (mode === 'rejected') return Response.json({ result: 201 })
        return Response.json({ result: 100, data: direction === 'receivable' ? '65833' : '65834' },
          { status: mode === 'http-error' ? 500 : 200 })
      }))
      const reserve = vi.fn(async () => {
        if (mode === 'reservation-failed') throw new Error('not authorized or not durable')
        if (mode === 'cancel-before') controller.abort()
        if (mode === 'mutated-input') input.amount = '0.18'
        if (mode === 'mutated-config') config.accountCode = '35601'
        reserved = true
      })
      const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 2000, true)
      const result = await adapter.sendReservedOpenItemWriteOff(config, mode === 'missing-secret' ? undefined : 'fake-secret',
        evidence, controller.signal, limits, reserve)
      if (['accepted', 'rejected', 'lost', 'cancel-after', 'bad-json', 'http-error', 'secret-echo', 'oversized'].includes(mode)
        || mode in safeLinkStates) {
        expect(writes).toBe(1)
        expect(reserve).toHaveBeenCalledTimes(1)
        expect(result).toEqual(mode === 'accepted' || mode in safeLinkStates
          ? { state: 'accepted', receiptId: direction === 'receivable' ? '65833' : '65834' }
          : mode === 'rejected' ? { state: 'rejected', code: 201 } : { state: 'outcome-unknown' })
      } else {
        expect(writes).toBe(0)
        if (mode in unsafeRawStates) expect(reserve).not.toHaveBeenCalled()
        expect(result).toMatchObject({ state: 'not-sent', reason: ['cancel-before', 'already-cancelled'].includes(mode)
          ? 'cancelled' : 'preflight-failed' })
        const expectedStage = mode === 'auth-denied' ? 'authentication'
          : ['changed-cash', 'renamed-ledger', 'changed-business-account'].includes(mode) ? 'evidence-comparison'
            : mode === 'query-denied' || mode === 'changed-target' || mode in unsafeRawStates ? 'source-read'
              : ['cash-query-denied', 'ambiguous-name'].includes(mode) ? 'cash-read'
                : ['reservation-failed', 'cancel-before'].includes(mode) ? 'final-confirmation'
                  : ['mutated-input', 'mutated-config'].includes(mode) ? 'request-integrity'
                    : ['disabled-cash', 'missing-currency', 'missing-cash'].includes(mode) ? 'cash-account' : 'input'
        expect(result).toMatchObject({ preflightStage: expectedStage })
      }
      expect(JSON.stringify(result)).not.toMatch(/fake-key|fake-secret|fake-token|journalId/)
    })
}
