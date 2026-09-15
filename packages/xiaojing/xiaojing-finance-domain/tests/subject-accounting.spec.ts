import { afterEach, expect, it, vi } from 'vitest'
import { resolveSubjectAccounting, resolveSubjectReferences, validateSubjectPreparation } from '../src/subject-preparation.ts'
import { buildSubjectSubmission, compareSubjectReadback } from '../src/subject-submission.ts'
import { projectReferences } from '../src/references.ts'
import { YouchengConnection } from '../src/youcheng.ts'

const account = { id: '35616', name: '测试账套' }
const raw = [{ subjectCode: '1002', subjectName: '银行存款', parentSubjectCode: '', hasChild: true, enableStatus: '1',
  numberUnit: '', subjectType: '流动资产', auxiliaryList: [], currencyList: [] },
{ subjectCode: '100299', subjectName: '已有外币科目', parentSubjectCode: '1002', hasChild: false, enableStatus: '1',
  numberUnit: '', subjectType: '流动资产', auxiliaryList: [], currencyList: [{ currencyCode: 'USD', currencyName: '美元' }] }]
const categoryRows = [{ id: '473814', categoryCode: '01', categoryName: '客户' }]
const refs = (rows: unknown[] = raw) => projectReferences(rows, { kind: 'subjects' }, account, 1000, 100000)
const categories = projectReferences(categoryRows, { kind: 'auxiliary-categories' }, account, 1000, 100000)
const scalar = { subjectCode: '100294', subjectName: '核算配置测试', parentCode: '1002', subjectCategory: '1',
  subjectType: '流动资产', direction: 'debit', status: 'enabled', numberUnit: null, documentMaker: '施' }
const choices = { auxiliaryCategoryCodes: ['01'], currencyCodes: ['USD'] }
const input = validateSubjectPreparation({ ...scalar, accounting: choices }, 100000)
const accounting = resolveSubjectAccounting(input, refs(), raw, categories)!
const selection = { ...resolveSubjectReferences(input, account, refs()), accounting }
const saved = { ...raw[0], subjectCode: input.subjectCode, subjectName: input.subjectName, parentSubjectCode: '1002',
  hasChild: false, balanceDirection: '0', auxiliaryList: categoryRows, currencyList: raw[1]!.currencyList }
afterEach(() => vi.unstubAllGlobals())

it.each([{ auxiliaryCategoryCodes: ['01'], currencyCodes: [] }, { auxiliaryCategoryCodes: [], currencyCodes: ['USD'] }, choices])
('maps exact requested accounting choices %j and independently reads the same configuration', (choice) => {
  const proposal = validateSubjectPreparation({ ...scalar, accounting: choice }, 100000)
  const selected = { ...selection, accounting: resolveSubjectAccounting(proposal, refs(), raw, categories) }
  expect(buildSubjectSubmission(proposal, selected)).toMatchObject({
    auxiliaryCategorySimpleList: choice.auxiliaryCategoryCodes.map(categoryCode => ({ categoryCode, checked: true })),
    foreignCurrencySimpleList: choice.currencyCodes.map(currencyCode => ({ currencyCode, checked: true })),
    subjectAuxiliary: choice.auxiliaryCategoryCodes.length > 0,
  })
  const row = { ...saved, auxiliaryList: choice.auxiliaryCategoryCodes.length ? categoryRows : [],
    currencyList: choice.currencyCodes.length ? raw[1]!.currencyList : [] }
  expect(compareSubjectReadback(refs([row]), [row], proposal, selected))
    .toEqual({ content: 'matched', configuration: 'matched', complete: true })
})

it.each([{ auxiliaryCategoryCodes: ['01', '01'], currencyCodes: [] }, { currencyCodes: ['USD'] },
  { auxiliaryCategoryCodes: [], currencyCodes: ['USD', 'USD'] }, { ...choices, exchangeRate: 7 },
  { auxiliaryCategoryCodes: [''], currencyCodes: [] }])('rejects incomplete, duplicated or arbitrary accounting input %j', (choice) => {
  expect(() => validateSubjectPreparation({ ...scalar, accounting: choice }, 100000)).toThrow()
})

it('preserves ordinary proposals and rejects unbound accounting selections', () => {
  const plain = validateSubjectPreparation(scalar, 100000)
  expect(resolveSubjectAccounting(plain, refs(), raw, undefined)).toBeUndefined()
  expect(() => buildSubjectSubmission(input, { ...selection, accounting: undefined })).toThrow('核算配置')
  expect(() => buildSubjectSubmission(plain, selection)).toThrow('核算配置')
  expect(() => buildSubjectSubmission(input, { ...selection, accounting: { ...accounting, currencies: [] } })).toThrow('核算配置')
})

it('requires current unique category identity and observed non-conflicting currency names', () => {
  for (const other of [undefined, { ...categories, accountId: '35601' }, { ...categories, accountName: '其他账套' },
    { ...categories, selection: 'unique-returned' as const }, { ...categories, rows: [] },
    { ...categories, rows: [...categories.rows, ...categories.rows] },
    { ...categories, rows: categories.rows.map(row => ({ ...row, status: 'disabled' as const })) }]) {
    expect(() => resolveSubjectAccounting(input, refs(), raw, other)).toThrow()
  }
  for (const other of [[raw[0]], [...raw, { currencyList: [{ currencyCode: 'USD', currencyName: '不同名称' }] }]]) {
    expect(() => resolveSubjectAccounting(input, refs(), other, categories)).toThrow('币种')
  }
  expect(() => resolveSubjectAccounting(input, { ...refs(), selection: 'unique-returned' }, raw, categories)).toThrow()
})

it.each([{ auxiliaryList: [] }, { currencyList: [] }, { auxiliaryList: [...categoryRows, ...categoryRows] },
  { auxiliaryList: [{ ...categoryRows[0], id: '999' }] }, { currencyList: [{ currencyCode: 'USD', currencyName: '改名' }] }])
('keeps changed or duplicated stored configuration mismatched %j', (change) => {
  const row = { ...saved, ...change }
  expect(compareSubjectReadback(refs([row]), [row], input, selection))
    .toEqual({ content: 'matched', configuration: 'mismatch', complete: false })
})

it.each(['category-change', 'currency-change', 'stable'] as const)('re-resolves option identity before sending: %s', async (mode) => {
  let changed = false
  let writes = 0
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'test-token' })
    if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: account.id, sobName: account.name }] })
    if (url.pathname.includes('queryAuxiliaryCategoryList')) return Response.json({ result: 100,
      data: changed && mode === 'category-change' ? [{ ...categoryRows[0], id: '999' }] : categoryRows })
    if (url.pathname.includes('querySubjectInfoList')) return Response.json({ result: 100,
      data: changed && mode === 'currency-change' ? [raw[0]] : raw })
    expect(url.pathname).toBe('/finance/subject/add.rjson')
    writes++
    return Response.json({ result: 100, data: '' })
  }))
  const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000)
  const config = { system: 'youcheng' as const, environment: 'test' as const, accountCode: account.id, appKey: 'test-key' }
  const proposal = { kind: 'subject' as const, input }
  const signal = new AbortController().signal
  const original = await adapter.prepareMasterData(config, 'test-secret', proposal, signal, 1000, 100000)
  expect(original.references).toMatchObject({ accounting })
  changed = true
  const outcome = await adapter.sendReservedMasterData(config, 'test-secret', proposal, original.references, signal, 100000, async () => {
    const fresh = await adapter.prepareMasterData(config, 'test-secret', proposal, signal, 1000, 100000)
    if (JSON.stringify(fresh) !== JSON.stringify(original)) throw new Error('Fresh accounting differs')
  })
  expect(outcome.state).toBe(mode === 'stable' ? 'accepted' : 'not-sent')
  expect(writes).toBe(mode === 'stable' ? 1 : 0)
})
