import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { MasterDataRecords, type MasterDataSelection } from '../src/master-data-records.ts'
import type { Branded } from '@deepseek-ai/dsh-brand'

const roots: string[] = []
const configuration = 'a'.repeat(64)
const subject = { kind: 'subject', input: { subjectCode: '100297', subjectName: 'F3借方测试', parentCode: '1002',
  subjectCategory: '1', subjectType: '流动资产', direction: 'debit', status: 'enabled', numberUnit: null, documentMaker: '施' } }
const auxiliary = { kind: 'auxiliary-item', input: { categoryCode: '02', itemCode: 'F3A02',
  itemName: '小兢F3A测试供应商', status: 'enabled', documentMaker: '施' } }
const subjectSelection: MasterDataSelection = { kind: 'subject', accountId: '35616', accountName: '施的演示账套',
  parent: { code: '1002', name: '银行存款' }, parentImpact: 'existing-branch', sameNameElsewhere: [] }
const auxiliarySelection: MasterDataSelection = { kind: 'auxiliary-item', accountId: '35616', accountName: '施的演示账套',
  categoryId: '473815' as Branded<'FinanceReferenceId'>, categoryCode: '02', categoryName: '供应商' }

async function setup(maxBytes = 10000) {
  const root = await mkdtemp(join(tmpdir(), 'f3a-master-data-'))
  roots.push(root)
  return { root, records: new MasterDataRecords(root, 'client/session', maxBytes) }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe.each([{ proposal: subject, selection: subjectSelection, other: auxiliary, otherSelection: auxiliarySelection },
  { proposal: { ...subject, input: { ...subject.input, accounting: { auxiliaryCategoryCodes: ['02'], currencyCodes: ['USD'] } } },
    selection: { ...subjectSelection, accounting: { auxiliaryCategories: [{ id: '473815' as Branded<'FinanceReferenceId'>, code: '02', name: '供应商' }],
      currencies: [{ code: 'USD', name: '美元' }] } }, other: auxiliary, otherSelection: auxiliarySelection },
  { proposal: { ...subject, input: { ...subject.input, subjectCode: '1099', parentCode: null } },
    selection: { ...subjectSelection, parent: null, parentImpact: 'new-root' as const }, other: auxiliary, otherSelection: auxiliarySelection },
  { proposal: auxiliary, selection: auxiliarySelection, other: subject, otherSelection: subjectSelection }])
('$proposal.kind reservations', ({ proposal, selection, other, otherSelection }) => {
  const approve = async () => selection

  it('retains prepared values across restart and keeps owners separate', async () => {
    const { root, records } = await setup()
    const record = await records.create(proposal, configuration)
    expect(await new MasterDataRecords(root, 'client/session', 10000).read(record.id)).toEqual(record)
    await expect(new MasterDataRecords(root, 'another/session', 10000).read(record.id)).rejects.toThrow()
    await expect(records.revise(record.id, 1, configuration, other)).rejects.toThrow('另一种业务')
    await expect(records.reserve(record.id, 1, configuration, async () => otherSelection)).rejects.toThrow('类型')
    expect((await records.read(record.id)).phase).toBe('prepared')
  })

  it('rejects stale version/configuration before requesting confirmation', async () => {
    const { records } = await setup()
    const record = await records.create(proposal, configuration)
    await records.revise(record.id, 1, configuration, { ...proposal, input: { ...proposal.input, documentMaker: '另一个制单人' } })
    const approval = vi.fn(approve)
    await expect(records.reserve(record.id, 1, configuration, approval)).rejects.toThrow('版本')
    await expect(records.reserve(record.id, 2, 'b'.repeat(64), approval)).rejects.toThrow('配置')
    expect(approval).not.toHaveBeenCalled()
  })

  it('retains a target claim when a crash leaves only the old prepared record', async () => {
    const { root, records } = await setup()
    const original = await records.create(proposal, configuration)
    await records.reserve(original.id, 1, configuration, approve)
    // Reproduce the on-disk interval between the target claim and reservation save, not a production repair.
    await writeFile(join(root, original.ownerDigest, `${original.id}.json`), JSON.stringify(original) + '\n')
    const otherOwner = new MasterDataRecords(root, 'client/another-session', 10000)
    const next = await otherOwner.create(proposal, configuration)
    await expect(otherOwner.reserve(next.id, 1, configuration, approve)).rejects.toThrow('不能另建预览绕过')
    await expect(records.reserve(original.id, 1, configuration, approve)).rejects.toThrow('不能另建预览绕过')
    expect((await otherOwner.read(next.id)).phase).toBe('prepared')
  })

  it('keeps denied confirmation unsent and rechecks revisions made during confirmation', async () => {
    const { records } = await setup()
    const record = await records.create(proposal, configuration)
    await expect(records.reserve(record.id, 1, configuration, async () => { throw new Error('拒绝确认') })).rejects.toThrow('拒绝确认')
    expect((await records.read(record.id)).phase).toBe('prepared')
    await expect(records.reserve(record.id, 1, configuration, async () => {
      await records.revise(record.id, 1, configuration, proposal)
      return selection
    })).rejects.toThrow('版本')
    expect((await records.read(record.id)).phase).toBe('prepared')
  })

  it('allows a single concurrent reservation and preserves uncertainty after restart', async () => {
    const { root, records } = await setup()
    const record = await records.create(proposal, configuration)
    const restarted = new MasterDataRecords(root, 'client/session', 10000)
    const results = await Promise.allSettled([records.reserve(record.id, 1, configuration, approve),
      restarted.reserve(record.id, 1, configuration, approve)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const restored = await restarted.read(record.id)
    expect(restored.phase).toBe('outcome-unknown')
    expect(restored.reservation?.payload).toMatchObject({ accountName: '施的演示账套', documentMaker: '施' })
    await expect(restarted.reserve(record.id, 1, configuration, approve)).rejects.toThrow('结果未知')
    await expect(restarted.revise(record.id, 1, configuration, proposal)).rejects.toThrow('结果未知')
  })

  it.each([{ state: 'accepted' as const }, { state: 'rejected' as const, code: 201 },
    { state: 'not-sent' as const, reason: 'preflight-failed' as const }])('preserves %j without inventing an ID or enabling resend', async (outcome) => {
    const { root, records } = await setup()
    const record = await records.create(proposal, configuration)
    await expect(records.recordOutcome(record.id, 1, outcome)).rejects.toThrow()
    await records.reserve(record.id, 1, configuration, approve)
    await expect(records.recordOutcome(record.id, 2, outcome)).rejects.toThrow('版本')
    await records.recordOutcome(record.id, 1, outcome)
    const restored = await new MasterDataRecords(root, 'client/session', 10000).read(record.id)
    expect(restored.outcome).toEqual(outcome)
    expect(restored.reservation?.selection).toEqual(selection)
    await expect(records.recordOutcome(record.id, 1, { state: 'outcome-unknown' })).rejects.toThrow()
    await expect(records.reserve(record.id, 1, configuration, approve)).rejects.toThrow()
  })

  it('reserves result capacity before sending and rejects a changed persisted payload', async () => {
    const { root, records } = await setup()
    const record = await records.create(proposal, configuration)
    const reserved = await records.reserve(record.id, 1, configuration, approve)
    const limit = Buffer.byteLength(JSON.stringify(reserved) + '\n')
    const bounded = new MasterDataRecords(root, 'bounded/session', limit)
    const candidate = await bounded.create(proposal, configuration)
    await expect(bounded.reserve(candidate.id, 1, configuration, approve)).rejects.toThrow('足够空间')
    expect((await bounded.read(candidate.id)).phase).toBe('prepared')
    const path = join(root, record.ownerDigest, `${record.id}.json`)
    const raw = z.looseObject({ reservation: z.looseObject({ payload: z.looseObject({ enableStatus: z.number() }) }) })
      .parse(JSON.parse(await readFile(path, 'utf8')))
    raw.reservation.payload.enableStatus = 0
    await writeFile(path, JSON.stringify(raw))
    await expect(records.read(record.id)).rejects.toThrow('提交内容不一致')
  })

  it('blocks another preview and another session from bypassing an unknown target reservation', async () => {
    const { root, records } = await setup()
    const record = await records.create(proposal, configuration)
    const otherSession = new MasterDataRecords(root, 'other/session', 10000)
    const candidate = await otherSession.create(proposal, configuration)
    const results = await Promise.allSettled([records.reserve(record.id, 1, configuration, approve),
      otherSession.reserve(candidate.id, 1, configuration, approve)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const third = await otherSession.create(proposal, 'b'.repeat(64))
    await expect(otherSession.reserve(third.id, 1, 'b'.repeat(64), approve)).rejects.toThrow('另建预览')
    expect((await otherSession.read(third.id)).phase).toBe('prepared')
  })

  it('permits a fresh confirmation for the same code only after explicit rejection or proven non-send', async () => {
    const { records } = await setup()
    for (const outcome of [{ state: 'rejected', code: 201 }, { state: 'not-sent', reason: 'preflight-failed' }] as const) {
      const record = await records.create(proposal, configuration)
      await records.reserve(record.id, 1, configuration, approve)
      await records.recordOutcome(record.id, 1, outcome)
    }
    const final = await records.create(proposal, configuration)
    await records.reserve(final.id, 1, configuration, approve)
    await records.recordOutcome(final.id, 1, { state: 'accepted' })
    const duplicate = await records.create(proposal, configuration)
    await expect(records.reserve(duplicate.id, 1, configuration, approve)).rejects.toThrow('另建预览')
  })
})

it('rejects extra proposal fields and malformed configuration fingerprints', async () => {
  const { records } = await setup()
  await expect(records.create({ ...subject, approved: true }, configuration)).rejects.toThrow()
  await expect(records.create({ ...auxiliary, input: { ...auxiliary.input, accountName: '另一个账套' } }, configuration)).rejects.toThrow()
  await expect(records.create(subject, 'not-a-digest')).rejects.toThrow()
})
