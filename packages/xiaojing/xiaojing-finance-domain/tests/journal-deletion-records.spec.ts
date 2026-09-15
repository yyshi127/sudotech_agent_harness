import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { JournalDeletionRecords } from '../src/journal-deletion-records.ts'
import type { JournalDeletionInventory } from '../src/journal-deletion.ts'
import type { JournalEntryId } from '../src/journals.ts'

const owner = 'client/production/35616'
const configuration = 'b'.repeat(64)
const maxBytes = 30000
const row = { id: '123' as JournalEntryId, date: '2022-01-01', summary: 'dedicated test',
  income: '0.01', expense: null, balance: '0.01', baseIncome: '0.01', baseExpense: null, baseBalance: '0.01',
  accountCode: '1001', accountName: '库存现金', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
  categoryName: '其他收入', keeperName: '测试' }
const inventory: JournalDeletionInventory = { accountId: '35616', accountName: '测试账套',
  selection: { month: '2022-01', cashAccountId: '174622' }, totalCount: 1, rows: [row],
  fingerprints: { '123': 'a'.repeat(64) }, summaries: [],
  target: { accountId: '35616', accountName: '测试账套', cashAccountId: '174622', row,
    fingerprint: 'a'.repeat(64), reviewStatus: 0, channel: 'ADD', attachmentCount: 0, blockers: [] },
  scope: 'selected-month', notice: 'Fixture only, not deletion approval.' }
const roots: string[] = []
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'f3b-journal-deletion-'))
  roots.push(root)
  return { root, records: new JournalDeletionRecords(root, owner, maxBytes),
    recordPath: (id: string) => join(root, hash(owner), `${id}.json`),
    claimPath: join(root, hash(owner), `target-${hash(JSON.stringify(['35616', '123']))}.json`) }
}
const allow = async () => {}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('preserves the original inventory serialization across reload and excludes foreign owners', async () => {
  const { root, records } = await setup()
  const created = await records.create(inventory, configuration)
  const loaded = await new JournalDeletionRecords(root, owner, maxBytes).read(created.id)
  expect(JSON.stringify(loaded.inventory)).toBe(JSON.stringify(inventory))
  expect(loaded).toEqual(created)
  await expect(new JournalDeletionRecords(root, 'other/production/35616', maxBytes).read(created.id)).rejects.toThrow()
})

it.each(['count', 'duplicate', 'fingerprints', 'month', 'account', 'target-row', 'target-fingerprint', 'missing-target',
  'blocked', 'reviewed', 'attachment', 'source', 'currency-amount', 'no-cash-account'])(
  'rejects persisted %s damage before permitting a deletion', async (mode) => {
    const { records, recordPath } = await setup()
    const created = await records.create(inventory, configuration)
    const value = JSON.parse(JSON.stringify(created.inventory)) as JournalDeletionInventory
    const broken = { ...created, inventory: value }
    const target = value.target
    const first = value.rows[0]
    if (target === undefined || first === undefined) throw new Error('Fixture target missing')
    if (mode === 'count') value.totalCount = 2
    if (mode === 'duplicate') { value.rows.push(first); value.totalCount = 2 }
    if (mode === 'fingerprints') value.fingerprints = { '124': 'a'.repeat(64) }
    if (mode === 'month') value.selection.month = '2022-02'
    if (mode === 'account') value.accountName = 'other'
    if (mode === 'target-row') target.row.summary = 'changed'
    if (mode === 'target-fingerprint') target.fingerprint = 'c'.repeat(64)
    if (mode === 'missing-target') delete value.target
    if (mode === 'blocked') target.blockers.push('linked')
    if (mode === 'reviewed') target.reviewStatus = 1
    if (mode === 'attachment') target.attachmentCount = 1
    if (mode === 'source') target.channel = 'OTHER'
    if (mode === 'currency-amount') first.income = '0.011'
    if (mode === 'no-cash-account') delete value.selection.cashAccountId
    await writeFile(recordPath(created.id), JSON.stringify(broken))
    const approve = vi.fn(allow)
    await expect(records.reserve(created.id, 1, configuration, approve)).rejects.toThrow()
    expect(approve).not.toHaveBeenCalled()
  })

it('invalidates the old version and old configuration before approval', async () => {
  const { records } = await setup()
  const created = await records.create(inventory, configuration)
  const next = await records.revise(created.id, 1, inventory, 'c'.repeat(64))
  expect(next.version).toBe(2)
  const approve = vi.fn(allow)
  await expect(records.reserve(created.id, 1, configuration, approve)).rejects.toThrow('版本')
  await expect(records.reserve(created.id, 2, configuration, approve)).rejects.toThrow('配置')
  expect(approve).not.toHaveBeenCalled()
})

it('does not claim when the mandatory approval callback rejects', async () => {
  const { records, claimPath } = await setup()
  const created = await records.create(inventory, configuration)
  await expect(records.reserve(created.id, 1, configuration, async () => { throw new Error('denied') })).rejects.toThrow('denied')
  expect((await records.read(created.id)).phase).toBe('prepared')
  await expect(readFile(claimPath)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects revision during approval before writing a target claim', async () => {
  const { records, claimPath } = await setup()
  const created = await records.create(inventory, configuration)
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const pending = records.reserve(created.id, 1, configuration, async () => { entered.resolve(undefined); await release.promise })
  await entered.promise
  await records.revise(created.id, 1, inventory, configuration)
  const rejected = expect(pending).rejects.toThrow('版本')
  release.resolve(undefined)
  await rejected
  await expect(readFile(claimPath)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('allows only one same-target reservation across records and restarted instances', async () => {
  const { root, records } = await setup()
  const another = new JournalDeletionRecords(root, owner, maxBytes)
  const first = await records.create(inventory, configuration)
  const second = await another.create(inventory, configuration)
  const results = await Promise.allSettled([records.reserve(first.id, 1, configuration, allow),
    another.reserve(second.id, 1, configuration, allow)])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const restarted = new JournalDeletionRecords(root, owner, maxBytes)
  const third = await restarted.create(inventory, configuration)
  await expect(restarted.reserve(third.id, 1, configuration, allow)).rejects.toThrow('已有删除发送意图')
})

it.each(['disk', 'callback'] as const)('rejects valid unversioned %s evidence replacement while approval is pending', async (mode) => {
  const { records, recordPath, claimPath } = await setup()
  const created = await records.create(inventory, configuration)
  await expect(records.reserve(created.id, 1, configuration, async (preview) => {
    if (mode === 'callback') preview.inventory.notice = 'Changed confirmation evidence'
    else {
      const changed = { ...created, inventory: { ...created.inventory, notice: 'Changed confirmation evidence' } }
      await writeFile(recordPath(created.id), JSON.stringify(changed))
    }
  })).rejects.toThrow('内容已变化')
  expect((await records.read(created.id)).phase).toBe('prepared')
  await expect(readFile(claimPath)).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each([{ state: 'accepted' }, { state: 'outcome-unknown' }] as const)('retains %j without enabling any retry', async (outcome) => {
  const { root, records } = await setup()
  const created = await records.create(inventory, configuration)
  await records.reserve(created.id, 1, configuration, allow)
  await records.recordOutcome(created.id, 1, outcome)
  const restarted = new JournalDeletionRecords(root, owner, maxBytes)
  expect((await restarted.read(created.id)).outcome).toEqual(outcome)
  await expect(restarted.reserve(created.id, 1, configuration, allow)).rejects.toThrow()
  await expect(restarted.revise(created.id, 1, inventory, configuration)).rejects.toThrow()
  await expect(restarted.recordOutcome(created.id, 1, { state: 'rejected', code: 201 })).rejects.toThrow()
  const next = await restarted.create(inventory, configuration)
  await expect(restarted.reserve(next.id, 1, configuration, allow)).rejects.toThrow('已有删除发送意图')
})

it.each([{ state: 'rejected', code: 201 }, { state: 'not-sent', reason: 'cancelled' }] as const)(
  'retains %j while requiring separate approval for a new proposal', async (outcome) => {
    const { records } = await setup()
    const created = await records.create(inventory, configuration)
    await records.reserve(created.id, 1, configuration, allow)
    await records.recordOutcome(created.id, 1, outcome)
    const next = await records.create(inventory, configuration)
    const approve = vi.fn(allow)
    await records.reserve(next.id, 1, configuration, approve)
    expect(approve).toHaveBeenCalledTimes(1)
    expect((await records.read(created.id)).outcome).toEqual(outcome)
  })

it('blocks both operations after a crash between the claim and reservation saves', async () => {
  const { records, claimPath } = await setup()
  const first = await records.create(inventory, configuration)
  await writeFile(claimPath, JSON.stringify({ id: first.id, accountId: '35616', journalId: '123' }))
  const next = await records.create(inventory, configuration)
  await expect(records.reserve(first.id, 1, configuration, allow)).rejects.toThrow('已有删除发送意图')
  await expect(records.reserve(next.id, 1, configuration, allow)).rejects.toThrow('已有删除发送意图')
})

it.each(['corrupt', 'wrong-target', 'missing-operation'])('refuses a %s claim rather than treating it as absent', async (mode) => {
  const { records, claimPath, recordPath } = await setup()
  const created = await records.create(inventory, configuration)
  await writeFile(claimPath, mode === 'corrupt' ? 'broken' : JSON.stringify({ id: created.id,
    accountId: '35616', journalId: mode === 'wrong-target' ? '124' : '123' }))
  if (mode === 'missing-operation') await rm(recordPath(created.id))
  const next = await records.create(inventory, configuration)
  await expect(records.reserve(next.id, 1, configuration, allow)).rejects.toThrow()
})

it('requires room for the eventual outcome before saving a claim', async () => {
  const { root, records, claimPath } = await setup()
  const created = await records.create(inventory, configuration)
  const bytes = Buffer.byteLength(JSON.stringify({ ...created, phase: 'outcome-unknown' }) + '\n')
  const bounded = new JournalDeletionRecords(root, owner, bytes)
  await expect(bounded.reserve(created.id, 1, configuration, allow)).rejects.toThrow('大小限制')
  await expect(readFile(claimPath)).rejects.toMatchObject({ code: 'ENOENT' })
})
