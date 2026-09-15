import { expect, it } from 'vitest'
import { buildAuxiliarySubmission, resolveAuxiliaryReferences, validateAuxiliaryPreparation } from '../src/auxiliary-preparation.ts'
import { projectReferences } from '../src/references.ts'

const account = { id: '35616', name: '施的演示账套' }
const proposal = { categoryCode: '01', itemCode: 'F3A01', itemName: ' 小兢F3A测试客户 ', documentMaker: '小兢测试', status: 'enabled' }
const categories = () => projectReferences([{ id: '473814', categoryCode: '01', categoryName: '客户' }],
  { kind: 'auxiliary-categories' }, account, 100, 10000)
const items = (itemCode = '03', itemName = '已有客户') => projectReferences([{ id: '191501', itemCode, itemName, categoryId: '473814' }],
  { kind: 'auxiliary-items', categoryCode: '01' }, account, 100, 10000, '473814')

it.each(['enabled', 'disabled'] as const)('maps an explicit %s request using only the existing verified category', (status) => {
  const input = validateAuxiliaryPreparation({ ...proposal, status }, 10000)
  const selected = resolveAuxiliaryReferences(input, account, categories(), items())
  expect(selected).toEqual({ accountId: account.id, accountName: account.name, categoryId: '473814', categoryCode: '01', categoryName: '客户' })
  expect(buildAuxiliarySubmission(input, selected)).toEqual({ categoryCode: '01', itemCode: 'F3A01', itemName: '小兢F3A测试客户',
    documentMaker: '小兢测试', accountName: account.name, enableStatus: status === 'enabled' ? 1 : 0 })
})

it.each([{ status: undefined }, { status: 'unknown' }, { itemCode: '' }, { itemName: '  ' }, { documentMaker: '' },
  { categoryCode: '' }, { itemName: '名'.repeat(501) }, { accountName: '其他账套' }, { enableStatus: 1 }, { approval: true }])(
  'rejects incomplete or arbitrary fields %j', (change) => {
    expect(() => validateAuxiliaryPreparation({ ...proposal, ...change }, 10000)).toThrow()
  })

it('bounds the complete normalized proposal by UTF-8 bytes', () => {
  const normalized = validateAuxiliaryPreparation(proposal, 10000)
  const bytes = Buffer.byteLength(JSON.stringify(normalized), 'utf8')
  expect(validateAuxiliaryPreparation(proposal, bytes)).toEqual(normalized)
  expect(() => validateAuxiliaryPreparation(proposal, bytes - 1)).toThrow('大小')
})

it('rejects another ledger, wrong category, filtered references, and missing or ambiguous category codes', () => {
  const input = validateAuxiliaryPreparation(proposal, 10000)
  for (const invalid of [{ ...categories(), accountId: '35601' }, { ...categories(), accountName: '其他账套' },
    { ...categories(), selection: 'unique-returned' as const }, { ...categories(), rows: [] },
    { ...categories(), rows: [...categories().rows, ...categories().rows] }]) {
    expect(() => resolveAuxiliaryReferences(input, account, invalid, items())).toThrow()
  }
  for (const invalid of [{ ...items(), accountId: '35601' }, { ...items(), categoryCode: '02' },
    { ...items(), selection: 'not-found-in-returned' as const }]) {
    expect(() => resolveAuxiliaryReferences(input, account, categories(), invalid)).toThrow()
  }
})

it('rejects duplicate codes or names without turning creation into an update', () => {
  const input = validateAuxiliaryPreparation(proposal, 10000)
  expect(() => resolveAuxiliaryReferences(input, account, categories(), items(input.itemCode))).toThrow('编码')
  expect(() => resolveAuxiliaryReferences(input, account, categories(), items('04', input.itemName))).toThrow('同名')
  const selection = resolveAuxiliaryReferences(input, account, categories(), items())
  expect(() => buildAuxiliarySubmission(input, { ...selection, categoryCode: '02' })).toThrow('不一致')
})
