import { expect, it, vi } from 'vitest'
import { projectReferences, type ReferenceQuery } from '../src/references.ts'
import { validateVoucherPreparation } from '../src/voucher-preparation.ts'
import { resolveVoucherReferences } from '../src/voucher-references.ts'

const account = { id: '35601', name: '测试账套' }
const proposal = () => validateVoucherPreparation({ date: '2026-09-09', documentMaker: '测试', sourcePaths: [], entries: [
  { summary: '测试', subjectCode: '1122', side: 'debit', amount: '10.00', auxiliary: [{ categoryCode: 'C', itemCode: '001' }] },
  { summary: '测试', subjectCode: '1122', side: 'credit', amount: '10.00', auxiliary: [{ categoryCode: 'C', itemCode: '001' }] },
] }, { maxEntries: 10, maxBytes: 10000 })
const subject = () => ({ subjectCode: '1122', subjectName: '应收账款', hasChild: false, enableStatus: '1',
  auxiliaryList: [{ id: 'c', categoryCode: 'C', categoryName: '客户' }], currencyList: [] })
const read = async (query: ReferenceQuery) => projectReferences(query.kind === 'subjects' ? [subject()]
  : [{ id: 'i', itemCode: '001', itemName: '客户甲', categoryId: 'c' }], query, account, 100, 10000, 'c')
const signal = () => new AbortController().signal

it('resolves exact codes and reuses identical lookups only within this preparation', async () => {
  const reader = vi.fn(read)
  const result = await resolveVoucherReferences(proposal(), account, reader, signal(), 10000)
  expect(result.entries[0]!.subject.name).toBe('应收账款')
  expect(result.entries[0]!.auxiliary[0]!.item.name).toBe('客户甲')
  expect(result.entries[0]!.auxiliary[0]!.item.status).toBe('unknown')
  expect(reader).toHaveBeenCalledTimes(2)
  await resolveVoucherReferences(proposal(), account, reader, signal(), 10000)
  expect(reader).toHaveBeenCalledTimes(4)
})

it.each(['disabled', 'parent', 'unknown-leaf', 'missing-auxiliary', 'missing-currency', 'wrong-auxiliary', 'foreign-required'])
('rejects unsuitable subject %s', async (failure) => {
  await expect(resolveVoucherReferences(proposal(), account, async (query) => {
    const result = await read(query)
    const row = result.rows[0]!
    if (failure === 'disabled') row.status = 'disabled'
    if (failure === 'parent') row.hasChildren = true
    if (failure === 'unknown-leaf') delete row.hasChildren
    if (failure === 'missing-auxiliary') delete row.auxiliaryCodes
    if (failure === 'missing-currency') delete row.currencyCodes
    if (failure === 'wrong-auxiliary') row.auxiliaryCodes = []
    if (failure === 'foreign-required') row.currencyCodes = ['USD']
    return result
  }, signal(), 10000)).rejects.toThrow()
})

it.each(['ledger', 'name', 'kind', 'category', 'missing', 'ambiguous', 'code'])
('rejects changed identity or unresolved selection %s', async (failure) => {
  await expect(resolveVoucherReferences(proposal(), account, async (query) => {
    const result = await read(query)
    if (failure === 'ledger') result.accountId = '999'
    if (failure === 'name') result.accountName = '其他账套'
    if (failure === 'kind') result.kind = 'cash-accounts'
    if (failure === 'category') result.categoryCode = 'wrong'
    if (failure === 'missing') result.rows = []
    if (failure === 'ambiguous') result.selection = 'ambiguous'
    if (failure === 'code') result.rows[0]!.code = 'wrong'
    return result
  }, signal(), 10000)).rejects.toThrow()
})

it('rejects auxiliary membership mismatch through the reference projection', async () => {
  await expect(resolveVoucherReferences(proposal(), account, async query => query.kind === 'subjects' ? read(query)
    : projectReferences([{ id: 'i', itemCode: '001', itemName: '客户甲', categoryId: 'other' }],
      query, account, 100, 10000, 'c'), signal(), 10000)).rejects.toThrow('类别不匹配')
})

it('checks cancellation after a pending read and bounds the complete preview', async () => {
  const controller = new AbortController()
  const reader = vi.fn(async (query: ReferenceQuery) => { controller.abort(); return read(query) })
  await expect(resolveVoucherReferences(proposal(), account, reader, controller.signal, 10000)).rejects.toThrow()
  expect(reader).toHaveBeenCalledTimes(1)
  await expect(resolveVoucherReferences(proposal(), account, read, signal(), 1)).rejects.toThrow('大小限制')
})
