import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { OpenItemDeletionRecords } from '../src/open-item-deletion-records.ts'
import { collectOpenItemDeletionInventory, compareOpenItemDeletion } from '../src/open-item-deletion.ts'
import { projectOpenItems, type OpenItemQuery } from '../src/open-items.ts'
import { YouchengConnection } from '../src/youcheng.ts'

const owner = 'client/production/35616'
const configuration = 'b'.repeat(64)
const maxBytes = 30000
const roots: string[] = []
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const limits = { maxBytes, maxRows: 10, maxPages: 4, pageSize: 2 }
const ledger = { id: '35616', name: '测试账套' }
const raw = { id: 72604, setOfBooksId: 35616, subjectId: 174626, accountStatus: 0,
  date: '2022-01-01', abstractStr: 'dedicated test', subjectCode: '', subjectName: '往来账户',
  auxiliaryItemIds: '191501', auxiliaryItemName: '测试客户', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
  money: 0.01, balance: 0.01, thisMoney: 0, badMoney: 0, hedgeMoney: 0, returnMoney: 0,
  initialBalance: false, isFinish: false, categoryName: '其他收入', remark: '',
  attachList: [], certificateWordAndCode: '', orderCode: '' }
const allow = async () => {}
async function setup(direction: OpenItemQuery['direction'] = 'receivable') {
  const root = await mkdtemp(join(tmpdir(), 'f3b-open-item-deletion-'))
  roots.push(root)
  const claimsRoot = join(root, 'open-item-target-claims')
  await mkdir(join(claimsRoot, hash(owner)), { recursive: true })
  const inventory = await collectOpenItemDeletionInventory({ direction, periodStart: '2022-01', periodEnd: '2022-01' },
    String(raw.id), async (selection) => {
      const data = { count: 1, list: selection.page === 1 ? [raw] : [] }
      return { raw: data, result: projectOpenItems(data, selection, ledger, limits.maxRows, limits.maxBytes) }
    }, new AbortController().signal, limits)
  return { root, inventory, records: new OpenItemDeletionRecords(root, owner, maxBytes, claimsRoot),
    recordPath: (id: string) => join(root, hash(owner), `${id}.json`),
    claimPath: join(claimsRoot, hash(owner), `target-${hash(JSON.stringify([ledger.id, String(raw.id)]))}.json`) }
}
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it.each(['receivable', 'payable'] as const)('reloads %s evidence without converting unknowns or granting permission', async (direction) => {
  const { root, records, inventory } = await setup(direction)
  const created = await records.create(inventory, configuration)
  const loaded = await new OpenItemDeletionRecords(root, owner, maxBytes, join(root, 'open-item-target-claims')).read(created.id)
  expect(JSON.stringify(loaded.inventory)).toBe(JSON.stringify(inventory))
  expect(loaded.inventory.target.unverified).toHaveLength(4)
  expect(loaded.inventory.target.row.baseBalance).toBeNull()
  expect(loaded.phase).toBe('prepared')
  await expect(new OpenItemDeletionRecords(root, 'other/production/35616', maxBytes,
    join(root, 'open-item-target-claims')).read(created.id)).rejects.toThrow()
})

it.each(['count', 'duplicate', 'fingerprints', 'content-fingerprints', 'period', 'reversed-period', 'account', 'direction', 'target-row',
  'target-fingerprint', 'missing-target', 'amount', 'extra-field', 'unknown-schema', 'owner', 'id', 'outcome', 'oversized'])(
  'rejects persisted %s damage before approval', async (mode) => {
    const { records, inventory, recordPath } = await setup()
    const created = await records.create(inventory, configuration)
    const value = structuredClone(created.inventory)
    const broken = { ...created, inventory: value }
    if (mode === 'count') value.totalCount = 2
    if (mode === 'duplicate') { value.rows.push(value.target.row); value.totalCount = 2 }
    if (mode === 'fingerprints') value.fingerprints = {}
    if (mode === 'content-fingerprints') value.contentFingerprints = {}
    if (mode === 'period') value.selection.periodStart = value.selection.periodEnd = '2022-02'
    if (mode === 'reversed-period') value.selection.periodEnd = '2021-12'
    if (mode === 'account') value.accountName = 'other'
    if (mode === 'direction') value.selection.direction = 'payable'
    if (mode === 'target-row') value.target.row = { ...value.target.row, summary: 'changed' }
    if (mode === 'target-fingerprint') value.target.fingerprint = 'c'.repeat(64)
    if (mode === 'missing-target') Reflect.deleteProperty(value, 'target')
    if (mode === 'amount') value.target.row.amount = '0.011'
    if (mode === 'extra-field') Object.assign(value.target, { allowDeletion: true })
    if (mode === 'unknown-schema') Object.assign(broken, { schemaVersion: 2 })
    if (mode === 'owner') broken.ownerDigest = 'c'.repeat(64)
    if (mode === 'id') Object.assign(broken, { id: '11111111-1111-4111-8111-111111111111' })
    if (mode === 'outcome') Object.assign(broken, { outcome: { state: 'accepted' } })
    if (mode === 'oversized') value.target.unverified.push('x'.repeat(maxBytes))
    await writeFile(recordPath(created.id), JSON.stringify(broken))
    const approve = vi.fn(allow)
    await expect(records.reserve(created.id, 1, configuration, approve)).rejects.toThrow()
    expect(approve).not.toHaveBeenCalled()
  })

it('persists blocked previews for inspection but refuses reservation before approval', async () => {
  const { records, inventory, claimPath } = await setup()
  inventory.target!.blockers.push('有关联凭证')
  const created = await records.create(inventory, configuration)
  const approve = vi.fn(allow)
  await expect(records.reserve(created.id, 1, configuration, approve)).rejects.toThrow('删除限制')
  expect(approve).not.toHaveBeenCalled()
  await expect(readFile(claimPath)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('invalidates previous confirmation on revision or configuration change', async () => {
  const { records, inventory } = await setup()
  const created = await records.create(inventory, configuration)
  const revised = await records.revise(created.id, 1, inventory, 'c'.repeat(64))
  expect(revised.version).toBe(2)
  const approve = vi.fn(allow)
  await expect(records.reserve(created.id, 1, configuration, approve)).rejects.toThrow('版本')
  await expect(records.reserve(created.id, 2, configuration, approve)).rejects.toThrow('配置')
  expect(approve).not.toHaveBeenCalled()
})

it('leaves no claim when risk qualification or approval rejects', async () => {
  const { records, inventory, claimPath } = await setup()
  const created = await records.create(inventory, configuration)
  await expect(records.reserve(created.id, 1, configuration, async () => { throw new Error('not approved') })).rejects.toThrow('not approved')
  expect((await records.read(created.id)).phase).toBe('prepared')
  await expect(readFile(claimPath)).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each(['revision', 'content-without-version'] as const)('refuses %s changes during approval', async (mode) => {
  const { records, inventory, recordPath, claimPath } = await setup()
  const created = await records.create(inventory, configuration)
  await expect(records.reserve(created.id, 1, configuration, async () => {
    if (mode === 'revision') await records.revise(created.id, 1, inventory, configuration)
    else {
      const changed = structuredClone(created)
      changed.inventory.target.unverified.push('新增限制')
      await writeFile(recordPath(created.id), JSON.stringify(changed))
    }
  })).rejects.toThrow(mode === 'revision' ? '版本' : '内容已变化')
  await expect(readFile(claimPath)).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each(['receivable', 'payable'] as const)('reserves %s only once across concurrent instances and reload', async (direction) => {
  const { root, records, inventory } = await setup(direction)
  const other = new OpenItemDeletionRecords(root, owner, maxBytes, join(root, 'open-item-target-claims'))
  const first = await records.create(inventory, configuration)
  const second = await other.create(inventory, configuration)
  const results = await Promise.allSettled([
    records.reserve(first.id, 1, configuration, allow), other.reserve(second.id, 1, configuration, allow),
  ])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const restarted = new OpenItemDeletionRecords(root, owner, maxBytes, join(root, 'open-item-target-claims'))
  const next = await restarted.create(inventory, configuration)
  await expect(restarted.reserve(next.id, 1, configuration, allow)).rejects.toThrow('已有删除发送意图')
})

it('does not let a different query direction claim the same ledger/ID', async () => {
  const { records, inventory } = await setup()
  const first = await records.create(inventory, configuration)
  await records.reserve(first.id, 1, configuration, allow)
  const changed = structuredClone(inventory)
  changed.selection.direction = changed.target!.direction = 'payable'
  const second = await records.create(changed, configuration)
  await expect(records.reserve(second.id, 1, configuration, allow)).rejects.toThrow('目标记录不一致')
})

it.each([{ state: 'accepted' }, { state: 'outcome-unknown' }] as const)('retains %j without enabling replay', async (outcome) => {
  const { root, records, inventory } = await setup()
  const created = await records.create(inventory, configuration)
  await records.reserve(created.id, 1, configuration, allow)
  await records.recordOutcome(created.id, 1, outcome)
  const reloaded = new OpenItemDeletionRecords(root, owner, maxBytes, join(root, 'open-item-target-claims'))
  expect((await reloaded.read(created.id)).outcome).toEqual(outcome)
  await expect(reloaded.reserve(created.id, 1, configuration, allow)).rejects.toThrow()
  await expect(reloaded.revise(created.id, 1, inventory, configuration)).rejects.toThrow()
  await expect(reloaded.recordOutcome(created.id, 1, { state: 'rejected', code: 201 })).rejects.toThrow()
  const next = await reloaded.create(inventory, configuration)
  await expect(reloaded.reserve(next.id, 1, configuration, allow)).rejects.toThrow('已有删除发送意图')
})

it.each([{ state: 'rejected', code: 201 }, { state: 'not-sent', reason: 'cancelled' }] as const)(
  'requires a new approved proposal after %j', async (outcome) => {
    const { records, inventory } = await setup()
    const created = await records.create(inventory, configuration)
    await records.reserve(created.id, 1, configuration, allow)
    await records.recordOutcome(created.id, 1, outcome)
    await expect(records.reserve(created.id, 1, configuration, allow)).rejects.toThrow()
    const next = await records.create(inventory, configuration)
    const approve = vi.fn(allow)
    await records.reserve(next.id, 1, configuration, approve)
    expect(approve).toHaveBeenCalledTimes(1)
    expect((await records.read(created.id)).outcome).toEqual(outcome)
  })

it.each(['torn-reservation', 'corrupt', 'wrong-id', 'wrong-direction', 'missing-operation'])(
  'refuses %s claims rather than allowing another send', async (mode) => {
    const { records, inventory, claimPath, recordPath } = await setup()
    const first = await records.create(inventory, configuration)
    await writeFile(claimPath, mode === 'corrupt' ? 'broken' : JSON.stringify({ id: first.id, accountId: ledger.id,
      openItemId: mode === 'wrong-id' ? '72699' : String(raw.id), direction: mode === 'wrong-direction' ? 'payable' : 'receivable' }))
    if (mode === 'missing-operation') await rm(recordPath(first.id))
    const next = await records.create(inventory, configuration)
    await expect(records.reserve(next.id, 1, configuration, allow)).rejects.toThrow()
    if (mode === 'torn-reservation') await expect(records.reserve(first.id, 1, configuration, allow)).rejects.toThrow()
  })

it('requires space for an eventual response before claiming the target', async () => {
  const { root, records, inventory, claimPath } = await setup()
  const created = await records.create(inventory, configuration)
  const bytes = Buffer.byteLength(JSON.stringify({ ...created, phase: 'outcome-unknown' }) + '\n')
  const bounded = new OpenItemDeletionRecords(root, owner, bytes, join(root, 'open-item-target-claims'))
  await expect(bounded.reserve(created.id, 1, configuration, allow)).rejects.toThrow('大小限制')
  await expect(readFile(claimPath)).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each(['accepted', 'lost', 'cancel-after'] as const)(
  'uses real disk reservation before one %s transport and recovers read-only', async (mode) => {
    const { root, records, inventory, recordPath, claimPath } = await setup()
    const created = await records.create(inventory, configuration)
    const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fixture-key', accountCode: ledger.id }
    const controller = new AbortController()
    let writes = 0
    let remoteRows = [raw]
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'fixture-token' })
      if (url.pathname === '/finance/auxiliary/queryAccountList.rjson') return Response.json({ result: 100,
        data: [{ id: ledger.id, sobName: ledger.name }] })
      if (typeof init.body !== 'string') throw new Error('missing request body')
      if (url.pathname === '/finance/cashjournal/getCashierList') {
        const { page } = JSON.parse(init.body) as { page: number }
        return Response.json({ result: 100, data: { count: remoteRows.length, list: page === 1 ? remoteRows : [] } })
      }
      expect(url.pathname).toBe('/finance/cashier/account/management/delete.rjson')
      expect(JSON.parse(init.body)).toEqual({ booksName: ledger.name, managementId: raw.id })
      expect(JSON.parse(await readFile(recordPath(created.id), 'utf8'))).toMatchObject({ phase: 'outcome-unknown', version: 1 })
      expect(JSON.parse(await readFile(claimPath, 'utf8'))).toMatchObject({ id: created.id, openItemId: String(raw.id) })
      writes++
      remoteRows = []
      if (mode === 'lost') throw new Error('response lost after remote deletion')
      if (mode === 'cancel-after') { controller.abort(); throw new Error('cancelled after remote deletion') }
      return Response.json({ result: 100, data: '1' })
    }))
    const adapter = new YouchengConnection({ test: 'https://example.test', production: 'https://example.test' }, 2000, true)
    const result = await adapter.sendReservedOpenItemDeletion(config, 'fixture-secret', created.inventory, controller.signal,
      limits, async () => { await records.reserve(created.id, 1, configuration, allow) })
    expect(writes).toBe(1)
    expect(result.state).toBe(mode === 'accepted' ? 'accepted' : 'outcome-unknown')
    await records.recordOutcome(created.id, 1, result)
    const restarted = new OpenItemDeletionRecords(root, owner, maxBytes, join(root, 'open-item-target-claims'))
    expect((await restarted.read(created.id)).outcome).toEqual(result)
    const after = await adapter.inspectOpenItemDeletion(config, 'fixture-secret', inventory.selection,
      String(raw.id), new AbortController().signal, limits)
    expect(compareOpenItemDeletion(inventory, after)).toMatchObject({ target: 'not-observed', content: 'matched',
      remainingBalances: 'matched', scope: 'selected-direction-periods',
      balances: { original: { state: 'matched' }, base: { state: 'matched', changes: [{ basis: 'same-currency' }] } } })
    await expect(restarted.reserve(created.id, 1, configuration, allow)).rejects.toThrow('不得重发')
    expect((await restarted.read(created.id)).outcome).toEqual(result)
    expect(writes).toBe(1)
  })
