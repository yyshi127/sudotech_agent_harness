import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { JournalRecords, type PreparedJournalRecord } from '../src/journal-records.ts'

const roots: string[] = []
const configuration = 'a'.repeat(64)
const proposal = { cashAccountId: '174622', date: '2022-01-01', direction: 'income', amount: '0.20',
  summary: 'F3A测试', keeperName: '测试' }
const approve = async (record: PreparedJournalRecord) => ({ selection: { accountId: '35616', accountName: '测试账套',
  cashAccountId: record.input.cashAccountId, cashAccountName: '库存现金', cashAccountCode: '1001' }, previousId: '0' })
async function setup(maxBytes = 10000) {
  const root = await mkdtemp(join(tmpdir(), 'f3a-journal-records-'))
  roots.push(root)
  return { root, records: new JournalRecords(root, 'client/session', maxBytes) }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('retains an unsent proposal across restart and isolates owners', async () => {
  const { root, records } = await setup()
  const record = await records.create(proposal, configuration)
  expect(await new JournalRecords(root, 'client/session', 10000).read(record.id)).toEqual(record)
  await expect(new JournalRecords(root, 'other/session', 10000).read(record.id)).rejects.toThrow()
})

it('rejects stale versions and changed configuration before asking for approval', async () => {
  const { records } = await setup()
  const record = await records.create(proposal, configuration)
  await records.revise(record.id, 1, configuration, { ...proposal, amount: '0.30' })
  const approval = vi.fn(approve)
  await expect(records.reserve(record.id, 1, configuration, approval)).rejects.toThrow('版本')
  await expect(records.reserve(record.id, 2, 'b'.repeat(64), approval)).rejects.toThrow('配置')
  expect(approval).not.toHaveBeenCalled()
})

it('keeps rejected confirmation unsent and catches revision during approval', async () => {
  const { records } = await setup()
  const record = await records.create(proposal, configuration)
  await expect(records.reserve(record.id, 1, configuration, async () => { throw new Error('拒绝') })).rejects.toThrow('拒绝')
  expect((await records.read(record.id)).phase).toBe('prepared')
  await expect(records.reserve(record.id, 1, configuration, async (current) => {
    await records.revise(record.id, 1, configuration, { ...proposal, amount: '0.40' })
    return approve(current)
  })).rejects.toThrow('版本')
  expect((await records.read(record.id)).phase).toBe('prepared')
})

it('allows one concurrent reservation and never resets uncertainty on restart', async () => {
  const { root, records } = await setup()
  const record = await records.create(proposal, configuration)
  const restarted = new JournalRecords(root, 'client/session', 10000)
  const results = await Promise.allSettled([records.reserve(record.id, 1, configuration, approve),
    restarted.reserve(record.id, 1, configuration, approve)])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect((await restarted.read(record.id)).reservation?.payload).toMatchObject({ subjectId: 174622, borrow: 0.2, loan: null })
  await expect(restarted.reserve(record.id, 1, configuration, approve)).rejects.toThrow('结果未知')
  await expect(restarted.revise(record.id, 1, configuration, proposal)).rejects.toThrow('结果未知')
})

it('preserves accepted identity independently of readback and rejects later overwrite', async () => {
  const { root, records } = await setup()
  const record = await records.create(proposal, configuration)
  await records.reserve(record.id, 1, configuration, approve)
  await expect(records.recordOutcome(record.id, 2, { state: 'accepted', journalId: '253183' })).rejects.toThrow('版本')
  await records.recordOutcome(record.id, 1, { state: 'accepted', journalId: '253183' })
  const restored = await new JournalRecords(root, 'client/session', 10000).read(record.id)
  expect(restored.outcome).toEqual({ state: 'accepted', journalId: '253183' })
  await expect(records.recordOutcome(record.id, 1, { state: 'outcome-unknown' })).rejects.toThrow()
  await expect(records.reserve(record.id, 1, configuration, approve)).rejects.toThrow()
})

it('refuses reservation without capacity for an accepted ID and rejects corrupted requests', async () => {
  const { root, records } = await setup()
  const record = await records.create(proposal, configuration)
  const reserved = await records.reserve(record.id, 1, configuration, approve)
  const bounded = new JournalRecords(root, 'bounded/session', Buffer.byteLength(JSON.stringify(reserved) + '\n'))
  const candidate = await bounded.create(proposal, configuration)
  await expect(bounded.reserve(candidate.id, 1, configuration, approve)).rejects.toThrow('保存接口结果')
  const path = join(root, record.ownerDigest, `${record.id}.json`)
  const raw = await readFile(path, 'utf8')
  expect(raw).toContain('"borrow":0.2')
  await writeFile(path, raw.replace('"borrow":0.2', '"borrow":99'))
  await expect(records.read(record.id)).rejects.toThrow('提交内容不一致')
})
