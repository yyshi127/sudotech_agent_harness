import { expect, it } from 'vitest'
import { buildSubjectSubmission, compareSubjectReadback } from '../src/subject-submission.ts'
import { classifyMasterDataSubmission as classifySubjectSubmission } from '../src/master-data-submission.ts'
import { resolveSubjectReferences, validateSubjectPreparation } from '../src/subject-preparation.ts'
import { projectReferences } from '../src/references.ts'

const account = { id: '35616', name: '施的演示账套' }
const input = validateSubjectPreparation({ subjectCode: '100297', subjectName: 'F3借方测试', parentCode: '1002',
  subjectCategory: '1', subjectType: '流动资产', direction: 'debit', status: 'enabled', numberUnit: null, documentMaker: '施' }, 10000)
const parent = { subjectCode: '1002', subjectName: '银行存款', parentSubjectCode: '', enableStatus: '1', hasChild: true }
const refs = (rows: unknown[]) => projectReferences(rows, { kind: 'subjects' }, account, 1000, 1000000)
const selection = resolveSubjectReferences(input, account, refs([parent]))
const saved = { subjectCode: '100297', subjectName: 'F3借方测试', parentSubjectCode: '1002', subjectType: '流动资产',
  balanceDirection: '0', enableStatus: '1', hasChild: false, numberUnit: '', auxiliaryList: [], currencyList: [] }
const readback = (row: object) => compareSubjectReadback(refs([row]), [row], input, selection)

it('maps debit=false and credit=true without silently copying the inverted public description', () => {
  expect(buildSubjectSubmission(input, selection)).toEqual({ subjectCode: '100297', subjectName: 'F3借方测试',
    subjectCategory: '1', subjectType: '流动资产', balanceDirection: false, enableStatus: 1, documentMaker: '施',
    accountName: account.name, auxiliaryCategorySimpleList: [], foreignCurrencySimpleList: [], subjectAuxiliary: false })
  expect(buildSubjectSubmission({ ...input, direction: 'credit', status: 'disabled', numberUnit: '个' }, selection))
    .toMatchObject({ balanceDirection: true, enableStatus: 0, numberUnit: '个' })
})

it('rejects unqualified parent promotion and inconsistent parent selections', () => {
  for (const invalid of [{ ...selection, parentImpact: 'requires-leaf-promotion-check' as const },
    { ...selection, parent: null, parentImpact: 'new-root' as const },
    { ...selection, parent: { code: '1001', name: '库存现金' } }]) {
    expect(() => buildSubjectSubmission(input, invalid)).toThrow()
  }
})

const root = validateSubjectPreparation({ ...input, subjectCode: '1099', subjectName: 'F3一级科目测试', parentCode: null }, 10000)
const rootSelection = resolveSubjectReferences(root, account, refs([parent]))
const savedRoot = { ...saved, subjectCode: root.subjectCode, subjectName: root.subjectName, parentSubjectCode: '' }

it('maps a new root without a parent field and independently matches its explicit empty parent code', () => {
  expect(buildSubjectSubmission(root, rootSelection)).toEqual({ subjectCode: '1099', subjectName: 'F3一级科目测试',
    subjectCategory: '1', subjectType: '流动资产', balanceDirection: false, enableStatus: 1, documentMaker: '施',
    accountName: account.name, auxiliaryCategorySimpleList: [], foreignCurrencySimpleList: [], subjectAuxiliary: false })
  expect(compareSubjectReadback(refs([savedRoot]), [savedRoot], root, rootSelection))
    .toEqual({ content: 'matched', configuration: 'matched', complete: true })
  for (const invalid of [selection, { ...rootSelection, parentImpact: 'existing-branch' as const },
    { ...rootSelection, parent: selection.parent }]) expect(() => buildSubjectSubmission(root, invalid)).toThrow()
})

it.each([{ parentSubjectCode: undefined, expected: 'unavailable' }, { parentSubjectCode: null, expected: 'unavailable' },
  { parentSubjectCode: '1002', expected: 'mismatch' }])('does not infer root parentage from $parentSubjectCode', ({ parentSubjectCode, expected }) => {
  const row = { ...savedRoot, parentSubjectCode }
  expect(compareSubjectReadback(refs([savedRoot]), [row], root, rootSelection))
    .toEqual({ content: expected, configuration: 'matched', complete: false })
})

it('records empty-data acceptance separately from parameter rejection and unknown responses', () => {
  expect(classifySubjectSubmission({ result: 100, data: '', message: '操作成功' }, true)).toEqual({ state: 'accepted' })
  expect(classifySubjectSubmission({ result: 201, message: '提交人' }, true)).toEqual({ state: 'rejected', code: 201 })
  for (const response of [{ result: 100 }, { result: 101, data: '' }, { result: '100', data: '' },
    { result: 100, data: '123' }, { result: 500 }, {}]) {
    expect(classifySubjectSubmission(response, true)).toEqual({ state: 'outcome-unknown' })
  }
  expect(classifySubjectSubmission({ result: 100, data: '' }, false)).toEqual({ state: 'outcome-unknown' })
})

it('compares scalar fields and empty auxiliary/currency configuration independently', () => {
  expect(readback(saved)).toEqual({ content: 'matched', configuration: 'matched', complete: true })
  const credit = { ...input, direction: 'credit' as const }
  expect(compareSubjectReadback(refs([{ ...saved, balanceDirection: '1' }]), [{ ...saved, balanceDirection: '1' }], credit, selection).complete).toBe(true)
  expect(readback({ ...saved, balanceDirection: '1' })).toEqual({ content: 'mismatch', configuration: 'matched', complete: false })
})

it.each([{ subjectName: '别的名称' }, { parentSubjectCode: '1001' }, { subjectType: '非流动资产' }, { enableStatus: '0' }])
('rejects unexpected stored scalar fields %j', (change) => {
  expect(readback({ ...saved, ...change })).toEqual({ content: 'mismatch', configuration: 'matched', complete: false })
})

it.each([{ hasChild: true }, { numberUnit: '个' }, { currencyList: [{ currencyCode: 'USD', currencyName: '美元' }] },
  { auxiliaryList: [{ id: 473814, categoryCode: '01', categoryName: '客户' }] }])
('detects inherited or unexpected configuration %j', (change) => {
  expect(readback({ ...saved, ...change })).toEqual({ content: 'matched', configuration: 'mismatch', complete: false })
})

it.each(['balanceDirection', 'enableStatus', 'subjectType', 'parentSubjectCode'])('does not infer missing scalar %s', (field) => {
  const row = Object.fromEntries(Object.entries(saved).filter(([key]) => key !== field))
  expect(readback(row)).toEqual({ content: 'unavailable', configuration: 'matched', complete: false })
})

it.each(['hasChild', 'numberUnit', 'auxiliaryList', 'currencyList'])('does not infer missing configuration %s', (field) => {
  const row = Object.fromEntries(Object.entries(saved).filter(([key]) => key !== field))
  expect(readback(row)).toEqual({ content: 'matched', configuration: 'unavailable', complete: false })
})

it('keeps absent, malformed and ambiguous query results unavailable', () => {
  for (const raw of [[], [saved, saved], [{ subjectCode: 100297 }], null]) {
    expect(compareSubjectReadback(refs([saved]), raw, input, selection)).toEqual({ content: 'unavailable', configuration: 'unavailable', complete: false })
  }
  expect(compareSubjectReadback(refs([]), [saved], input, selection).complete).toBe(false)
  expect(compareSubjectReadback({ ...refs([saved]), accountId: '35601' }, [saved], input, selection).content).toBe('mismatch')
  expect(compareSubjectReadback({ ...refs([saved]), accountName: '其他账套' }, [saved], input, selection).content).toBe('mismatch')
})
