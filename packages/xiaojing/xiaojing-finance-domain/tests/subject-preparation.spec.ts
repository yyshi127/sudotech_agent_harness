import { expect, it } from 'vitest'
import { resolveSubjectReferences, validateSubjectPreparation } from '../src/subject-preparation.ts'
import { projectReferences } from '../src/references.ts'

const account = { id: '35616', name: '施的演示账套' }
const proposal = { subjectCode: '100298', subjectName: ' F3科目测试 ', parentCode: '1002', subjectCategory: '1',
  subjectType: '流动资产', direction: 'debit', status: 'enabled', documentMaker: '小兢测试', numberUnit: null }
const parent = { subjectCode: '1002', subjectName: '银行存款', parentSubjectCode: '', enableStatus: '1', hasChild: true }
const refs = (rows: unknown[] = [parent]) => projectReferences(rows, { kind: 'subjects' }, account, 100, 100000)

it('normalizes the explicit proposal without translating vendor direction flags', () => {
  expect(validateSubjectPreparation(proposal, 10000)).toEqual({ ...proposal, subjectName: 'F3科目测试' })
  expect(validateSubjectPreparation({ ...proposal, direction: 'credit', status: 'disabled', numberUnit: ' 个 ' }, 10000))
    .toMatchObject({ direction: 'credit', status: 'disabled', numberUnit: '个' })
})

it.each([{ subjectCode: '10029' }, { subjectCode: '100298010101' }, { subjectCode: '100298', parentCode: '1001' },
  { subjectCode: '10029801', parentCode: '1002' }, { subjectCategory: '2' }, { subjectName: '名'.repeat(21) },
  { subjectName: ' ' }, { subjectType: '' }, { documentMaker: '' }, { direction: 0 }, { status: undefined },
  { numberUnit: '' }, { numberUnit: '字'.repeat(11) }, { accountName: '其他账套' }, { balanceDirection: true },
  { parentSubjectId: 334265 }, { approval: true }])('rejects invalid or extra proposal fields %j', (change) => {
  expect(() => validateSubjectPreparation({ ...proposal, ...change }, 10000)).toThrow()
})

it('accepts explicit root and deeper parent relationships and enforces exact UTF-8 capacity', () => {
  expect(validateSubjectPreparation({ ...proposal, subjectCode: '1098', parentCode: null }, 10000).parentCode).toBeNull()
  expect(validateSubjectPreparation({ ...proposal, subjectCode: '10029801', parentCode: '100298' }, 10000).parentCode).toBe('100298')
  const input = validateSubjectPreparation(proposal, 10000)
  const bytes = Buffer.byteLength(JSON.stringify(input))
  expect(validateSubjectPreparation(input, bytes)).toEqual(input)
  expect(() => validateSubjectPreparation(input, bytes - 1)).toThrow('大小')
})

it('retains the resolved existing branch without claiming exhaustive references or write qualification', () => {
  const input = validateSubjectPreparation(proposal, 10000)
  expect(resolveSubjectReferences(input, account, refs())).toEqual({ accountId: account.id, accountName: account.name,
    parent: { code: '1002', name: '银行存款' }, parentImpact: 'existing-branch', sameNameElsewhere: [] })
  const root = validateSubjectPreparation({ ...proposal, subjectCode: '1098', parentCode: null }, 10000)
  expect(resolveSubjectReferences(root, account, refs())).toMatchObject({ parent: null, parentImpact: 'new-root' })
})

it.each([false, undefined])('requires historical impact checks before promoting a parent with hasChild=%s', (hasChild) => {
  const input = validateSubjectPreparation(proposal, 10000)
  expect(resolveSubjectReferences(input, account, refs([{ ...parent, hasChild }])).parentImpact).toBe('requires-leaf-promotion-check')
})

it('rejects another ledger, filtered results, duplicates and unavailable parents', () => {
  const input = validateSubjectPreparation(proposal, 10000)
  for (const invalid of [{ ...refs(), accountId: '35601' }, { ...refs(), accountName: '其他账套' },
    { ...refs(), selection: 'unique-returned' as const }, refs([]),
    refs([{ ...parent, enableStatus: '0' }]), refs([{ ...parent, enableStatus: undefined }]),
    refs([parent, { ...parent, subjectCode: input.subjectCode }]),
    refs([parent, { ...parent, subjectCode: '100297', subjectName: input.subjectName, parentSubjectCode: '1002' }])]) {
    expect(() => resolveSubjectReferences(input, account, invalid)).toThrow()
  }
})

it('retains same-name subjects under different parents so confirmation cannot hide ambiguity', () => {
  const input = validateSubjectPreparation(proposal, 10000)
  const result = resolveSubjectReferences(input, account, refs([parent,
    { ...parent, subjectCode: '101201', subjectName: input.subjectName, parentSubjectCode: '1012' }]))
  expect(result.sameNameElsewhere).toEqual([{ code: '101201', parentCode: '1012' }])
})
