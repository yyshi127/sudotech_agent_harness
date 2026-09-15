import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { validateSubjectPreparation } from '../src/subject-preparation.ts'
import { validateAuxiliaryPreparation } from '../src/auxiliary-preparation.ts'
import { compareAuxiliaryReadback } from '../src/master-data-submission.ts'
import type { MasterDataProposal, MasterDataSelection } from '../src/master-data-records.ts'
import { YouchengConnection } from '../src/youcheng.ts'
import { projectReferences } from '../src/references.ts'

const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: '35616' }
const account = { id: '35616', name: '测试账套' }
const subject: MasterDataProposal = { kind: 'subject', input: validateSubjectPreparation({ subjectCode: '100297',
  subjectName: '测试科目', parentCode: '1002', subjectCategory: '1', subjectType: '流动资产', direction: 'debit',
  status: 'enabled', numberUnit: null, documentMaker: '施' }, 10000) }
const auxiliary: MasterDataProposal = { kind: 'auxiliary-item', input: validateAuxiliaryPreparation({ categoryCode: '02',
  itemCode: 'F3A02', itemName: '测试供应商', status: 'enabled', documentMaker: '施' }, 10000) }
const parent: MasterDataSelection = { kind: 'subject', accountId: account.id, accountName: account.name,
  parent: { code: '1002', name: '银行存款' }, parentImpact: 'existing-branch', sameNameElsewhere: [] }
const category: MasterDataSelection = { kind: 'auxiliary-item', accountId: account.id, accountName: account.name,
  categoryId: '473815' as Branded<'FinanceReferenceId'>, categoryCode: '02', categoryName: '供应商' }
const adapter = () => new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 1000, true)
afterEach(() => vi.unstubAllGlobals())

describe.each([{ proposal: subject, selection: parent, path: '/finance/subject/add.rjson' },
  { proposal: auxiliary, selection: category, path: '/finance/auxiliary/add.rjson' }])
('$proposal.kind sender', ({ proposal, selection, path }) => {
  it.each(['accepted', 'rejected', 'lost', 'cancelled-after-response', 'http-error', 'secret-echo'] as const)
  ('sends once with %s despite enabled read retries', async (mode) => {
    const stopped = new AbortController()
    let writes = 0
    const before = vi.fn(async () => {})
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
      if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: account.id, sobName: account.name }] })
      expect(url.pathname).toBe(path)
      expect(before).toHaveBeenCalledTimes(1)
      expect(init.redirect).toBe('error')
      if (typeof init.body !== 'string') throw new Error('Expected JSON')
      expect(JSON.parse(init.body)).toMatchObject({ accountName: account.name, documentMaker: '施', enableStatus: 1 })
      if (proposal.kind === 'subject') expect(JSON.parse(init.body)).toMatchObject({ balanceDirection: false, subjectCode: '100297' })
      else expect(JSON.parse(init.body)).toMatchObject({ categoryCode: '02', itemCode: 'F3A02', itemName: '测试供应商' })
      writes += 1
      if (mode === 'lost') throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })
      if (mode === 'cancelled-after-response') stopped.abort()
      return Response.json({ result: mode === 'rejected' ? 201 : 100, data: '', message: mode === 'secret-echo' ? 'fake-secret' : 'private prose' },
        { status: mode === 'http-error' ? 500 : 200 })
    }))
    const result = await adapter().sendReservedMasterData(config, 'fake-secret', proposal, selection, stopped.signal, 10000, before)
    expect(result).toEqual(mode === 'accepted' || mode === 'cancelled-after-response' ? { state: 'accepted' }
      : mode === 'rejected' ? { state: 'rejected', code: 201 } : { state: 'outcome-unknown' })
    expect(writes).toBe(1)
    expect(JSON.stringify(result)).not.toMatch(/fake-secret|private prose/)
  })

  it('does not send after ledger, reference or configuration changes', async () => {
    const fetcher = vi.fn(async (url: URL) => {
      if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
      expect(url.pathname).toContain('queryAccountList')
      return Response.json({ result: 100, data: [{ id: account.id, sobName: account.name }] })
    })
    vi.stubGlobal('fetch', fetcher)
    const stopped = new AbortController().signal
    expect(await adapter().sendReservedMasterData({ ...config, accountCode: '35601' }, 'fake-secret', proposal, selection,
      stopped, 10000, async () => {})).toEqual({ state: 'not-sent', reason: 'preflight-failed' })
    expect(fetcher).not.toHaveBeenCalled()
    expect(await adapter().sendReservedMasterData(config, 'fake-secret', proposal, selection, stopped, 10000,
      async () => { throw new Error('资料变化') })).toEqual({ state: 'not-sent', reason: 'preflight-failed' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

it('reports auxiliary identity separately from unavailable enabled status', () => {
  const input = validateAuxiliaryPreparation(auxiliary.input, 10000)
  const row = { id: '191568', categoryId: '473815', itemCode: 'F3A02', itemName: '测试供应商' }
  const refs = (rows: unknown[]) => projectReferences(rows, { kind: 'auxiliary-items', categoryCode: '02' }, account, 1000, 10000, '473815')
  expect(compareAuxiliaryReadback(refs([row]), input, category)).toEqual({ content: 'matched', status: 'unavailable', complete: false })
  expect(compareAuxiliaryReadback(refs([{ ...row, itemName: '其他供应商' }]), input, category).content).toBe('mismatch')
  expect(compareAuxiliaryReadback(refs([]), input, category).content).toBe('unavailable')
  expect(compareAuxiliaryReadback({ ...refs([row]), accountId: '35601' }, input, category).content).toBe('mismatch')
  expect(compareAuxiliaryReadback({ ...refs([row]), categoryCode: '01' }, input, category).content).toBe('mismatch')
})

describe('independent master-data readback', () => {
  const subjectRow = { subjectCode: '100297', subjectName: '测试科目', parentSubjectCode: '1002', subjectType: '流动资产',
    balanceDirection: 0, enableStatus: 1, hasChild: false, numberUnit: '', auxiliaryList: [], currencyList: [] }
  function reads(rows: unknown[], categoryId = '473815', ledgerName = account.name) {
    const fetcher = vi.fn(async (url: URL) => {
      if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
      if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: account.id, sobName: ledgerName }] })
      if (url.pathname.includes('queryAuxiliaryCategoryList')) return Response.json({ result: 100,
        data: [{ id: categoryId, categoryCode: '02', categoryName: '供应商' }] })
      expect(['/finance/auxiliary/querySubjectInfoList.rjson', '/finance/auxiliary/queryAuxiliaryItemList.rjson']).toContain(url.pathname)
      return Response.json({ result: 100, data: rows })
    })
    vi.stubGlobal('fetch', fetcher)
    return fetcher
  }

  it.each(['matched', 'mismatch', 'missing', 'missing-configuration', 'renamed-ledger'] as const)
  ('compares original subject intent for %s without writing', async (mode) => {
    reads(mode === 'missing' ? [] : [{ ...subjectRow, balanceDirection: mode === 'mismatch' ? 1 : 0,
      ...(mode === 'missing-configuration' ? { numberUnit: undefined } : {}) }], '473815', mode === 'renamed-ledger' ? '其他账套名' : account.name)
    const result = await adapter().querySubmittedMasterData(config, 'fake-secret', subject, parent, new AbortController().signal, 1000, 10000)
    expect(result).toEqual(mode === 'matched' ? { content: 'matched', configuration: 'matched', complete: true }
      : mode === 'mismatch' ? { content: 'mismatch', configuration: 'matched', complete: false }
        : mode === 'missing-configuration' ? { content: 'matched', configuration: 'unavailable', complete: false }
          : { content: mode === 'renamed-ledger' ? 'mismatch' : 'unavailable', configuration: 'unavailable', complete: false })
  })

  it.each(['same', 'replaced', 'wrong-membership'] as const)('checks auxiliary category identity: %s', async (mode) => {
    reads([{ id: '191568', itemCode: 'F3A02', itemName: '测试供应商', categoryId: mode === 'replaced' ? 'changed-id' : '473815' }],
      mode === 'same' ? '473815' : 'changed-id')
    const result = adapter().querySubmittedMasterData(config, 'fake-secret', auxiliary, category, new AbortController().signal, 1000, 10000)
    if (mode === 'wrong-membership') await expect(result).rejects.toThrow('基础资料查询失败')
    else expect(await result).toEqual({ content: mode === 'same' ? 'matched' : 'mismatch', status: 'unavailable', complete: false })
  })

  it.each(['plain', 'wrong-type', 'wrong-category', 'missing-type', 'no-references', 'duplicate', 'quantity'] as const)
  ('prepares a root only with an observed same-category type and no existing code: %s', async (mode) => {
    const proposal: MasterDataProposal = { kind: 'subject', input: validateSubjectPreparation({ ...subject.input,
      subjectCode: '1099', parentCode: null, numberUnit: mode === 'quantity' ? '个' : null }, 10000) }
    const fetcher = reads(mode === 'no-references' ? [] : [{ ...subjectRow,
      subjectCode: mode === 'duplicate' ? '1099' : mode === 'wrong-category' ? '2001' : '1002',
      subjectName: '已有科目', parentSubjectCode: '',
      subjectType: mode === 'missing-type' ? undefined : mode === 'wrong-type' ? '非流动资产' : '流动资产' }])
    const result = adapter().prepareMasterData(config, 'fake-secret', proposal, new AbortController().signal, 1000, 10000)
    if (mode === 'plain') expect(await result).toMatchObject({ proposal, references: { parent: null, parentImpact: 'new-root' } })
    else await expect(result).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('independently reads a created root with no parent', async () => {
    const proposal: MasterDataProposal = { kind: 'subject', input: validateSubjectPreparation({ ...subject.input,
      subjectCode: '1099', parentCode: null }, 10000) }
    reads([{ ...subjectRow, subjectCode: '1099', parentSubjectCode: '' }])
    expect(await adapter().querySubmittedMasterData(config, 'fake-secret', proposal,
      { ...parent, parent: null, parentImpact: 'new-root' }, new AbortController().signal, 1000, 10000))
      .toEqual({ content: 'matched', configuration: 'matched', complete: true })
  })

  it('refuses a different ledger before reading and sanitizes failed responses', async () => {
    const fetcher = reads([])
    await expect(adapter().querySubmittedMasterData({ ...config, accountCode: '35601' }, 'fake-secret', subject, parent,
      new AbortController().signal, 1000, 10000)).rejects.toThrow('目标不一致')
    expect(fetcher).not.toHaveBeenCalled()
    reads([{ ...subjectRow, subjectName: 'fake-secret' }])
    await expect(adapter().querySubmittedMasterData(config, 'fake-secret', subject, parent,
      new AbortController().signal, 1000, 10000)).rejects.toThrow('invalid-response')
  })

  it.each(['plain', 'leaf', 'unknown-children', 'disabled', 'auxiliary', 'currency', 'quantity', 'unknown-settings', 'wrong-type'] as const)
  ('only prepares a qualified ordinary parent: %s', async (mode) => {
    reads([{ ...subjectRow, subjectCode: '1002', subjectName: '银行存款', parentSubjectCode: '',
      hasChild: mode === 'unknown-children' ? undefined : mode !== 'leaf', enableStatus: mode === 'disabled' ? 0 : 1,
      auxiliaryList: mode === 'auxiliary' ? [{ id: '473815', categoryCode: '02', categoryName: '供应商' }]
        : mode === 'unknown-settings' ? undefined : [],
      currencyList: mode === 'currency' ? [{ currencyCode: 'USD', currencyName: '美元' }] : [],
      numberUnit: mode === 'quantity' ? '个' : '', subjectType: mode === 'wrong-type' ? '非流动资产' : '流动资产' }])
    const result = adapter().prepareMasterData(config, 'fake-secret', subject, new AbortController().signal, 1000, 10000)
    if (mode === 'plain') expect(await result).toMatchObject({ proposal: subject, references: { parentImpact: 'existing-branch' } })
    else await expect(result).rejects.toThrow()
  })
})
