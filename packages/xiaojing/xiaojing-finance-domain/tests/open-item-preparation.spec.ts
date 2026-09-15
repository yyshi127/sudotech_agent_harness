import { expect, it } from 'vitest'
import { buildOpenItemSubmission, resolveOpenItemCounterparty, validateOpenItemPreparation } from '../src/open-item-preparation.ts'
import { projectReferences, type ReferenceRow } from '../src/references.ts'

const ledger = { id: '35616', name: '施的演示账套' }
const input = { direction: 'receivable', accountId: '174626', categoryId: '578259',
  auxiliaryCategoryCode: '01', auxiliaryItemId: '191501', date: '2022-01-01', amount: '0.03',
  summary: ' 应收测试 ', keeperName: '施' }
const prepare = (extra: object = {}) => validateOpenItemPreparation({ ...input, ...extra }, 8192)
const categories = () => projectReferences([{ id: 101, categoryCode: '01', categoryName: '客户' },
  { id: 102, categoryCode: '02', categoryName: '供应商' }], { kind: 'auxiliary-categories' }, ledger, 100, 65536)
const items = () => projectReferences([{ id: 191501, itemCode: '03', itemName: '淘云科技', categoryId: 101 }],
  { kind: 'auxiliary-items', categoryCode: '01' }, ledger, 100, 65536, '101')

it('assembles category-qualified counterparty names from returned identities, not a model-provided wire string', () => {
  const proposal = prepare()
  const selected = resolveOpenItemCounterparty(proposal, ledger, categories(), items())
  expect(selected).toMatchObject({ categoryId: '101', categoryCode: '01', categoryName: '客户',
    itemId: '191501', itemCode: '03', itemName: '淘云科技', itemStatus: 'unknown', wireName: '客户:淘云科技' })
  expect(buildOpenItemSubmission(proposal, ledger.name, '其他收入', selected)).toEqual({
    booksName: ledger.name, categoryName: '其他收入', auxiliaryItemNames: '客户:淘云科技',
    direction: false, date: '2022-01-01', abstractStr: '应收测试', money: 0.03,
    resource: 1, accountId: 174626, keeperName: '施',
  })
})

it('maps payable independently with the selected supplier category and true direction', () => {
  const proposal = prepare({ direction: 'payable', accountId: '174624', categoryId: '578260',
    auxiliaryCategoryCode: '02', auxiliaryItemId: '191573', amount: '0.05' })
  const suppliers = projectReferences([{ id: 191573, itemCode: 'F3A04', itemName: 'F3主应用供应商测试', categoryId: 102 }],
    { kind: 'auxiliary-items', categoryCode: '02' }, ledger, 100, 65536, '102')
  const selected = resolveOpenItemCounterparty(proposal, ledger, categories(), suppliers)
  expect(buildOpenItemSubmission(proposal, ledger.name, '其他支出', selected)).toMatchObject({
    auxiliaryItemNames: '供应商:F3主应用供应商测试', direction: true, accountId: 174624, money: 0.05,
  })
})

it.each(['0.00', '-1.00', '1', '1.001', '1e3', '9007199254740993.00'])('rejects invalid or unsafe money %s', (amount) => {
  expect(() => prepare({ amount })).toThrow()
})

it('rejects arbitrary wire parameters, impossible dates and unsafe IDs at the proposal boundary', () => {
  for (const extra of [{ auxiliaryItemNames: '客户:淘云科技' }, { booksName: '另一账套' }, { resource: 3 },
    { date: '2022-02-29' }, { amount: 0.03 }, { accountId: '9007199254740993' },
    { summary: ' ' }, { keeperName: '' }, { categoryId: '0' }, { auxiliaryItemId: '-1' }]) {
    expect(() => prepare(extra)).toThrow()
  }
  const bytes = Buffer.byteLength(JSON.stringify(prepare()))
  expect(validateOpenItemPreparation(input, bytes)).toEqual(prepare())
  expect(() => validateOpenItemPreparation(input, bytes - 1)).toThrow('大小')
})

it('rejects wrong-ledger, wrong-category, filtered, missing and ambiguous reference sets', () => {
  for (const result of [{ ...items(), accountId: '35601' }, { ...items(), accountName: '其他账套' },
    { ...items(), categoryCode: '02' }, { ...items(), rows: [] }, { ...items(), selection: 'unique-returned' as const },
    { ...items(), rows: [...items().rows, { ...items().rows[0]!, id: '191502' as ReferenceRow['id'] }] }]) {
    expect(() => resolveOpenItemCounterparty(prepare(), ledger, categories(), result)).toThrow()
  }
  expect(() => resolveOpenItemCounterparty(prepare(), ledger, { ...categories(), accountId: '35601' }, items())).toThrow()
  expect(() => resolveOpenItemCounterparty(prepare(), ledger, { ...categories(), rows: [] }, items())).toThrow()
})

it('rejects disabled items and names that would make the colon-delimited field ambiguous', () => {
  for (const itemName of ['客户:淘云科技', '淘云,科技', '淘云\n科技']) {
    const bad = { ...items(), rows: items().rows.map(row => ({ ...row, name: itemName })) }
    expect(() => resolveOpenItemCounterparty(prepare(), ledger, categories(), bad)).toThrow()
  }
  const disabled = { ...items(), rows: items().rows.map(row => ({ ...row, status: 'disabled' as const })) }
  expect(() => resolveOpenItemCounterparty(prepare(), ledger, categories(), disabled)).toThrow()
  const sameNameCategories = { ...categories(), rows: categories().rows.map(row => ({ ...row, name: '客户' })) }
  expect(() => resolveOpenItemCounterparty(prepare(), ledger, sameNameCategories, items())).toThrow()
})

it('rejects a counterparty selection from another proposal instead of silently rebuilding it', () => {
  const proposal = prepare()
  const selected = resolveOpenItemCounterparty(proposal, ledger, categories(), items())
  for (const changed of [{ ...selected, categoryCode: '02' },
    { ...selected, itemId: '191573' as ReferenceRow['id'] }, { ...selected, wireName: '淘云科技' }]) {
    expect(() => buildOpenItemSubmission(proposal, ledger.name, '其他收入', changed)).toThrow('不一致')
  }
})
