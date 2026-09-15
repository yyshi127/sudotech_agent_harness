import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { OpenItemRecords, type PreparedOpenItemRecord, type PreparedOpenItemId } from '../src/open-item-records.ts'

const roots: string[] = []
const configuration = 'a'.repeat(64)
const proposal = { direction: 'receivable', accountId: '174626', categoryId: '578250', auxiliaryCategoryCode: '01',
  auxiliaryItemId: '191501', amount: '0.03', date: '2022-01-01', summary: 'F3往来测试', keeperName: '施' }
const approve = async (record: PreparedOpenItemRecord) => ({ ledgerId: '35616', ledgerName: '施的演示账套',
  accountId: record.input.accountId, accountName: '应收账款', currencyCode: 'RMB',
  categoryId: record.input.categoryId, categoryName: '其他收入', counterparty: {
    categoryId: record.input.auxiliaryItemId, categoryCode: '01', categoryName: '客户',
    itemId: record.input.auxiliaryItemId, itemCode: '01', itemName: '淘云科技', itemStatus: 'enabled' as const,
    wireName: '客户:淘云科技' } })
async function setup(maxBytes = 10000) {
  const root = await mkdtemp(join(tmpdir(), 'f3a-open-item-records-'))
  roots.push(root)
  return { root, records: new OpenItemRecords(root, 'client/session', maxBytes) }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('restores proposals only for their owner and rejects invalid file identities', async () => {
  const { root, records } = await setup()
  const record = await records.create(proposal, configuration)
  expect(await new OpenItemRecords(root, 'client/session', 10000).read(record.id)).toEqual(record)
  await expect(new OpenItemRecords(root, 'other/session', 10000).read(record.id)).rejects.toThrow()
  await expect(records.read('../outside' as PreparedOpenItemId)).rejects.toThrow()
})

it('invalidates earlier confirmations when the proposal or configuration changes', async () => {
  const { records } = await setup()
  const record = await records.create(proposal, configuration)
  await records.revise(record.id, 1, configuration, { ...proposal, amount: '0.04' })
  const approval = vi.fn(approve)
  await expect(records.reserve(record.id, 1, configuration, approval)).rejects.toThrow('版本')
  await expect(records.reserve(record.id, 2, 'b'.repeat(64), approval)).rejects.toThrow('配置')
  expect(approval).not.toHaveBeenCalled()
  expect((await records.read(record.id)).input.amount).toBe('0.04')
})

it('leaves cancelled approval unsent and rejects revision during confirmation', async () => {
  const { records } = await setup()
  const record = await records.create(proposal, configuration)
  await expect(records.reserve(record.id, 1, configuration, async () => { throw new Error('取消') })).rejects.toThrow('取消')
  expect((await records.read(record.id)).phase).toBe('prepared')
  await expect(records.reserve(record.id, 1, configuration, async (current) => {
    await records.revise(record.id, 1, configuration, { ...proposal, amount: '0.05' })
    return approve(current)
  })).rejects.toThrow('版本')
  expect((await records.read(record.id)).phase).toBe('prepared')
})

it('reserves one concurrent sender and retains uncertainty after restart', async () => {
  const { root, records } = await setup()
  const record = await records.create(proposal, configuration)
  const restarted = new OpenItemRecords(root, 'client/session', 10000)
  const results = await Promise.allSettled([records.reserve(record.id, 1, configuration, approve),
    restarted.reserve(record.id, 1, configuration, approve)])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect((await restarted.read(record.id)).reservation?.payload).toMatchObject({ accountId: 174626,
    auxiliaryItemNames: '客户:淘云科技', direction: false, money: 0.03 })
  await expect(restarted.reserve(record.id, 1, configuration, approve)).rejects.toThrow('结果未知')
  await expect(restarted.revise(record.id, 1, configuration, proposal)).rejects.toThrow('结果未知')
})

it.each(['accepted', 'rejected', 'outcome-unknown', 'not-sent'] as const)('retains %s without granting resubmission or result overwrite', async (state) => {
  const { root, records } = await setup()
  const record = await records.create(proposal, configuration)
  await expect(records.recordOutcome(record.id, 1, { state: 'outcome-unknown' })).rejects.toThrow()
  await records.reserve(record.id, 1, configuration, approve)
  await expect(records.recordOutcome(record.id, 2, { state: 'outcome-unknown' })).rejects.toThrow('版本')
  const outcome = state === 'accepted' ? { state, openItemId: '72595' }
    : state === 'rejected' ? { state, code: 201 }
      : state === 'not-sent' ? { state, reason: 'cancelled' as const } : { state }
  await records.recordOutcome(record.id, 1, outcome)
  const restarted = new OpenItemRecords(root, 'client/session', 10000)
  expect((await restarted.read(record.id)).outcome).toEqual(outcome)
  await expect(restarted.recordOutcome(record.id, 1, { state: 'outcome-unknown' })).rejects.toThrow()
  await expect(restarted.reserve(record.id, 1, configuration, approve)).rejects.toThrow()
})

it('rejects mismatched references before persisting a reservation', async () => {
  const { records } = await setup()
  const record = await records.create(proposal, configuration)
  const approved = await approve(record)
  for (const changed of [{ ...approved, accountId: '1' as typeof approved.accountId },
    { ...approved, categoryId: '1' as typeof approved.categoryId },
    { ...approved, counterparty: { ...approved.counterparty, wireName: '淘云科技' } }]) {
    await expect(records.reserve(record.id, 1, configuration, async () => changed)).rejects.toThrow('不一致')
    expect((await records.read(record.id)).phase).toBe('prepared')
  }
})

it('requires result capacity and refuses corrupted requests or ownership', async () => {
  const { root, records } = await setup()
  const record = await records.create(proposal, configuration)
  const reserved = await records.reserve(record.id, 1, configuration, approve)
  const bounded = new OpenItemRecords(root, 'bounded/session', Buffer.byteLength(JSON.stringify(reserved) + '\n'))
  const candidate = await bounded.create(proposal, configuration)
  await expect(bounded.reserve(candidate.id, 1, configuration, approve)).rejects.toThrow('保存接口结果')
  const path = join(root, record.ownerDigest, `${record.id}.json`)
  const raw = await readFile(path, 'utf8')
  for (const changed of [raw.replace('"money":0.03', '"money":99'),
    raw.replace(record.ownerDigest, 'f'.repeat(64)), raw.replace('"phase":"outcome-unknown"', '"phase":"prepared"')]) {
    await writeFile(path, changed)
    await expect(records.read(record.id)).rejects.toThrow()
  }
})
