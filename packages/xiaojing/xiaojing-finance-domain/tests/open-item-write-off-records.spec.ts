import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { OpenItemDeletionRecords } from '../src/open-item-deletion-records.ts'
import { collectOpenItemDeletionInventory } from '../src/open-item-deletion.ts'
import { OpenItemWriteOffRecords, type OpenItemWriteOffEvidence } from '../src/open-item-write-off-records.ts'
import { compareOpenItemWriteOff, validateOpenItemWriteOff,
  type OpenItemWriteOffOutcome, type OpenItemWriteOffReceiptId } from '../src/open-item-write-off.ts'
import { projectOpenItems, type OpenItemQuery } from '../src/open-items.ts'
import { projectReferences } from '../src/references.ts'
import { YouchengConnection } from '../src/youcheng.ts'

const owner = 'client/production/35616'
const configuration = 'b'.repeat(64)
const maxBytes = 30000
const limits = { maxBytes, maxRows: 100 }
const ledger = { id: '35616', name: '测试账套' }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const roots: string[] = []
const allow = async () => {}
const raw = { id: 72606, setOfBooksId: 35616, date: '2022-01-01', abstractStr: '核销专用',
  subjectId: 174626, accountStatus: 0, certificateWordAndCode: '', orderCode: '', certificateId: null, tempCertificateId: null,
  attachList: [], otherMoney: 0,
  subjectCode: '', subjectName: '往来账户', auxiliaryItemIds: '191501', auxiliaryItemName: '测试客户',
  currencyCode: 'RMB', baseCurrencyCode: 'RMB', money: 0.19, balance: 0.19,
  thisMoney: 0, badMoney: 0, hedgeMoney: 0, returnMoney: 0, initialBalance: false, isFinish: false, categoryName: '其他收入', remark: '' }
const cash = { accountId: 174622, accountName: '库存现金', status: 0, direction: 0, currencyId: '1', type: 1, subjectCode: '1001' }
async function setup(direction: OpenItemQuery['direction'] = 'receivable') {
  const root = await mkdtemp(join(tmpdir(), 'f3b-write-off-'))
  roots.push(root)
  const claimsRoot = join(root, 'open-item-target-claims')
  const sourceQuery = { direction, periodStart: '2022-01', periodEnd: '2022-01', page: 1, pageSize: 100 }
  const input = validateOpenItemWriteOff({ direction, openItemId: '72606', cashAccountId: '174622', amount: '0.19',
    currencyCode: 'RMB', date: '2022-01-09', keeperName: '测试制单人', sourceQuery }, maxBytes)
  const source = projectOpenItems({ count: 1, list: [raw] }, sourceQuery, ledger, limits.maxRows, maxBytes)
  const cashAccounts = projectReferences([cash], { kind: 'cash-accounts' }, ledger, limits.maxRows, maxBytes)
  const evidence: OpenItemWriteOffEvidence = { input, source, cashAccounts, businessAccountId: '174626' as Branded<'FinanceReferenceId'> }
  return { root, evidence,
    records: new OpenItemWriteOffRecords(root, owner, maxBytes, claimsRoot),
    recordPath: (id: string) => join(root, hash(owner), `${id}.json`),
    claimPath: join(claimsRoot, hash(owner), `target-${hash(JSON.stringify([ledger.id, '72606']))}.json`) }
}
async function deletionInventory(direction: OpenItemQuery['direction'] = 'receivable') {
  return collectOpenItemDeletionInventory({ direction, periodStart: '2022-01', periodEnd: '2022-01' }, '72606',
    async (selection) => {
      const data = { count: 1, list: selection.page === 1 ? [raw] : [] }
      return { raw: data, result: projectOpenItems(data, selection, ledger, limits.maxRows, maxBytes) }
    }, new AbortController().signal, { maxBytes, maxRows: limits.maxRows, maxPages: 4, pageSize: 100 })
}
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it.each(['receivable', 'payable'] as const)('retains exact %s evidence and rejects another owner', async (direction) => {
  const { root, records, evidence } = await setup(direction)
  const record = await records.create(evidence, configuration)
  const restored = await new OpenItemWriteOffRecords(root, owner, maxBytes, join(root, 'open-item-target-claims')).read(record.id)
  expect(JSON.stringify(restored.evidence)).toBe(JSON.stringify(evidence))
  expect(restored.evidence.source.rows[0]!.baseBalance).toBeNull()
  expect(restored.evidence.businessAccountId).toBe('174626')
  expect(restored.phase).toBe('prepared')
  await expect(new OpenItemWriteOffRecords(root, 'foreign/production/35616', maxBytes,
    join(root, 'open-item-target-claims')).read(record.id)).rejects.toThrow()
})

it.each(['partial', 'wrong-direction', 'missing-target', 'duplicate-target', 'page-count', 'wrong-period', 'wrong-cash-ledger',
  'wrong-cash-kind', 'disabled-cash', 'currency-missing', 'duplicate-cash', 'cash-count', 'unknown-status', 'extra-input',
  'extra-evidence', 'extra-source', 'invalid-money', 'invalid-outcome', 'schema', 'owner', 'id', 'oversized'])(
  'rejects corrupt durable %s before confirmation', async (mode) => {
    const { records, evidence, recordPath } = await setup()
    const created = await records.create(evidence, configuration)
    const broken = structuredClone(created)
    const { input, source, cashAccounts } = broken.evidence
    if (mode === 'partial') input.amount = '0.18'
    if (mode === 'wrong-direction') input.direction = 'payable'
    if (mode === 'missing-target') source.rows = []
    if (mode === 'duplicate-target') source.rows.push(source.rows[0]!)
    if (mode === 'page-count') source.totalCount = 0
    if (mode === 'wrong-period') source.selection.periodEnd = '2021-12'
    if (mode === 'wrong-cash-ledger') cashAccounts.accountId = '35601'
    if (mode === 'wrong-cash-kind') cashAccounts.kind = 'subjects'
    if (mode === 'disabled-cash') cashAccounts.rows[0]!.status = 'disabled'
    if (mode === 'currency-missing') delete cashAccounts.rows[0]!.currencyId
    if (mode === 'duplicate-cash') cashAccounts.rows.push(cashAccounts.rows[0]!)
    if (mode === 'cash-count') cashAccounts.returnedCount = 0
    if (mode === 'unknown-status') source.rows[0]!.finished = null
    if (mode === 'extra-input') Object.assign(input, { approved: true })
    if (mode === 'extra-evidence') Object.assign(broken.evidence, { journalId: '141108' })
    if (mode === 'extra-source') Object.assign(source, { validated: true })
    if (mode === 'invalid-money') source.rows[0]!.settledAmount = ''
    if (mode === 'invalid-outcome') Object.assign(broken, { phase: 'accepted', outcome: { state: 'accepted' } })
    if (mode === 'schema') Object.assign(broken, { schemaVersion: 2 })
    if (mode === 'owner') broken.ownerDigest = 'c'.repeat(64)
    if (mode === 'id') Object.assign(broken, { id: '11111111-1111-4111-8111-111111111111' })
    if (mode === 'oversized') source.notice = '多'.repeat(maxBytes)
    await writeFile(recordPath(created.id), JSON.stringify(broken))
    const authorize = vi.fn(allow)
    await expect(records.reserve(created.id, 1, configuration, authorize)).rejects.toThrow()
    expect(authorize).not.toHaveBeenCalled()
  })

it('invalidates old versions and configuration before authorization', async () => {
  const { records, evidence } = await setup()
  const first = await records.create(evidence, configuration)
  evidence.input.date = '2022-01-10'
  const revised = await records.revise(first.id, 1, evidence, 'c'.repeat(64))
  expect(revised.version).toBe(2)
  const authorize = vi.fn(allow)
  await expect(records.reserve(first.id, 1, configuration, authorize)).rejects.toThrow('版本')
  await expect(records.reserve(first.id, 2, configuration, authorize)).rejects.toThrow('配置')
  expect(authorize).not.toHaveBeenCalled()
})

it.each(['decline', 'revise', 'unversioned-change', 'business-account-change'])('does not reserve after %s during confirmation', async (mode) => {
  const { records, evidence, recordPath, claimPath } = await setup()
  const first = await records.create(evidence, configuration)
  await expect(records.reserve(first.id, 1, configuration, async () => {
    if (mode === 'decline') throw new Error('cancelled')
    if (mode === 'revise') await records.revise(first.id, 1, evidence, configuration)
    else {
      if (mode === 'business-account-change') first.evidence.businessAccountId = '999999' as Branded<'FinanceReferenceId'>
      else first.evidence.input.keeperName = 'changed'
      await writeFile(recordPath(first.id), JSON.stringify(first))
    }
  })).rejects.toThrow()
  expect((await records.read(first.id)).phase).toBe('prepared')
  await expect(readFile(claimPath)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('keeps identity-unavailable evidence readable but refuses reservation before authorization', async () => {
  const { records, evidence, claimPath } = await setup()
  delete evidence.businessAccountId
  const first = await records.create(evidence, configuration)
  const authorize = vi.fn(allow)
  await expect(records.reserve(first.id, 1, configuration, authorize)).rejects.toThrow('业务账户身份')
  expect(authorize).not.toHaveBeenCalled()
  expect((await records.read(first.id)).phase).toBe('prepared')
  await expect(readFile(claimPath)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('preserves an accepted receipt without reconstructing a missing original business-account identity', async () => {
  const { root, records, evidence, recordPath } = await setup()
  const first = await records.create(evidence, configuration)
  await records.reserve(first.id, 1, configuration, allow)
  await records.recordOutcome(first.id, 1, { state: 'accepted', receiptId: '65833' as OpenItemWriteOffReceiptId })
  const saved = await records.read(first.id)
  delete saved.evidence.businessAccountId
  const original = JSON.stringify(saved)
  await writeFile(recordPath(first.id), original)
  const restored = await new OpenItemWriteOffRecords(root, owner, maxBytes, join(root, 'open-item-target-claims')).read(first.id)
  expect(restored.outcome).toEqual({ state: 'accepted', receiptId: '65833' })
  expect(restored.evidence.businessAccountId).toBeUndefined()
  expect(await readFile(recordPath(first.id), 'utf8')).toBe(original)
})

it('allows one concurrent reservation across sessions and query directions', async () => {
  const { root, records, evidence } = await setup()
  const other = new OpenItemWriteOffRecords(root, owner, maxBytes, join(root, 'open-item-target-claims'))
  const first = await records.create(evidence, configuration)
  evidence.input.direction = evidence.input.sourceQuery.direction = evidence.source.selection.direction = 'payable'
  const second = await other.create(evidence, configuration)
  const results = await Promise.allSettled([records.reserve(first.id, 1, configuration, allow),
    other.reserve(second.id, 1, configuration, allow)])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
})

it('allows only one concurrent deletion or write-off reservation for the same target', async () => {
  const { root, records: writeOffs, evidence } = await setup()
  const claimsRoot = join(root, 'open-item-target-claims')
  const deletions = new OpenItemDeletionRecords(join(root, 'deletions'), owner, maxBytes, claimsRoot)
  const deletion = await deletions.create(await deletionInventory(), configuration)
  const writeOff = await writeOffs.create(evidence, configuration)
  const results = await Promise.allSettled([deletions.reserve(deletion.id, 1, configuration, allow),
    writeOffs.reserve(writeOff.id, 1, configuration, allow)])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
})

it('retains accepted and uncertain claims across operation types and restarts', async () => {
  for (const operation of ['deletion', 'write-off'] as const) {
    for (const state of ['accepted', 'outcome-unknown'] as const) {
      const { root, records: writeOffs, evidence } = await setup()
      const claimsRoot = join(root, 'open-item-target-claims')
      const deletionRoot = join(root, 'deletions')
      const deletions = new OpenItemDeletionRecords(deletionRoot, owner, maxBytes, claimsRoot)
      const inventory = await deletionInventory()
      if (operation === 'deletion') {
        const first = await deletions.create(inventory, configuration)
        await deletions.reserve(first.id, 1, configuration, allow)
        await deletions.recordOutcome(first.id, 1, { state })
        const restarted = new OpenItemWriteOffRecords(root, owner, maxBytes, claimsRoot)
        const next = await restarted.create(evidence, configuration)
        await expect(restarted.reserve(next.id, 1, configuration, allow)).rejects.toThrow('删除发送意图')
      } else {
        const first = await writeOffs.create(evidence, configuration)
        await writeOffs.reserve(first.id, 1, configuration, allow)
        await writeOffs.recordOutcome(first.id, 1, state === 'accepted'
          ? { state, receiptId: '65833' as OpenItemWriteOffReceiptId } : { state })
        const restarted = new OpenItemDeletionRecords(deletionRoot, owner, maxBytes, claimsRoot)
        const next = await restarted.create(inventory, configuration)
        await expect(restarted.reserve(next.id, 1, configuration, allow)).rejects.toThrow('核销发送意图')
      }
    }
  }
})

it('releases rejected and not-sent claims for a newly confirmed other operation', async () => {
  for (const operation of ['deletion', 'write-off'] as const) {
    for (const state of ['rejected', 'not-sent'] as const) {
      const { root, records: writeOffs, evidence } = await setup()
      const claimsRoot = join(root, 'open-item-target-claims')
      const deletions = new OpenItemDeletionRecords(join(root, 'deletions'), owner, maxBytes, claimsRoot)
      const inventory = await deletionInventory()
      const observation = state === 'rejected' ? { state, code: 201 } as const
        : { state, reason: 'cancelled' } as const
      if (operation === 'deletion') {
        const first = await deletions.create(inventory, configuration)
        await deletions.reserve(first.id, 1, configuration, allow)
        await deletions.recordOutcome(first.id, 1, observation)
        const next = await writeOffs.create(evidence, configuration)
        expect((await writeOffs.reserve(next.id, 1, configuration, allow)).phase).toBe('outcome-unknown')
      } else {
        const first = await writeOffs.create(evidence, configuration)
        await writeOffs.reserve(first.id, 1, configuration, allow)
        await writeOffs.recordOutcome(first.id, 1, observation)
        const next = await deletions.create(inventory, configuration)
        expect((await deletions.reserve(next.id, 1, configuration, allow)).phase).toBe('outcome-unknown')
      }
    }
  }
})

it.each(['corrupt', 'missing-operation'] as const)('fails closed across operation types for a %s shared claim', async (mode) => {
  const { root, records: writeOffs, evidence, claimPath } = await setup()
  const claimsRoot = join(root, 'open-item-target-claims')
  const deletionRoot = join(root, 'deletions')
  const deletions = new OpenItemDeletionRecords(deletionRoot, owner, maxBytes, claimsRoot)
  const first = await deletions.create(await deletionInventory(), configuration)
  await deletions.reserve(first.id, 1, configuration, allow)
  if (mode === 'corrupt') await writeFile(claimPath, '{broken')
  else await rm(join(deletionRoot, hash(owner), `${first.id}.json`))
  const next = await writeOffs.create(evidence, configuration)
  await expect(writeOffs.reserve(next.id, 1, configuration, allow)).rejects.toThrow()
})

it.each(['torn', 'missing-original', 'corrupt-claim', 'wrong-target'])(
  'fails closed after %s persisted claim without reconstructing permission', async (mode) => {
    const { root, records, evidence, recordPath, claimPath } = await setup()
    const first = await records.create(evidence, configuration)
    await records.reserve(first.id, 1, configuration, allow)
    if (mode === 'torn') await writeFile(recordPath(first.id), JSON.stringify(first))
    if (mode === 'missing-original') await rm(recordPath(first.id))
    if (mode === 'corrupt-claim') await writeFile(claimPath, '{broken')
    if (mode === 'wrong-target') await writeFile(claimPath, JSON.stringify({ id: first.id, ledgerId: '35601', openItemId: '72606' }))
    const reloaded = new OpenItemWriteOffRecords(root, owner, maxBytes, join(root, 'open-item-target-claims'))
    const second = await reloaded.create(evidence, configuration)
    await expect(reloaded.reserve(second.id, 1, configuration, allow)).rejects.toThrow()
  })

it.each<OpenItemWriteOffOutcome>([{ state: 'accepted', receiptId: '65833' as OpenItemWriteOffReceiptId }, { state: 'outcome-unknown' },
  { state: 'rejected', code: 201 }, { state: 'not-sent', reason: 'cancelled' },
  { state: 'not-sent', reason: 'preflight-failed', preflightStage: 'final-confirmation' }])(
  'retains $state once and only permits a fresh proposal after explicit rejection or no send', async (outcome) => {
    const { root, records, evidence } = await setup()
    const first = await records.create(evidence, configuration)
    await records.reserve(first.id, 1, configuration, allow)
    await expect(records.recordOutcome(first.id, 2, outcome)).rejects.toThrow()
    await records.recordOutcome(first.id, 1, outcome)
    const reloaded = new OpenItemWriteOffRecords(root, owner, maxBytes, join(root, 'open-item-target-claims'))
    expect((await reloaded.read(first.id)).outcome).toEqual(outcome)
    await expect(reloaded.recordOutcome(first.id, 1, outcome)).rejects.toThrow()
    await expect(reloaded.revise(first.id, 1, evidence, configuration)).rejects.toThrow()
    await expect(reloaded.reserve(first.id, 1, configuration, allow)).rejects.toThrow()
    const second = await reloaded.create(evidence, configuration)
    if (outcome.state === 'rejected' || outcome.state === 'not-sent') {
      expect((await reloaded.reserve(second.id, 1, configuration, allow)).phase).toBe('outcome-unknown')
    } else await expect(reloaded.reserve(second.id, 1, configuration, allow)).rejects.toThrow('发送意图')
  })

it('reserves room for the largest receipt before consuming a target claim', async () => {
  const { root, records, evidence, recordPath, claimPath } = await setup()
  const first = await records.create(evidence, configuration)
  const size = (await readFile(recordPath(first.id))).length
  const limited = new OpenItemWriteOffRecords(root, owner, size + 20, join(root, 'open-item-target-claims'))
  await expect(limited.reserve(first.id, 1, configuration, allow)).rejects.toThrow('大小')
  await expect(readFile(claimPath)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await records.read(first.id)).phase).toBe('prepared')
})

it('refuses unreserved or malformed receipts without changing the durable phase', async () => {
  const { records, evidence } = await setup()
  const record = await records.create(evidence, configuration)
  await expect(records.recordOutcome(record.id, 1, { state: 'outcome-unknown' })).rejects.toThrow()
  await records.reserve(record.id, 1, configuration, allow)
  await expect(records.recordOutcome(record.id, 1, {
    state: 'accepted', receiptId: '9'.repeat(201) as OpenItemWriteOffReceiptId,
  })).rejects.toThrow()
  expect((await records.read(record.id)).outcome).toBeUndefined()
  const receipt = '9'.repeat(200) as OpenItemWriteOffReceiptId
  expect((await records.recordOutcome(record.id, 1, { state: 'accepted', receiptId: receipt })).outcome)
    .toEqual({ state: 'accepted', receiptId: receipt })
})

for (const direction of ['receivable', 'payable'] as const) {
  it.each(['accepted', 'lost', 'cancel-after'])(`persists ${direction} intent before real sender dispatch and recovers %s read-only`, async (mode) => {
    const { root, records, evidence, claimPath } = await setup(direction)
    const record = await records.create(evidence, configuration)
    const controller = new AbortController()
    let writes = 0
    let settled = false
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'fake-token' })
      if (url.pathname === '/finance/auxiliary/queryAccountList.rjson') {
        return Response.json({ result: 100, data: [{ id: ledger.id, sobName: ledger.name }] })
      }
      if (url.pathname === '/finance/cashjournal/getCashierList') return Response.json({ result: 100, data: {
        count: 1, list: [{ ...raw, ...settled ? { balance: 0, thisMoney: 0.19, isFinish: true } : {} }] } })
      if (url.pathname === '/finance/cashjournal/getAccountList.rjson') return Response.json({ result: 100, data: [cash] })
      expect(url.pathname).toBe('/finance/cashier/account/management/writeOff.rjson')
      expect((await records.read(record.id)).phase).toBe('outcome-unknown')
      expect(JSON.parse(await readFile(claimPath, 'utf8'))).toMatchObject({ id: record.id, openItemId: '72606' })
      writes++
      settled = true
      if (mode === 'lost') throw new Error('lost')
      if (mode === 'cancel-after') { controller.abort(); throw new Error('cancelled') }
      return Response.json({ result: 100, data: '65833' })
    }))
    const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 2000, true)
    const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: ledger.id }
    const result = await adapter.sendReservedOpenItemWriteOff(config, 'fake-secret', evidence, controller.signal, limits,
      async () => { await records.reserve(record.id, 1, configuration, allow) })
    await records.recordOutcome(record.id, 1, result)
    const restored = await new OpenItemWriteOffRecords(root, owner, maxBytes, join(root, 'open-item-target-claims')).read(record.id)
    const after = await adapter.queryOpenItems(config, 'fake-secret', evidence.input.sourceQuery,
      new AbortController().signal, limits.maxRows, limits.maxBytes)
    expect(compareOpenItemWriteOff(restored.evidence.input, restored.evidence.source, after)).toEqual({
      content: 'matched', settlement: 'matched', operation: 'unverified' })
    expect(restored.outcome).toEqual(mode === 'accepted' ? { state: 'accepted', receiptId: '65833' } : { state: 'outcome-unknown' })
    await expect(records.reserve(record.id, 1, configuration, allow)).rejects.toThrow()
    expect(writes).toBe(1)
    expect(JSON.stringify(restored)).not.toMatch(/fake-key|fake-secret|fake-token|journalId/)
  })
}
