import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { VoucherRecords, type PreparedVoucherRecord } from '../src/voucher-records.ts'

const roots: string[] = []
const configuration = 'a'.repeat(64)
const limits = { maxEntries: 10, maxBytes: 10000 }
const proposal = { date: '2026-09-09', certificateCode: 35, documentMaker: '测试', sourcePaths: [], entries: [
  { summary: '测试', subjectCode: '1001', side: 'debit', amount: '1.00', auxiliary: [] },
  { summary: '测试', subjectCode: '1002', side: 'credit', amount: '1.00', auxiliary: [] },
] }
const approve = async (record: PreparedVoucherRecord) => ({ accountId: '35616',
  identity: { accountName: '测试账套', appId: 'xiaojing-test', flowId: record.id, attachmentUrls: [] } })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'f2-voucher-records-'))
  roots.push(root)
  return { root, records: new VoucherRecords(root, 'client/session', limits) }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('retains a balanced version across reload and isolates owners', async () => {
  const { root, records } = await setup()
  const record = await records.create(proposal, configuration)
  expect(await new VoucherRecords(root, 'client/session', limits).read(record.id)).toEqual(record)
  await expect(new VoucherRecords(root, 'other/session', limits).read(record.id)).rejects.toThrow()
})

it('invalidates the previous version after revision and rejects configuration changes', async () => {
  const { records } = await setup()
  const record = await records.create(proposal, configuration)
  const next = await records.revise(record.id, 1, configuration, { ...proposal, documentMaker: '更正' })
  expect(next.version).toBe(2)
  const approval = vi.fn(approve)
  await expect(records.reserve(record.id, 1, configuration, approval)).rejects.toThrow('版本')
  await expect(records.reserve(record.id, 2, 'b'.repeat(64), approval)).rejects.toThrow('配置')
  expect(approval).not.toHaveBeenCalled()
})

it('does not reserve a cancelled confirmation', async () => {
  const { records } = await setup()
  const record = await records.create(proposal, configuration)
  await expect(records.reserve(record.id, 1, configuration, async () => { throw new Error('用户取消') })).rejects.toThrow('取消')
  expect((await records.read(record.id)).phase).toBe('prepared')
})

it('rejects an approval whose preview was revised while the human was deciding', async () => {
  const { records } = await setup()
  const record = await records.create(proposal, configuration)
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const pending = records.reserve(record.id, 1, configuration, async (current) => {
    entered.resolve(undefined); await release.promise
    return approve(current)
  })
  await entered.promise
  await records.revise(record.id, 1, configuration, { ...proposal, documentMaker: '新版本' })
  const rejected = expect(pending).rejects.toThrow('版本')
  release.resolve(undefined)
  await rejected
  expect((await records.read(record.id)).version).toBe(2)
})

it('reserves once across concurrent callers and retains uncertainty after restart', async () => {
  const { root, records } = await setup()
  const record = await records.create(proposal, configuration)
  const outcomes = await Promise.allSettled([
    records.reserve(record.id, 1, configuration, approve),
    new VoucherRecords(root, 'client/session', limits).reserve(record.id, 1, configuration, approve),
  ])
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const restarted = new VoucherRecords(root, 'client/session', limits)
  expect((await restarted.read(record.id)).phase).toBe('outcome-unknown')
  await expect(restarted.reserve(record.id, 1, configuration, approve)).rejects.toThrow('结果未知')
  await expect(restarted.revise(record.id, 1, configuration, proposal)).rejects.toThrow('结果未知')
})

it('refuses reservation when a later accepted identifier would exceed the record byte limit', async () => {
  const { root, records } = await setup()
  const sample = await records.create(proposal, configuration)
  const reserved = await records.reserve(sample.id, 1, configuration, approve)
  const maxBytes = Buffer.byteLength(JSON.stringify(reserved) + '\n')
  const bounded = new VoucherRecords(root, 'bounded/session', { ...limits, maxBytes })
  const prepared = await bounded.create(proposal, configuration)
  await expect(bounded.reserve(prepared.id, 1, configuration, approve)).rejects.toThrow('保存接口结果')
  expect((await bounded.read(prepared.id)).phase).toBe('prepared')
})

it('requires matching durable original receipts and retains prior uploads when the preview is revised', async () => {
  const { records } = await setup()
  const prepared = await records.create({ ...proposal, sourcePaths: ['invoice.pdf'] }, configuration)
  const receipt = { sourcePath: 'invoice.pdf', name: 'invoice.pdf', sha256: 'b'.repeat(64), size: 10,
    objectKey: 'client/original.pdf', storageRevision: 1, expiresAt: 1900000000000, downloadUrl: 'https://example.test/original.pdf?signature=private' }
  const authorize = async (record: PreparedVoucherRecord) => ({ ...await approve(record),
    identity: { ...(await approve(record)).identity, attachmentUrls: [receipt.downloadUrl] } })
  await expect(records.reserve(prepared.id, 1, configuration, authorize)).rejects.toThrow('上传记录')
  await expect(records.recordOriginal(prepared.id, 1, configuration, { ...receipt, sourcePath: 'other.pdf' })).rejects.toThrow('不属于')
  await records.recordOriginal(prepared.id, 1, configuration, receipt)
  const reserved = await records.reserve(prepared.id, 1, configuration, authorize)
  expect(reserved.originals).toEqual([receipt])
  expect((await records.read(prepared.id)).submission?.identity.attachmentUrls).toEqual([receipt.downloadUrl])
  await expect(records.recordOriginal(prepared.id, 1, configuration, receipt)).rejects.toThrow('发送记录')
  const another = await records.create({ ...proposal, sourcePaths: ['invoice.pdf'] }, configuration)
  await records.recordOriginal(another.id, 1, configuration, receipt)
  const revised = await records.revise(another.id, 1, configuration, proposal)
  expect(revised.originals).toEqual([receipt])
  expect((await records.reserve(another.id, 2, configuration, approve)).submission?.identity.attachmentUrls).toEqual([])
})

it('retains destination, stable identity and exact payload before sending, then persists acceptance without authorizing a resend', async () => {
  const { root, records } = await setup()
  const prepared = await records.create(proposal, configuration)
  const reserved = await records.reserve(prepared.id, 1, configuration, approve)
  expect(reserved.submission).toMatchObject({ accountId: '35616', identity: { flowId: prepared.id, appId: 'xiaojing-test' },
    payload: { certificateCode: 35, certificateDate: proposal.date } })
  const restarted = new VoucherRecords(root, 'client/session', limits)
  expect((await restarted.read(prepared.id)).submission).toEqual(reserved.submission)
  await expect(restarted.recordOutcome(prepared.id, 2, { state: 'accepted', voucherId: '42' })).rejects.toThrow('准确提交版本')
  await restarted.recordOutcome(prepared.id, 1, { state: 'accepted', voucherId: '42' })
  expect(await records.read(prepared.id)).toMatchObject({ phase: 'accepted', outcome: { state: 'accepted', voucherId: '42' } })
  await expect(records.reserve(prepared.id, 1, configuration, approve)).rejects.toThrow('已有发送记录')
  await expect(records.revise(prepared.id, 1, configuration, proposal)).rejects.toThrow('已有发送记录')
})

it('rejects alternate flow IDs and incomplete originals before recording a reservation', async () => {
  const { records } = await setup()
  const prepared = await records.create(proposal, configuration)
  await expect(records.reserve(prepared.id, 1, configuration, async (current) => {
    const value = await approve(current)
    return { ...value, identity: { ...value.identity, flowId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }
  })).rejects.toThrow('标识')
  expect((await records.read(prepared.id)).phase).toBe('prepared')
  await expect(records.recordOutcome(prepared.id, 1, { state: 'accepted', voucherId: '42' })).rejects.toThrow('准确提交版本')
  const withOriginal = await records.create({ ...proposal, sourcePaths: ['invoice.pdf'] }, configuration)
  await expect(records.reserve(withOriginal.id, 1, configuration, approve)).rejects.toThrow('一一对应')
  expect((await records.read(withOriginal.id)).phase).toBe('prepared')
})

it.each([{ state: 'outcome-unknown' }, { state: 'rejected', code: 200 },
  { state: 'not-sent', reason: 'cancelled' }] as const)('retains %j across restart without allowing automatic resubmission', async (outcome) => {
  const { root, records } = await setup()
  const prepared = await records.create(proposal, configuration)
  await records.reserve(prepared.id, 1, configuration, approve)
  await records.recordOutcome(prepared.id, 1, outcome)
  const restarted = new VoucherRecords(root, 'client/session', limits)
  expect((await restarted.read(prepared.id)).outcome).toEqual(outcome)
  await expect(restarted.reserve(prepared.id, 1, configuration, approve)).rejects.toThrow('已有发送记录')
})

it('rejects oversized complete records before publication', async () => {
  const { root } = await setup()
  const bytes = Buffer.byteLength(JSON.stringify(proposal))
  await expect(new VoucherRecords(root, 'client/session', { ...limits, maxBytes: bytes }).create(proposal, configuration))
    .rejects.toThrow('记录超过')
})
