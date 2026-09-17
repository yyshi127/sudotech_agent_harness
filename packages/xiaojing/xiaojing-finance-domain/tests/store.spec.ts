import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FinanceClientStore } from '../src/store.ts'
import type { FinanceClientDraft } from '../src/types.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function store(): Promise<FinanceClientStore> {
  const root = await mkdtemp(join(tmpdir(), 'xiaojing-finance-store-'))
  roots.push(root)
  const value = new FinanceClientStore(root)
  await value.init()
  return value
}

const client = (name: string, code?: string) => ({
  legalName: name,
  shortName: name,
  ...(code === undefined ? {} : { unifiedSocialCreditCode: code }),
  taxpayerType: 'general-vat' as const,
  registeredRegion: '上海市',
  accountingStandard: 'enterprise' as const,
  chartMappings: [],
  externalSystemRefs: [],
})

const createRequest = (expectedRevision: number, value: FinanceClientDraft) => ({
  expectedRevision,
  client: value,
  workspacePath: join(tmpdir(), `finance-workspace-${value.legalName}`),
})

describe('FinanceClientStore', () => {
  it('requires a short display name for new and updated records', async () => {
    const records = await store()
    const { shortName: _shortName, ...withoutShortName } = client('甲公司')
    await expect(records.create(createRequest(0, withoutShortName))).rejects.toThrow(/shortName is required/)
    const created = await records.create(createRequest(0, client('甲公司')))
    await expect(records.update({
      clientId: created.client.id,
      expectedRevision: created.revision,
      client: withoutShortName,
    })).rejects.toThrow(/shortName is required/)
  })

  it('creates, replaces, and archives records with catalog compare-and-swap', async () => {
    const records = await store()
    const created = await records.create(createRequest(0, client('甲公司')))
    expect(created).toMatchObject({ revision: 1, client: { legalName: '甲公司', version: 1, status: 'active' } })

    await expect(records.update({
      clientId: created.client.id,
      expectedRevision: 0,
      client: client('错误覆盖'),
    })).rejects.toThrow(/revision conflict/)

    const updated = await records.update({
      clientId: created.client.id,
      expectedRevision: 1,
      client: { ...client('甲公司'), shortName: '甲企', financePolicyNotes: '费用按部门归集。' },
    })
    expect(updated).toMatchObject({ revision: 2, client: { shortName: '甲企', version: 2 } })

    const archived = await records.archive({ clientId: created.client.id, expectedRevision: 2 })
    expect(archived).toMatchObject({ revision: 3, client: { status: 'archived', version: 3 } })
    await expect(records.update({
      clientId: created.client.id,
      expectedRevision: 3,
      client: client('不可修改'),
    })).rejects.toThrow(/archived clients cannot be edited/)
    expect((await records.list()).clients).toHaveLength(1)
  })

  it('rejects duplicate unified social credit codes including archived records', async () => {
    const records = await store()
    const first = await records.create(createRequest(0, client('甲公司', '91310000MA1K123456')))
    await records.archive({ clientId: first.client.id, expectedRevision: 1 })
    await expect(records.create(createRequest(
      2,
      client('乙公司', '91310000MA1K123456'),
    ))).rejects.toThrow(/already belongs to another client/)
  })

  it('uses atomic replacement and leaves no partial sibling after writes', async () => {
    const records = await store()
    await records.create(createRequest(0, client('原子公司')))
    const parsed = JSON.parse(await readFile(records.filePath, 'utf8')) as { schemaVersion: number; revision: number }
    expect(parsed).toMatchObject({ schemaVersion: 1, revision: 1 })
    expect((await readdir(records.root)).sort()).toEqual(['clients-v1.json'])
  })

  it('refuses malformed durable data without replacing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xiaojing-finance-corrupt-'))
    roots.push(root)
    const records = new FinanceClientStore(root)
    await records.init()
    const malformed = '{"schemaVersion":1,"revision":0,"clients":['
    await writeFile(records.filePath, malformed, 'utf8')

    await expect(new FinanceClientStore(root).init()).rejects.toThrow(/cannot parse/)
    expect(await readFile(records.filePath, 'utf8')).toBe(malformed)
  })
})
