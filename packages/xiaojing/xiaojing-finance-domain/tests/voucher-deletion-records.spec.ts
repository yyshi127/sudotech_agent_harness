import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { VoucherDeletionRecords } from '../src/voucher-deletion-records.ts'
import type { VoucherDeletionInspection, VoucherDeletionPayload } from '../src/voucher-deletion.ts'

const configuration = 'b'.repeat(64)
const owner = 'client/production/35616'
const maxBytes = 20000
const payload: VoucherDeletionPayload = { accountName: '测试账套', cerInfoList: [{ cerId: '123' }] }
const inspection: VoucherDeletionInspection = {
  detail: { accountId: '35616', accountName: payload.accountName, voucherId: '123', date: '2022-01-01', number: '记-40',
    period: '2022-01', documentMaker: '测试', audited: false, settled: false, rows: [], notice: 'fixture' },
  fingerprint: 'a'.repeat(64), modified: '2026-09-10', channel: 'EXTERNAL_ACCESS', attachmentCount: 0,
  auxiliaryEntryCount: 0, currencyCodes: [], blockers: [], notice: 'fixture only, not approval',
}
const roots: string[] = []
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'f3b-delete-records-'))
  roots.push(root)
  return { root, records: new VoucherDeletionRecords(root, owner, maxBytes),
    recordPath: (id: string) => join(root, hash(owner), `${id}.json`),
    claimPath: join(root, hash(owner), `target-${hash(JSON.stringify(['35616', '123']))}.json`) }
}
const allow = async () => {}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('keeps exact previews across reload while rejecting another owner', async () => {
  const { root, records } = await setup()
  const record = await records.create(inspection, payload, configuration)
  expect(await new VoucherDeletionRecords(root, owner, maxBytes).read(record.id)).toEqual(record)
  await expect(new VoucherDeletionRecords(root, 'other/production/35616', maxBytes).read(record.id)).rejects.toThrow()
})

it('rejects a stale version and changed configuration before confirmation', async () => {
  const { records } = await setup()
  const record = await records.create(inspection, payload, configuration)
  const next = await records.revise(record.id, 1, { ...inspection, fingerprint: 'c'.repeat(64) }, payload, configuration)
  expect(next.version).toBe(2)
  const approve = vi.fn(allow)
  await expect(records.reserve(record.id, 1, configuration, approve)).rejects.toThrow('版本')
  await expect(records.reserve(record.id, 2, 'd'.repeat(64), approve)).rejects.toThrow('配置')
  expect(approve).not.toHaveBeenCalled()
})

it('does not claim a target when mandatory confirmation is rejected', async () => {
  const { records, claimPath } = await setup()
  const record = await records.create(inspection, payload, configuration)
  await expect(records.reserve(record.id, 1, configuration, async () => { throw new Error('denied') })).rejects.toThrow('denied')
  expect((await records.read(record.id)).phase).toBe('prepared')
  await expect(readFile(claimPath)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects a preview revised during confirmation without writing the old target claim', async () => {
  const { records, claimPath } = await setup()
  const record = await records.create(inspection, payload, configuration)
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const pending = records.reserve(record.id, 1, configuration, async () => { entered.resolve(undefined); await release.promise })
  await entered.promise
  await records.revise(record.id, 1, { ...inspection, fingerprint: 'c'.repeat(64) }, payload, configuration)
  const rejection = expect(pending).rejects.toThrow('版本')
  release.resolve(undefined)
  await rejection
  await expect(readFile(claimPath)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('claims a voucher once even when different local proposals and service instances race', async () => {
  const { root, records } = await setup()
  const another = new VoucherDeletionRecords(root, owner, maxBytes)
  const first = await records.create(inspection, payload, configuration)
  const second = await another.create(inspection, payload, configuration)
  const results = await Promise.allSettled([records.reserve(first.id, 1, configuration, allow),
    another.reserve(second.id, 1, configuration, allow)])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const restarted = new VoucherDeletionRecords(root, owner, maxBytes)
  const third = await restarted.create(inspection, payload, configuration)
  await expect(restarted.reserve(third.id, 1, configuration, allow)).rejects.toThrow('已有删除发送意图')
})

it.each(['disk', 'callback'] as const)('rejects valid same-version %s payload changes during confirmation', async (mode) => {
  const { records, recordPath, claimPath } = await setup()
  const record = await records.create(inspection, payload, configuration)
  await expect(records.reserve(record.id, 1, configuration, async (preview) => {
    if (mode === 'callback') preview.previewJson = preview.previewJson.replace('fixture only', 'changed fixture')
    else await writeFile(recordPath(record.id), JSON.stringify({ ...record,
      previewJson: record.previewJson.replace('fixture only', 'changed fixture') }))
  })).rejects.toThrow('内容已变化')
  expect((await records.read(record.id)).phase).toBe('prepared')
  await expect(readFile(claimPath)).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each([{ state: 'accepted' }, { state: 'outcome-unknown' }] as const)('retains %j after restart and refuses another send', async (outcome) => {
  const { root, records } = await setup()
  const record = await records.create(inspection, payload, configuration)
  await records.reserve(record.id, 1, configuration, allow)
  await records.recordOutcome(record.id, 1, outcome)
  const restarted = new VoucherDeletionRecords(root, owner, maxBytes)
  expect((await restarted.read(record.id)).outcome).toEqual(outcome)
  await expect(restarted.reserve(record.id, 1, configuration, allow)).rejects.toThrow()
  await expect(restarted.revise(record.id, 1, inspection, payload, configuration)).rejects.toThrow()
  await expect(restarted.recordOutcome(record.id, 1, { state: 'rejected', code: 201 })).rejects.toThrow()
  const next = await restarted.create(inspection, payload, configuration)
  await expect(restarted.reserve(next.id, 1, configuration, allow)).rejects.toThrow('已有删除发送意图')
})

it.each([{ state: 'rejected', code: 201 }, { state: 'not-sent', reason: 'preflight-failed' }] as const)(
  'permits a separately confirmed new proposal after %j without erasing the old record', async (outcome) => {
    const { records } = await setup()
    const first = await records.create(inspection, payload, configuration)
    await records.reserve(first.id, 1, configuration, allow)
    await records.recordOutcome(first.id, 1, outcome)
    const next = await records.create(inspection, payload, configuration)
    const approve = vi.fn(allow)
    await records.reserve(next.id, 1, configuration, approve)
    expect(approve).toHaveBeenCalledTimes(1)
    expect((await records.read(first.id)).outcome).toEqual(outcome)
  })

it('blocks a target whose claim was saved before a crash left its operation in prepared state', async () => {
  const { records, claimPath } = await setup()
  const first = await records.create(inspection, payload, configuration)
  await writeFile(claimPath, JSON.stringify({ id: first.id, accountId: '35616', voucherId: '123' }))
  const second = await records.create(inspection, payload, configuration)
  await expect(records.reserve(second.id, 1, configuration, allow)).rejects.toThrow('已有删除发送意图')
  await expect(records.reserve(first.id, 1, configuration, allow)).rejects.toThrow('已有删除发送意图')
})

it('fails closed when an old-format record already claimed the target', async () => {
  const { records, recordPath, claimPath } = await setup()
  const first = await records.create(inspection, payload, configuration)
  await writeFile(recordPath(first.id), JSON.stringify({ ...first, schemaVersion: 1,
    payload: { accountName: '测试账套', appId: 'legacy-app',
      cerInfoList: [{ flowId: 'legacy-flow', cerId: '123' }] } }))
  await writeFile(claimPath, JSON.stringify({ id: first.id, accountId: '35616', voucherId: '123' }))
  const second = await records.create(inspection, payload, configuration)
  await expect(records.reserve(second.id, 1, configuration, allow)).rejects.toThrow()
  expect((await records.read(second.id)).phase).toBe('prepared')
})

it('refuses corrupt or wrong-target claims rather than treating them as absent', async () => {
  const { records, claimPath } = await setup()
  const first = await records.create(inspection, payload, configuration)
  await writeFile(claimPath, 'invalid json')
  await expect(records.reserve(first.id, 1, configuration, allow)).rejects.toThrow()
  await writeFile(claimPath, JSON.stringify({ id: first.id, accountId: 'other', voucherId: '123' }))
  await expect(records.reserve(first.id, 1, configuration, allow)).rejects.toThrow('不一致')
})

it('rejects inconsistent persisted preview identity and mismatched proposal inputs', async () => {
  const { records, recordPath } = await setup()
  await expect(records.create(inspection, { ...payload, accountName: 'other' }, configuration)).rejects.toThrow('不一致')
  await expect(records.create({ ...inspection, blockers: ['audited'] }, payload, configuration)).rejects.toThrow('限制')
  const record = await records.create(inspection, payload, configuration)
  await writeFile(recordPath(record.id), JSON.stringify({ ...record, accountId: 'other' }))
  await expect(records.read(record.id)).rejects.toThrow('预览不一致')
})

it('reserves room for the longest transport observation before claiming the target', async () => {
  const { root, records, claimPath } = await setup()
  const record = await records.create(inspection, payload, configuration)
  const bytes = Buffer.byteLength(JSON.stringify({ ...record, phase: 'outcome-unknown' }) + '\n')
  const bounded = new VoucherDeletionRecords(root, owner, bytes)
  await expect(bounded.reserve(record.id, 1, configuration, allow)).rejects.toThrow('大小限制')
  await expect(readFile(claimPath)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await records.read(record.id)).phase).toBe('prepared')
})
