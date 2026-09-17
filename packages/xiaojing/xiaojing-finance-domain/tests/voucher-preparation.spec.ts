import { expect, it } from 'vitest'
import { validateVoucherPreparation } from '../src/voucher-preparation.ts'

const limits = { maxEntries: 10, maxBytes: 10000 }
const input = () => ({ date: '2026-09-09', documentMaker: '测试制单人', sourcePaths: [], entries: [
  { summary: '测试', subjectCode: '1002', side: 'debit', amount: '0.10', auxiliary: [] },
  { summary: '测试', subjectCode: '1002', side: 'debit', amount: '0.20', auxiliary: [] },
  { summary: '测试', subjectCode: '1001', side: 'credit', amount: '0.30', auxiliary: [] },
] })

it('adds decimal cents exactly and retains proposed entries without authorizing them', () => {
  const result = validateVoucherPreparation(input(), limits)
  expect(result.totalDebit).toBe('0.30')
  expect(result.totalCredit).toBe('0.30')
  expect(result.input.entries).toHaveLength(3)
  expect(result).not.toHaveProperty('approved')
})

it.each(['0.00', '-1.00', '1.001', '1e2', '01.00', ' 1.00', '1', 'NaN'])('rejects invalid money %s', (amount) => {
  const value = input()
  value.entries[0]!.amount = amount
  expect(() => validateVoucherPreparation(value, limits)).toThrow('输入无效')
})

it('rejects an unbalanced voucher and an invalid calendar date', () => {
  const value = input()
  value.entries[2]!.amount = '0.31'
  expect(() => validateVoucherPreparation(value, limits)).toThrow('借贷不平衡')
  expect(() => validateVoucherPreparation({ ...input(), date: '2026-02-30' }, limits)).toThrow('输入无效')
})

it.each(['accountId', 'appSecret', 'approved', 'attachmentUrlList'])('rejects caller-owned %s override', (key) => {
  expect(() => validateVoucherPreparation({ ...input(), [key]: 'override' }, limits)).toThrow('输入无效')
})

it('retains foreign-currency and auxiliary inputs after per-entry conversion checks', () => {
  const value = input()
  const result = validateVoucherPreparation({ ...value, sourcePaths: ['原件.pdf'], entries: value.entries.map(row => ({
    ...row, auxiliary: [{ categoryCode: 'CUSTOMER', itemCode: '001' }],
    foreignCurrency: { code: 'USD', amount: row.amount, exchangeRate: '1.000000' },
  })) }, limits)
  expect(result.input.entries[0]!.foreignCurrency?.exchangeRate).toBe('1.000000')
  expect(result.input.sourcePaths).toEqual(['原件.pdf'])
})

it.each([
  ['1.00', '1.005', '1.01'], ['1.00', '6.365', '6.37'], ['1.00', '6.364', '6.36'],
  ['0.10', '3', '0.30'], ['3000000.00', '0.0000001', '0.30'],
])('checks decimal half-up conversion %s at rate %s without binary rounding', (original, exchangeRate, amount) => {
  const entries = input().entries.slice(0, 2).map((row, index) => ({ ...row, amount,
    side: index === 0 ? 'debit' : 'credit', foreignCurrency: { code: 'USD', amount: original, exchangeRate } }))
  expect(validateVoucherPreparation({ ...input(), entries }, limits).totalDebit).toBe(amount)
  expect(() => validateVoucherPreparation({ ...input(), entries: entries.map(row => ({ ...row, amount: '99.00' })) }, limits))
    .toThrow('四舍五入')
})

it('rejects duplicate auxiliary categories and duplicate source files', () => {
  const value = input()
  expect(() => validateVoucherPreparation({ ...value, sourcePaths: ['a.pdf', 'a.pdf'] }, limits)).toThrow()
  expect(() => validateVoucherPreparation({ ...value, entries: value.entries.map(row => ({ ...row,
    auxiliary: [{ categoryCode: 'c', itemCode: '1' }, { categoryCode: 'c', itemCode: '2' }],
  })) }, limits)).toThrow()
})

it('rejects unsupported voucher attachments before creating a preview', () => {
  expect(() => validateVoucherPreparation({ ...input(), sourcePaths: ['发票.pdf', '合同.docx'] }, limits))
    .toThrow('来源文件仅支持 PDF、PNG、JPG 或 JPEG')
  expect(validateVoucherPreparation({ ...input(), sourcePaths: ['发票.PDF', '截图.png', '照片.jpg', '照片2.JPEG'] }, limits)
    .input.sourcePaths).toHaveLength(4)
})

it('enforces entry and full input byte limits', () => {
  expect(() => validateVoucherPreparation(input(), { ...limits, maxEntries: 2 })).toThrow('数量限制')
  expect(() => validateVoucherPreparation(input(), { ...limits, maxBytes: 1 })).toThrow('大小限制')
  expect(() => validateVoucherPreparation(undefined, limits)).toThrow('有效 JSON')
})

it('retains a proposed voucher number and rejects values outside the documented int32 positive range', () => {
  expect(validateVoucherPreparation({ ...input(), certificateCode: 35 }, limits).input.certificateCode).toBe(35)
  for (const certificateCode of [0, -1, 1.5, 2147483648, '35']) {
    expect(() => validateVoucherPreparation({ ...input(), certificateCode }, limits)).toThrow('输入无效')
  }
})
