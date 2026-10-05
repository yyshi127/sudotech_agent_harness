import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  CredentialProvider,
  credentialKey,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import XiaojingFinanceDomain from '../src/index.ts'
import { OpenItemDeletionRecords, type OpenItemDeletionId } from '../src/open-item-deletion-records.ts'
import { OpenItemWriteOffRecords, type OpenItemWriteOffId } from '../src/open-item-write-off-records.ts'
import type { OpenItemWriteOffReceiptId } from '../src/open-item-write-off.ts'
import * as financeContext from '../src/context.ts'
import {
  resolveFinanceClientWorkspace,
  resolveFinanceWorkspaceLayout,
} from '../src/workspace.ts'

const roots: string[] = []

class MemoryCredentials extends CredentialProvider {
  private readonly records = new Map<CredentialKey, CredentialRecord>()

  override resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return Promise.resolve(undefined)
  }

  override describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: false, writable: true })
  }

  override set(_ref: CredentialRef, _value: string): Promise<void> {
    return Promise.resolve()
  }

  override unset(_ref: CredentialRef): Promise<void> {
    return Promise.resolve()
  }

  override readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(this.records.get(key))
  }

  override describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const record = this.records.get(key)
    return Promise.resolve(record === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: record.kind, writable: true })
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([...this.records].map(([key, record]) => ({ key, kind: record.kind })))
  }

  override async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const current = this.records.get(key)
    const next = await mutate(current)
    if (next === undefined) return current
    this.records.set(key, next)
    return next
  }

  override deleteRecord(key: CredentialKey): Promise<void> {
    this.records.delete(key)
    return Promise.resolve()
  }
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function workspaceRegistry() {
  const byPath = new Map<string, Workspace>()
  const byId = new Map<Workspace['id'], Workspace>()
  let sequence = 0
  return {
    byPath,
    service: {
      create: async (path: string, initialTitle?: string): Promise<Workspace> => {
        const canonical = resolve(path)
        const existing = byPath.get(canonical)
        if (existing !== undefined) return existing
        let title = initialTitle ?? basename(canonical)
        const workspace: Workspace = {
          id: `finance-workspace-${++sequence}` as Workspace['id'],
          path: canonical,
          get title() { return title },
          createdAt: '2026-08-27T00:00:00.000Z',
          updatedAt: '2026-08-27T00:00:00.000Z',
          sessionIds: [],
          setTitle: async (value) => { title = value },
          attachSession: async () => {},
          insertSessionBefore: async () => {},
          detachSession: async () => {},
          status: async () => (await stat(canonical)).isDirectory() ? 'ok' : 'missing-dir',
        }
        byPath.set(canonical, workspace)
        byId.set(workspace.id, workspace)
        return workspace
      },
      get: (id: Workspace['id']) => byId.get(id),
      resolveByPath: async (path: string) => byPath.get(resolve(path)),
      list: () => [...byPath.values()],
      delete: async (id: Workspace['id']) => {
        const workspace = byId.get(id)
        if (workspace === undefined) return false
        byId.delete(id)
        byPath.delete(workspace.path)
        return true
      },
    },
  }
}

async function mounted(prepare?: (input: {
  root: string
  financeRoot: string
  workspaces: ReturnType<typeof workspaceRegistry>
}) => Promise<void>): Promise<{
  ctx: Context
  root: string
  financeRoot: string
  uploadRoot: string
  standardRoot: string
  workspaces: ReturnType<typeof workspaceRegistry>
  dispose: () => Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), 'xiaojing-finance-domain-'))
  roots.push(root)
  const financeRoot = join(root, 'Finance工作区')
  const officeRoot = join(root, '办公工作区')
  const uploadRoot = join(root, 'uploads')
  await Promise.all([officeRoot, uploadRoot].map(path => mkdir(path, { recursive: true })))
  const workspaces = workspaceRegistry()
  await prepare?.({ root, financeRoot, workspaces })
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials).await()
  await ctx.plugin(SessionStore).await()
  await ctx.plugin(SessionProjectionRegistry).await()
  ctx.provide('workspaceRegistry', workspaces.service as never)
  const fiber = ctx.plugin(XiaojingFinanceDomain, {
    dshHome: root,
    workspaceRoot: financeRoot,
    ordinaryWorkspaceRoots: [officeRoot],
    uploadRoot,
  })
  await fiber.await()
  return {
    ctx,
    root,
    financeRoot,
    uploadRoot,
    standardRoot: resolveFinanceWorkspaceLayout(financeRoot).standardRoot,
    workspaces,
    dispose: () => ctx.fiber.dispose(),
  }
}

function agent(ctx: Context, id: string, preset = 'finance', cwd?: string): Agent {
  const session = ctx.sessions.create(SessionId(id), {
    meta: { agentPreset: preset, ...cwd === undefined ? {} : { cwd } },
  })
  return agentForSession(ctx, session)
}

function agentForSession(ctx: Context, session: ReturnType<Context['sessions']['create']>): Agent {
  return {
    id: session.id,
    session,
    ctx,
    options: {},
    inbox: {} as Agent['inbox'],
    status: 'idle',
    cancel: () => {},
    whenIdle: () => Promise.resolve(),
    runMaintenance: task => task(new AbortController().signal),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
  }
}

const draft = (name: string, region: string) => ({
  legalName: name,
  shortName: name.slice(0, 2),
  taxpayerType: 'general-vat' as const,
  registeredRegion: region,
  accountingStandard: 'enterprise' as const,
  financePolicyNotes: `${name}专属政策`,
  chartMappings: [],
  externalSystemRefs: [],
})

describe('saved Youcheng binding verification', () => {
  it.each(['partial', 'unknown-state', 'missing-cash', 'disabled-cash', 'missing-currency', 'wrong-ledger', 'missing-target',
    'query-denied', 'cancelled', 'changed-config', 'unbound', 'foreign-client', 'oversized', 'missing-business-account', 'linked-target'])(
    'rejects %s full-settlement preparation without a write', async (mode) => {
      const { ctx, financeRoot, dispose } = await mounted()
      try {
        const created = await createClient(ctx, financeRoot, 0, '核销限制', '上海')
        const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: '35616' }
        const saved = await ctx.xiaojingFinanceDomain.update({ clientId: created.client.id, expectedRevision: created.revision,
          client: { ...draft('核销限制', '上海'), financeSystem: config }, credentialInput: { youchengAppSecret: 'fake-secret' } })
        const finance = agent(ctx, `write-off-limit-${mode}`, 'finance', saved.client.workspacePath)
        if (mode !== 'unbound') {
          await ctx.xiaojingFinanceDomain.stage(finance, { mode: 'client', clientId: saved.client.id })
          await ctx.xiaojingFinanceDomain.promptContext(finance)
        }
        const controller = new AbortController()
        let changed = false
        vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
          if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'fake-token' })
          if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35616', sobName: '演示账套' }] })
          if (mode === 'cancelled') controller.abort()
          if (mode === 'changed-config' && !changed) {
            changed = true
            await ctx.xiaojingFinanceDomain.update({ clientId: saved.client.id, expectedRevision: saved.revision,
              client: { ...draft('核销限制', '上海'), financeSystem: config }, credentialInput: { youchengAppSecret: 'new-secret' } })
          }
          if (url.pathname === '/finance/cashjournal/getAccountList.rjson') return Response.json({ result: 100,
            data: mode === 'missing-cash' ? [] : [{ accountId: 174622, accountName: '库存现金', status: mode === 'disabled-cash' ? 1 : 0,
              ...mode === 'missing-currency' ? {} : { currencyId: '1' } }] })
          expect(url.pathname).toBe('/finance/cashjournal/getCashierList')
          if (mode === 'query-denied') return Response.json({ result: 201 })
          return Response.json({ result: 100, data: { count: mode === 'missing-target' ? 0 : 1, list: mode === 'missing-target' ? [] : [{
            id: 72606, setOfBooksId: mode === 'wrong-ledger' ? 35601 : 35616, date: '2022-01-01', abstractStr: '核销限制测试',
            subjectId: mode === 'missing-business-account' ? undefined : 174626, accountStatus: 0,
            certificateWordAndCode: '', orderCode: '', certificateId: mode === 'linked-target' ? 244058 : null,
            subjectCode: '', subjectName: '往来账户', auxiliaryItemIds: '191501', auxiliaryItemName: '测试客户',
            currencyCode: 'RMB', baseCurrencyCode: 'RMB', money: 0.19, balance: 0.19, thisMoney: 0,
            badMoney: 0, hedgeMoney: 0, returnMoney: 0, initialBalance: false,
            ...mode === 'unknown-state' ? {} : { isFinish: false }, categoryName: '其他收支', remark: '',
          }] } })
        }))
        const limits = { maxRows: 100, maxBytes: mode === 'oversized' ? 100 : 30000 }
        const request = { action: 'prepare', input: { direction: 'receivable', openItemId: '72606', cashAccountId: '174622',
          amount: mode === 'partial' ? '0.18' : '0.19', currencyCode: 'RMB', date: '2022-01-09', keeperName: '测试记账人',
          sourceQuery: { direction: 'receivable', periodStart: '2022-01', periodEnd: '2022-01', page: 1, pageSize: 100 } } }
        const result = ctx.xiaojingFinanceDomain.prepareOpenItemWriteOff(finance, request, controller.signal, limits)
        if (mode === 'foreign-client') {
          const preview = await result
          if (!('id' in preview)) throw new Error('Missing write-off record')
          const other = await createClient(ctx, financeRoot, saved.revision, '另一核销企业', '上海')
          await ctx.xiaojingFinanceDomain.update({ clientId: other.client.id, expectedRevision: other.revision,
            client: { ...draft('另一核销企业', '上海'), financeSystem: config }, credentialInput: { youchengAppSecret: 'fake-secret' } })
          const foreign = agent(ctx, 'foreign-write-off', 'finance', other.client.workspacePath)
          await ctx.xiaojingFinanceDomain.stage(foreign, { mode: 'client', clientId: other.client.id })
          await ctx.xiaojingFinanceDomain.promptContext(foreign)
          await expect(ctx.xiaojingFinanceDomain.prepareOpenItemWriteOff(foreign, { action: 'inspect', id: preview.id },
            controller.signal, limits)).rejects.toThrow()
        } else await expect(result).rejects.toThrow()
      } finally { await dispose() }
    })

  it.each(['receivable', 'payable'] as const)('executes %s write-off through exact approval and preserves uncertain outcomes', async (direction) => {
    const { ctx, root, financeRoot, dispose } = await mounted()
    try {
      const created = await createClient(ctx, financeRoot, 0, '核销执行', '上海')
      const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: '35616' }
      const saved = await ctx.xiaojingFinanceDomain.update({ clientId: created.client.id, expectedRevision: created.revision,
        client: { ...draft('核销执行', '上海'), financeSystem: config }, credentialInput: { youchengAppSecret: 'fake-secret' } })
      const finance = agent(ctx, `execute-write-off-${direction}`, 'finance', saved.client.workspacePath)
      await ctx.xiaojingFinanceDomain.stage(finance, { mode: 'client', clientId: saved.client.id })
      await ctx.xiaojingFinanceDomain.promptContext(finance)
      const limits = { maxRows: 100, maxBytes: 30000 }
      const controller = new AbortController()
      const signal = controller.signal
      const raw = { id: 72610, setOfBooksId: 35616, subjectId: direction === 'receivable' ? 174626 : 174624,
        accountStatus: 0, certificateWordAndCode: '', orderCode: '', date: '2022-01-01', abstractStr: '核销执行测试',
        subjectCode: '', subjectName: '往来账户', auxiliaryItemIds: '191501', auxiliaryItemName: '测试客户',
        currencyCode: 'RMB', baseCurrencyCode: 'RMB', money: 0.19, balance: 0.19, thisMoney: 0,
        badMoney: 0, hedgeMoney: 0, returnMoney: 0, initialBalance: false, isFinish: false, categoryName: '其他收支', remark: '' }
      const subject = { subjectCode: '1001', subjectName: '库存现金', enableStatus: 1, hasChild: false, currencyList: [] }
      let mode = 'allowed'
      let writes = 0
      let afterWrite = false
      vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
        if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'fake-token' })
        if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35616', sobName: '演示账套' }] })
        if (url.pathname === '/finance/cashjournal/getAccountList.rjson') return Response.json({ result: 100,
          data: [{ accountId: 174622, accountName: '库存现金', status: 0, currencyId: '120455', subjectCode: '1001' }] })
        if (url.pathname === '/finance/auxiliary/querySubjectInfoList.rjson') return Response.json({ result: 100, data: [subject] })
        if (url.pathname === '/finance/cashjournal/getCashierList') {
          if (afterWrite && mode === 'readback-failed') return Response.json({ result: 201 })
          return Response.json({ result: 100, data: { count: 1, list: [raw] } })
        }
        if (typeof init.body !== 'string') throw new Error('Expected JSON request')
        if (url.pathname === '/finance/cashjournal/getListPage.rjson') return Response.json({ result: 100, count: 1,
          data: (JSON.parse(init.body) as { page: number }).page > 1 ? [] : [{ id: 141111, relationId: 65835,
            channel: 'WRITE_OFF', subjectId: 174622, auxiliaryItemIds: '191501',
            date: '2022-01-10', abstractStr: '核销流水', accountCode: '1001', accountName: '库存现金', currencyCode: 'RMB',
            baseCurrencyCode: 'RMB', borrow: direction === 'receivable' ? 0.19 : 0, loan: direction === 'payable' ? 0.19 : 0,
            balance: 0, baseBalance: 0, categoryName: '其他收支', keeperName: '测试记账人' }] })
        expect(url.pathname).toBe('/finance/cashier/account/management/writeOff.rjson')
        expect(JSON.parse(init.body)).toEqual({ booksName: '演示账套', direction: direction === 'payable', money: 0.19,
          accountManagementId: raw.id, accountId: 174622, date: '2022-01-10', resource: 1, type: 1, keeperName: '测试记账人' })
        writes++
        afterWrite = true
        if (mode === 'api-rejected') return Response.json({ result: 201, msg: '期间不允许' })
        raw.balance = 0; raw.thisMoney = 0.19; raw.isFinish = true
        if (mode === 'response-lost') throw new Error('Response lost after dispatch')
        return Response.json({ result: 100, data: '65835' })
      }))
      const approval = vi.fn(async (request: { toolName: string; reason: string }) => {
        expect(request.toolName).toBe('finance_write_off_open_item')
        for (const value of [direction === 'receivable' ? '应收' : '应付', '测试客户', '0.19', '库存现金']) {
          expect(request.reason).toContain(value)
        }
        expect(request.reason).not.toMatch(new RegExp(`${raw.id}|期间锁定状态未提供|fake-key|fake-secret|fake-token`))
        if (mode === 'denied') return 'denied' as const
        if (mode === 'target-changed') raw.abstractStr = '已被他人修改'
        if (mode === 'subject-changed') subject.subjectName = '改名现金'
        if (mode === 'subject-disabled') subject.enableStatus = 0
        if (mode === 'cancelled') controller.abort()
        return 'allowed-once' as const
      })
      ctx.provide('approval', { requestMandatory: approval } as never)
      for (mode of ['replaced-before-reserve', 'denied', 'target-changed', 'subject-changed', 'subject-disabled', 'api-rejected',
        'response-lost', 'readback-failed', 'allowed', 'cancelled']) {
        raw.id++
        raw.abstractStr = '核销执行测试'; raw.balance = 0.19; raw.thisMoney = 0; raw.isFinish = false
        subject.subjectName = '库存现金'; subject.enableStatus = 1
        afterWrite = false
        const input = { direction, openItemId: String(raw.id), cashAccountId: '174622', amount: '0.19', currencyCode: 'RMB',
          date: '2022-01-10', keeperName: '测试记账人',
          sourceQuery: { direction, periodStart: '2022-01', periodEnd: '2022-01', page: 1, pageSize: 100 } }
        const preview = await ctx.xiaojingFinanceDomain.prepareOpenItemWriteOff(finance, { action: 'prepare', input }, signal, limits)
        if (!('id' in preview) || typeof preview.id !== 'string') throw new Error('Missing write-off preview')
        expect(preview).toMatchObject({ execution: { state: 'requires-confirmation', period: 'unverified' } })
        const id = preview.id as OpenItemWriteOffId
        const run = (version = 1) => ctx.xiaojingFinanceDomain.writeOffOpenItem(finance, { id, version }, signal, limits)
        const approvalsBefore = approval.mock.calls.length
        await expect(run(2)).rejects.toThrow('版本')
        await expect(ctx.xiaojingFinanceDomain.writeOffOpenItem(finance,
          { id, version: 1, approved: true }, signal, limits)).rejects.toThrow()
        expect(approval.mock.calls.length).toBe(approvalsBefore)
        const writesBefore = writes
        const records = new OpenItemWriteOffRecords(join(root, 'finance/open-item-write-offs'),
          `${saved.client.id}/test/35616`, limits.maxBytes, join(root, 'finance/open-item-target-claims'))
        if (mode === 'replaced-before-reserve') {
          const originalReserve = records.reserve.bind(records)
          const intercept = vi.spyOn(OpenItemWriteOffRecords.prototype, 'reserve').mockImplementationOnce(
            async (localId, version, digest, authorize) => {
              const changed = await records.read(localId)
              changed.evidence.input.date = '2022-01-11'
              const owner = createHash('sha256').update(`${saved.client.id}/test/35616`).digest('hex')
              await writeFile(join(root, 'finance/open-item-write-offs', owner, `${localId}.json`), JSON.stringify(changed))
              return originalReserve(localId, version, digest, authorize)
            })
          try {
            await expect(run()).rejects.toThrow('预览已变化')
            expect(writes).toBe(writesBefore)
            expect(approval.mock.calls.length).toBe(approvalsBefore)
          } finally { intercept.mockRestore() }
        } else if (['denied', 'target-changed', 'subject-changed', 'subject-disabled', 'cancelled'].includes(mode)) {
          await expect(run()).rejects.toThrow()
          expect(writes).toBe(writesBefore)
          expect((await records.read(id)).phase).toBe('prepared')
        } else {
          const result = await run()
          const state = mode === 'api-rejected' ? 'rejected' : mode === 'response-lost' ? 'outcome-unknown' : 'accepted'
          expect(result).toMatchObject({ outcome: { state }, execution: { period: 'unverified' } })
          expect(writes).toBe(writesBefore + 1)
          expect((await records.read(id)).phase).toBe(state)
          expect(result).toMatchObject({ readback: { operation: mode === 'allowed' ? 'matched' : 'unverified' } })
          await expect(run()).rejects.toThrow()
          expect(writes).toBe(writesBefore + 1)
          expect(approval.mock.calls.length).toBe(approvalsBefore + 1)
        }
      }
    } finally { await dispose() }
  })

  it.each(['receivable', 'payable'] as const)('persists %s write-off previews and recovers original receipts without sending', async (direction) => {
    const { ctx, root, financeRoot, dispose } = await mounted()
    try {
      const created = await createClient(ctx, financeRoot, 0, '核销预览', '上海')
      const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: '35616' }
      const saved = await ctx.xiaojingFinanceDomain.update({ clientId: created.client.id, expectedRevision: created.revision,
        client: { ...draft('核销预览', '上海'), financeSystem: config }, credentialInput: { youchengAppSecret: 'fake-secret' } })
      const finance = agent(ctx, `write-off-${direction}`, 'finance', saved.client.workspacePath)
      await ctx.xiaojingFinanceDomain.stage(finance, { mode: 'client', clientId: saved.client.id })
      await ctx.xiaojingFinanceDomain.promptContext(finance)
      const limits = { maxRows: 100, maxBytes: 30000 }
      const signal = new AbortController().signal
      let state: 'open' | 'settled' | 'absent' | 'denied' = 'open'
      let businessAccountId: number | undefined = direction === 'receivable' ? 174626 : 174624
      let linkState: 'matched' | 'mismatch' | 'missing' | 'denied' = 'matched'
      const routes: string[] = []
      vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
        routes.push(url.pathname)
        if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'fake-token' })
        if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35616', sobName: '演示账套' }] })
        if (url.pathname === '/finance/cashjournal/getAccountList.rjson') return Response.json({ result: 100,
          data: [{ accountId: 174622, accountName: '库存现金', status: 0, currencyId: '1', direction: 0 }] })
        if (url.pathname === '/finance/cashjournal/getListPage.rjson') {
          if (linkState === 'denied') return Response.json({ result: 201 })
          if (typeof init.body !== 'string') throw new Error('Expected journal JSON request')
          const query = JSON.parse(init.body) as { page: number }
          return Response.json({ result: 100, count: linkState === 'missing' ? 0 : 1,
            data: linkState === 'missing' || query.page > 1 ? [] : [{ id: 141108, relationId: 65833, channel: 'WRITE_OFF',
              subjectId: 174622, auxiliaryItemIds: '191501', date: '2022-01-10', abstractStr: '核销流水',
              accountCode: '1001', accountName: '库存现金', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
              borrow: direction === 'receivable' ? linkState === 'mismatch' ? 0.18 : 0.19 : 0,
              loan: direction === 'payable' ? linkState === 'mismatch' ? 0.18 : 0.19 : 0,
              balance: 0, baseBalance: 0, categoryName: '其他收支', keeperName: '测试记账人' }] })
        }
        expect(url.pathname).toBe('/finance/cashjournal/getCashierList')
        if (state === 'denied') return Response.json({ result: 201 })
        if (typeof init.body !== 'string') throw new Error('Expected JSON request')
        expect((JSON.parse(init.body) as { direction: number }).direction).toBe(direction === 'payable' ? 1 : 0)
        return Response.json({ result: 100, data: { count: state === 'absent' ? 0 : 1, list: state === 'absent' ? [] : [{
          id: 72606, setOfBooksId: 35616, date: '2022-01-01', abstractStr: '核销预览测试', subjectCode: '', subjectName: '往来账户',
          subjectId: businessAccountId, accountStatus: 0, certificateWordAndCode: '', orderCode: '',
          auxiliaryItemIds: '191501', auxiliaryItemName: '测试客户', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
          money: 0.19, balance: state === 'settled' ? 0 : 0.19, thisMoney: state === 'settled' ? 0.19 : 0,
          badMoney: 0, hedgeMoney: 0, returnMoney: 0, initialBalance: false, isFinish: state === 'settled',
          categoryName: '其他收支', remark: '',
        }] } })
      }))
      const input = { direction, openItemId: '72606', cashAccountId: '174622', amount: '0.19', currencyCode: 'RMB',
        date: '2022-01-09', keeperName: '测试记账人',
        sourceQuery: { direction, periodStart: '2022-01', periodEnd: '2022-01', page: 1, pageSize: 100 } }
      const run = (request: object) => ctx.xiaojingFinanceDomain.prepareOpenItemWriteOff(finance, request, signal, limits)
      const preview = await run({ action: 'prepare', input })
      if (!('id' in preview) || typeof preview.id !== 'string') throw new Error('Missing write-off preview')
      const id = preview.id as OpenItemWriteOffId
      expect(preview).toMatchObject({ version: 1, phase: 'prepared', execution: { state: 'unavailable' },
        preview: { direction, amount: '0.19', businessAccountId: direction === 'receivable' ? '174626' : '174624',
          cashAccount: { id: '174622', status: 'enabled' }, target: { id: '72606' } } })
      expect(JSON.stringify(preview)).not.toMatch(/fake-key|fake-secret|fake-token|configurationDigest|ownerDigest/)
      expect(await run({ action: 'revise', id, version: 1, input: { ...input, date: '2022-01-10' } })).toMatchObject({ version: 2 })
      await expect(run({ action: 'revise', id, version: 1, input })).rejects.toThrow('版本')
      await expect(run({ action: 'prepare', input, approved: true })).rejects.toThrow()
      await expect(run({ action: 'execute', id, version: 2 })).rejects.toThrow()
      const records = new OpenItemWriteOffRecords(join(root, 'finance/open-item-write-offs'), `${saved.client.id}/test/35616`, limits.maxBytes,
        join(root, 'finance/open-item-target-claims'))
      const record = await records.read(id)
      await records.reserve(id, 2, record.configurationDigest, async () => {})
      const another = agent(ctx, `write-off-inspect-${direction}`, 'finance', saved.client.workspacePath)
      await ctx.xiaojingFinanceDomain.stage(another, { mode: 'client', clientId: saved.client.id })
      await ctx.xiaojingFinanceDomain.promptContext(another)
      const inspect = () => ctx.xiaojingFinanceDomain.prepareOpenItemWriteOff(another, { action: 'inspect', id }, signal, limits)
      expect(await inspect()).toMatchObject({ phase: 'outcome-unknown', readback: { settlement: 'mismatch', operation: 'unverified' } })
      state = 'settled'
      expect(await inspect()).toMatchObject({ phase: 'outcome-unknown', preview: { date: '2022-01-10', target: { balance: '0.19' } },
        readback: { content: 'matched', settlement: 'matched', operation: 'unverified' } })
      await records.recordOutcome(id, 2, { state: 'accepted', receiptId: '65833' as OpenItemWriteOffReceiptId })
      const original = await records.read(id)
      for (linkState of ['matched', 'mismatch', 'missing', 'denied'] as const) {
        expect(await inspect()).toMatchObject({ phase: 'accepted', outcome: { state: 'accepted', receiptId: '65833' },
          readback: { content: 'matched', settlement: 'matched', operation: linkState === 'matched' ? 'matched' : 'unverified',
            journalLink: linkState === 'matched' ? { state: 'matched', receiptId: '65833', journalId: '141108' }
              : { state: linkState === 'mismatch' ? 'mismatch' : 'unavailable' } } })
        expect(await records.read(id)).toEqual(original)
      }
      linkState = 'matched'
      for (businessAccountId of [999999, undefined]) {
        expect(await inspect()).toMatchObject({ phase: 'accepted', outcome: { state: 'accepted', receiptId: '65833' },
          readback: { content: 'matched', settlement: 'matched', operation: 'unverified',
            businessAccount: businessAccountId === undefined ? 'unavailable' : 'mismatch' } })
        expect(await records.read(id)).toEqual(original)
      }
      businessAccountId = direction === 'receivable' ? 174626 : 174624
      for (state of ['absent', 'denied'] as const) expect(await inspect()).toMatchObject({ phase: 'accepted',
        outcome: { state: 'accepted', receiptId: '65833' }, readback: { settlement: 'unavailable' } })
      state = 'settled'
      const withoutIdentity = structuredClone(original)
      delete withoutIdentity.evidence.businessAccountId
      const ownerDigest = createHash('sha256').update(`${saved.client.id}/test/35616`).digest('hex')
      const recordPath = join(root, 'finance/open-item-write-offs', ownerDigest, `${id}.json`)
      const originalBytes = JSON.stringify(withoutIdentity)
      await writeFile(recordPath, originalBytes)
      expect(await inspect()).toMatchObject({ phase: 'accepted', outcome: { state: 'accepted', receiptId: '65833' },
        readback: { businessAccount: 'unavailable', operation: 'unverified', settlement: 'matched' } })
      expect(await readFile(recordPath, 'utf8')).toBe(originalBytes)
      expect((await records.read(id)).evidence.input.date).toBe('2022-01-10')
      await ctx.xiaojingFinanceDomain.update({ clientId: saved.client.id, expectedRevision: saved.revision,
        client: { ...draft('核销预览', '上海'), financeSystem: config }, credentialInput: { youchengAppSecret: 'changed-secret' } })
      await expect(inspect()).rejects.toThrow('配置已变化')
      expect(routes.every(path => ['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson',
        '/finance/cashjournal/getAccountList.rjson', '/finance/cashjournal/getCashierList', '/finance/cashjournal/getListPage.rjson'].includes(path))).toBe(true)
    } finally { await dispose() }
  })

  it.each(['receivable', 'payable'] as const)('keeps %s deletion previews versioned and read-only across sessions', async (direction) => {
    const { ctx, root, financeRoot, dispose } = await mounted()
    try {
      const created = await createClient(ctx, financeRoot, 0, '往来删除检查', '上海')
      const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: '35616' }
      const saved = await ctx.xiaojingFinanceDomain.update({ clientId: created.client.id, expectedRevision: created.revision,
        client: { ...draft('往来删除检查', '上海'), financeSystem: config }, credentialInput: { youchengAppSecret: 'fake-secret' } })
      const finance = agent(ctx, `open-delete-${direction}`, 'finance', saved.client.workspacePath)
      await ctx.xiaojingFinanceDomain.stage(finance, { mode: 'client', clientId: saved.client.id })
      await ctx.xiaojingFinanceDomain.promptContext(finance)
      const limits = { maxRows: 100, maxBytes: 30000, maxPages: 2, pageSize: 100 }
      const signal = new AbortController().signal
      const raw = { id: 72604, setOfBooksId: 35616, subjectId: 174626, accountStatus: 0,
        date: '2022-01-01', abstractStr: '检查专用', subjectCode: '', subjectName: '往来账户',
        auxiliaryItemIds: '191501', auxiliaryItemName: '测试客户', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
        money: 0.01, balance: 0.01, thisMoney: 0, badMoney: 0, hedgeMoney: 0, returnMoney: 0,
        initialBalance: false, isFinish: false, categoryName: '其他收入', remark: '',
        attachList: [], certificateWordAndCode: '', orderCode: '' }
      let absent = false
      let denied = false
      const routes: string[] = []
      vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
        routes.push(url.pathname)
        if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'fake-token' })
        if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35616', sobName: '演示账套' }] })
        expect(url.pathname).toBe('/finance/cashjournal/getCashierList')
        if (denied) return Response.json({ result: 201 })
        if (typeof init.body !== 'string') throw new Error('Expected JSON request')
        const request = JSON.parse(init.body) as { page: number; direction: number }
        expect(request.direction).toBe(direction === 'payable' ? 1 : 0)
        return Response.json({ result: 100, data: { count: absent ? 0 : 1, list: !absent && request.page === 1 ? [raw] : [] } })
      }))
      const prepare = { action: 'prepare', openItemId: String(raw.id), direction, periodStart: '2022-01', periodEnd: '2022-01' }
      const preview = await ctx.xiaojingFinanceDomain.prepareOpenItemDeletion(finance, prepare, signal, limits)
      if (!('id' in preview) || typeof preview.id !== 'string') throw new Error('Missing deletion preview')
      expect(preview).toMatchObject({ version: 1, phase: 'prepared', execution: { state: 'requires-confirmation' },
        preview: { direction, unverified: expect.arrayContaining(['其他核销金额未提供，不按零处理。']) as unknown } })
      const id = preview.id as OpenItemDeletionId
      const revise = { ...prepare, action: 'revise', id, version: 1 }
      expect(await ctx.xiaojingFinanceDomain.prepareOpenItemDeletion(finance, revise, signal, limits)).toMatchObject({ version: 2 })
      await expect(ctx.xiaojingFinanceDomain.prepareOpenItemDeletion(finance, revise, signal, limits)).rejects.toThrow('版本')
      await expect(ctx.xiaojingFinanceDomain.prepareOpenItemDeletion(finance,
        { ...prepare, approved: true }, signal, limits)).rejects.toThrow()
      await expect(ctx.xiaojingFinanceDomain.prepareOpenItemDeletion(finance, { action: 'execute', id, version: 2 }, signal, limits)).rejects.toThrow()
      const records = new OpenItemDeletionRecords(join(root, 'finance/open-item-deletions'), `${saved.client.id}/test/35616`, limits.maxBytes,
        join(root, 'finance/open-item-target-claims'))
      const record = await records.read(id)
      await records.reserve(id, 2, record.configurationDigest, async () => {})
      const another = agent(ctx, `open-delete-recovery-${direction}`, 'finance', saved.client.workspacePath)
      await ctx.xiaojingFinanceDomain.stage(another, { mode: 'client', clientId: saved.client.id })
      await ctx.xiaojingFinanceDomain.promptContext(another)
      const inspect = { action: 'inspect', id }
      const check = () => ctx.xiaojingFinanceDomain.prepareOpenItemDeletion(another, inspect, signal, limits)
      expect(await check()).toMatchObject({ phase: 'outcome-unknown', readback: { target: 'present' } })
      absent = true
      expect(await check()).toMatchObject({ phase: 'outcome-unknown', readback: { target: 'not-observed',
        content: 'matched', remainingBalances: 'matched', scope: 'selected-direction-periods',
        balances: { original: { state: 'matched' }, base: { state: 'matched' } } } })
      await records.recordOutcome(id, 2, { state: 'accepted' })
      denied = true
      expect(await check()).toMatchObject({ phase: 'accepted', readback: { target: 'unavailable' } })
      expect((await records.read(id)).phase).toBe('accepted')
      await ctx.xiaojingFinanceDomain.update({ clientId: saved.client.id, expectedRevision: saved.revision,
        client: { ...draft('往来删除检查', '上海'), financeSystem: config }, credentialInput: { youchengAppSecret: 'new-secret' } })
      await expect(check()).rejects.toThrow('配置已变化')
      expect(routes.every(path => ['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson',
        '/finance/cashjournal/getCashierList'].includes(path))).toBe(true)
      expect(JSON.stringify(preview)).not.toMatch(/fake-key|fake-secret|fake-token|configurationDigest|ownerDigest/)
    } finally { await dispose() }
  })

  it.each(['blocked', 'missing-target', 'wrong-ledger', 'incomplete', 'query-denied', 'cancelled', 'configuration-changed', 'foreign-client'])(
    'does not authorize deletion through a %s preview', async (mode) => {
      const { ctx, financeRoot, dispose } = await mounted()
      try {
        const created = await createClient(ctx, financeRoot, 0, '往来检查限制', '上海')
        const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: '35616' }
        const saved = await ctx.xiaojingFinanceDomain.update({ clientId: created.client.id, expectedRevision: created.revision,
          client: { ...draft('往来检查限制', '上海'), financeSystem: config }, credentialInput: { youchengAppSecret: 'fake-secret' } })
        const finance = agent(ctx, `open-delete-limit-${mode}`, 'finance', saved.client.workspacePath)
        await ctx.xiaojingFinanceDomain.stage(finance, { mode: 'client', clientId: saved.client.id })
        await ctx.xiaojingFinanceDomain.promptContext(finance)
        const controller = new AbortController()
        let changed = false
        vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
          if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'fake-token' })
          if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35616', sobName: '演示账套' }] })
          expect(url.pathname).toBe('/finance/cashjournal/getCashierList')
          if (mode === 'query-denied') return Response.json({ result: 201 })
          if (mode === 'cancelled') controller.abort()
          if (mode === 'configuration-changed' && !changed) {
            changed = true
            await ctx.xiaojingFinanceDomain.update({ clientId: saved.client.id, expectedRevision: saved.revision,
              client: { ...draft('往来检查限制', '上海'), financeSystem: config }, credentialInput: { youchengAppSecret: 'new-secret' } })
          }
          if (typeof init.body !== 'string') throw new Error('Expected JSON request')
          const request = JSON.parse(init.body) as { page: number }
          const raw = { id: 72604, setOfBooksId: mode === 'wrong-ledger' ? 35601 : 35616, subjectId: 174626,
            accountStatus: 0, date: '2022-01-01', abstractStr: '检查测试', money: 0.01, balance: 0.01,
            subjectCode: '', subjectName: '往来账户', auxiliaryItemIds: '191501', auxiliaryItemName: '测试客户',
            currencyCode: 'RMB', baseCurrencyCode: 'RMB', categoryName: '其他收入', remark: '',
            thisMoney: 0, badMoney: 0, hedgeMoney: 0, returnMoney: 0, initialBalance: false, isFinish: false,
            attachList: [], certificateWordAndCode: mode === 'blocked' ? '记-1' : '', orderCode: '' }
          return Response.json({ result: 100, data: { count: mode === 'incomplete' ? 2 : mode === 'missing-target' ? 0 : 1,
            list: request.page === 1 && mode !== 'missing-target' ? [raw] : [] } })
        }))
        const limits = { maxRows: 100, maxBytes: 30000, maxPages: 2, pageSize: 100 }
        const result = ctx.xiaojingFinanceDomain.prepareOpenItemDeletion(finance, { action: 'prepare', openItemId: '72604',
          direction: 'receivable', periodStart: '2022-01', periodEnd: '2022-01' }, controller.signal, limits)
        if (mode === 'blocked') expect(await result).toMatchObject({ execution: { state: 'unavailable' },
          preview: { blockers: expect.arrayContaining(['往来已关联凭证或订单，不自动联动删除。']) as unknown } })
        else if (mode === 'foreign-client') {
          const preview = await result
          if (!('id' in preview)) throw new Error('Missing preview')
          const other = await createClient(ctx, financeRoot, saved.revision, '另一企业', '上海')
          await ctx.xiaojingFinanceDomain.update({ clientId: other.client.id, expectedRevision: other.revision,
            client: { ...draft('另一企业', '上海'), financeSystem: config }, credentialInput: { youchengAppSecret: 'fake-secret' } })
          const foreign = agent(ctx, 'other-open-delete', 'finance', other.client.workspacePath)
          await ctx.xiaojingFinanceDomain.stage(foreign, { mode: 'client', clientId: other.client.id })
          await ctx.xiaojingFinanceDomain.promptContext(foreign)
          await expect(ctx.xiaojingFinanceDomain.prepareOpenItemDeletion(foreign, { action: 'inspect', id: preview.id },
            controller.signal, limits)).rejects.toThrow()
        } else await expect(result).rejects.toThrow()
      } finally { await dispose() }
    })

  it.each(['receivable', 'payable'] as const)(
    'confirms and sends one exact %s deletion with scoped durable recovery', async (direction) => {
      const { ctx, financeRoot, dispose } = await mounted()
      try {
        const created = await createClient(ctx, financeRoot, 0, '往来删除执行', '上海')
        const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: '35616' }
        const saved = await ctx.xiaojingFinanceDomain.update({ clientId: created.client.id, expectedRevision: created.revision,
          client: { ...draft('往来删除执行', '上海'), financeSystem: config }, credentialInput: { youchengAppSecret: 'fake-secret' } })
        const finance = agent(ctx, `open-delete-execute-${direction}`, 'finance', saved.client.workspacePath)
        await ctx.xiaojingFinanceDomain.stage(finance, { mode: 'client', clientId: saved.client.id })
        await ctx.xiaojingFinanceDomain.promptContext(finance)
        const target = { id: 72604, setOfBooksId: 35616, subjectId: direction === 'receivable' ? 174626 : 174624,
          accountStatus: 0, date: '2022-01-01', abstractStr: '删除执行专用', subjectCode: '', subjectName: '往来账户',
          auxiliaryItemIds: '191501', auxiliaryItemName: '测试往来单位', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
          money: 0.01, balance: 0.01, baseMoney: 0.01, baseBalance: 0.01, thisMoney: 0, badMoney: 0,
          hedgeMoney: 0, returnMoney: 0, otherMoney: 0, initialBalance: false, isFinish: false,
          categoryName: '其他收支', remark: '', attachList: [], certificateWordAndCode: '', orderCode: '' }
        const survivor = { ...target, id: 72610, abstractStr: '保留记录', money: 0.19, balance: 0.19,
          baseMoney: 0.19, baseBalance: 0.19 }
        let rows = [target, survivor]
        let writes = 0
        let approved = false
        vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
          if (url.pathname === '/auth/getAccessToken.rjson') return Response.json({ result: 100, data: 'fake-token' })
          if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100,
            data: [{ id: '35616', sobName: '演示账套' }] })
          if (typeof init.body !== 'string') throw new Error('Expected JSON request')
          if (url.pathname === '/finance/cashjournal/getCashierList') {
            const request = JSON.parse(init.body) as { page: number; direction: number }
            expect(request.direction).toBe(direction === 'receivable' ? 0 : 1)
            return Response.json({ result: 100, data: { count: rows.length, list: request.page === 1 ? rows : [] } })
          }
          expect(url.pathname).toBe('/finance/cashier/account/management/delete.rjson')
          expect(approved).toBe(true)
          expect(JSON.parse(init.body)).toEqual({ booksName: '演示账套', managementId: target.id })
          writes++
          rows = [survivor]
          return Response.json({ result: 100 })
        }))
        const approval = vi.fn(async (request: { toolName: string; reason: string }) => {
          expect(request.toolName).toBe('finance_delete_open_item')
          for (const value of [direction === 'receivable' ? '应收' : '应付', '测试往来单位', '0.01',
            '可能连带影响关联对冲、核销或收入记录']) expect(request.reason).toContain(value)
          expect(request.reason).not.toMatch(/确认版本|72604|"version"/)
          approved = true
          return 'allowed-once'
        })
        ctx.provide('approval', { requestMandatory: approval } as never)
        const limits = { maxRows: 100, maxBytes: 50000, maxPages: 2, pageSize: 100 }
        const preview = await ctx.xiaojingFinanceDomain.prepareOpenItemDeletion(finance, { action: 'prepare',
          openItemId: String(target.id), direction, periodStart: '2022-01', periodEnd: '2022-01' },
        new AbortController().signal, limits)
        expect(preview).toMatchObject({ version: 1, execution: { state: 'requires-confirmation' },
          preview: { blockers: [], unverified: expect.arrayContaining([
            '有成网页提示删除可能连带删除对冲、核销或收入记录；公开接口的完整关联影响未核实，本检查不能排除该影响。']) as unknown } })
        if (!('id' in preview)) throw new Error('Missing deletion preview ID')
        const result = await ctx.xiaojingFinanceDomain.deleteOpenItem(finance, { id: preview.id, version: 1 },
          new AbortController().signal, limits)
        expect(result).toMatchObject({ phase: 'accepted', outcome: { state: 'accepted' },
          execution: { state: 'recorded' }, readback: { target: 'not-observed', content: 'matched',
            remainingBalances: 'matched', scope: 'selected-direction-periods' } })
        expect(writes).toBe(1)
        expect(approval).toHaveBeenCalledTimes(1)
        await expect(ctx.xiaojingFinanceDomain.deleteOpenItem(finance, { id: preview.id, version: 1 },
          new AbortController().signal, limits)).rejects.toThrow('不得重发')
        const another = agent(ctx, `open-delete-recovery-${direction}`, 'finance', saved.client.workspacePath)
        await ctx.xiaojingFinanceDomain.stage(another, { mode: 'client', clientId: saved.client.id })
        await ctx.xiaojingFinanceDomain.promptContext(another)
        expect(await ctx.xiaojingFinanceDomain.prepareOpenItemDeletion(another, { action: 'inspect', id: preview.id },
          new AbortController().signal, limits)).toMatchObject({ phase: 'accepted',
          readback: { target: 'not-observed', content: 'matched', remainingBalances: 'matched' } })
        expect(writes).toBe(1)
      } finally { await dispose() }
    })

  it.each(['accepted', 'denied', 'changed', 'stale-version', 'lost', 'rejected', 'readback-denied', 'cancelled',
    'configuration-changed', 'cancelled-after-send', 'missing-approval'])(
    'enforces journal deletion confirmation and scoped durable recovery for %s', async (mode) => {
      const { ctx, financeRoot, dispose } = await mounted()
      try {
        const created = await createClient(ctx, financeRoot, 0, '流水删除测试', '上海')
        const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: '35616' }
        const saved = await ctx.xiaojingFinanceDomain.update({ clientId: created.client.id, expectedRevision: created.revision,
          client: { ...draft('流水删除测试', '上海'), financeSystem: config }, credentialInput: { youchengAppSecret: 'fake-secret' } })
        const finance = agent(ctx, `journal-delete-${mode}`, 'finance', saved.client.workspacePath)
        await ctx.xiaojingFinanceDomain.stage(finance, { mode: 'client', clientId: saved.client.id })
        await ctx.xiaojingFinanceDomain.promptContext(finance)
        const controller = new AbortController()
        const limits = { maxRows: 100, maxBytes: 30000, maxPages: 2, pageSize: 100 }
        let changed = false
        let approved = false
        let deleted = false
        let writes = 0
        const fields = { accountCode: '', accountName: '库存现金', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
          categoryName: '收-其他收入', keeperName: '测试', loan: null, baseLoan: null }
        const detail = () => ({ ...fields, id: 123, date: '2022-01-01', abstractStr: changed ? 'changed' : '删除测试',
          subjectId: 174622, borrow: '0.01', balance: '0.01', baseBorrow: '0.01', baseBalance: '0.01',
          reviewStatus: 0, reviewUser: '', reviewUserId: '', accountStatus: 0, channel: 'ADD',
          certificateWordAndCode: '', cashManagementId: '', auxiliaryItemIds: '', orderCode: '',
          relationOrderCodeList: [], attachList: [], attachIdList: [], canWriteOffAmount: '0.01' })
        vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
          if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
          if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35616', sobName: '演示账套' }] })
          if (url.pathname === '/finance/cashjournal/getAccountList.rjson') {
            return Response.json({ result: 100, data: [{ accountId: 174622 }] })
          }
          if (typeof init.body !== 'string') throw new Error('Expected JSON')
          if (url.pathname === '/finance/cashjournal/getListPage.rjson') {
            if (deleted && mode === 'readback-denied') return Response.json({ result: 201 })
            const request = JSON.parse(init.body) as { page: number }
            const sum = deleted ? '0.00' : '0.01'
            return Response.json({ result: 100, count: deleted ? 0 : 1, data: [
              { ...fields, date: '', abstractStr: '初始余额', borrow: null, baseBorrow: null, balance: '0.00', baseBalance: '0.00' },
              ...deleted || request.page !== 1 ? [] : [detail()],
              { ...fields, date: '', abstractStr: '合计', borrow: sum, baseBorrow: sum, balance: sum, baseBalance: sum },
            ] })
          }
          expect(url.pathname).toBe('/finance/cashjournal/delete.rjson')
          expect(approved).toBe(true)
          expect(JSON.parse(init.body)).toEqual({ id: 123, accountName: '演示账套' })
          writes++
          if (mode === 'rejected') return Response.json({ result: 201 })
          deleted = true
          if (mode === 'lost') throw new Error('response lost')
          if (mode === 'cancelled-after-send') controller.abort()
          return Response.json({ result: 100 })
        }))
        const prepare = { action: 'prepare', journalId: '123', cashAccountId: '174622', month: '2022-01' }
        const preview = await ctx.xiaojingFinanceDomain.prepareJournalDeletion(finance, prepare, controller.signal, limits)
        if (!('id' in preview)) throw new Error('Missing preview ID')
        await expect(ctx.xiaojingFinanceDomain.deleteJournal(finance,
          { id: preview.id, version: 1, approved: true }, controller.signal, limits)).rejects.toThrow()
        const approval = vi.fn(async (request: { toolName: string; reason: string }) => {
          expect(request.toolName).toBe('finance_delete_journal')
          for (const value of ['库存现金', '删除测试', '0.01']) expect(request.reason).toContain(value)
          expect(request.reason).not.toMatch(new RegExp(`${preview.id}|"version"|"id"`))
          approved = true
          if (mode === 'changed') changed = true
          if (mode === 'stale-version') await ctx.xiaojingFinanceDomain.prepareJournalDeletion(finance,
            { ...prepare, action: 'revise', id: preview.id, version: 1 }, controller.signal, limits)
          if (mode === 'configuration-changed') await ctx.xiaojingFinanceDomain.update({ clientId: saved.client.id,
            expectedRevision: saved.revision, client: { ...draft('流水删除测试', '上海'), financeSystem: config },
            credentialInput: { youchengAppSecret: 'changed-secret' } })
          if (mode === 'cancelled') controller.abort()
          return mode === 'denied' ? 'denied' : 'allowed-once'
        })
        if (mode !== 'missing-approval') ctx.provide('approval', { requestMandatory: approval } as never)
        const submitted = ctx.xiaojingFinanceDomain.deleteJournal(finance, { id: preview.id, version: 1 }, controller.signal, limits)
        if (['denied', 'changed', 'stale-version', 'cancelled', 'configuration-changed', 'missing-approval'].includes(mode)) {
          await expect(submitted).rejects.toThrow()
          expect(writes).toBe(0)
        } else {
          const result = await submitted
          const phase = mode === 'lost' ? 'outcome-unknown' : mode === 'rejected' ? 'rejected' : 'accepted'
          expect(result).toMatchObject({ phase, readback: mode === 'rejected' ? { state: 'not-checked' }
            : { target: ['readback-denied', 'cancelled-after-send'].includes(mode) ? 'unavailable' : 'not-observed',
              scope: 'selected-month' } })
          if (['accepted', 'lost'].includes(mode)) expect(result).toMatchObject({ readback: { content: 'matched', balances: 'matched' } })
          expect(writes).toBe(1)
          await expect(ctx.xiaojingFinanceDomain.deleteJournal(finance, { id: preview.id, version: 1 },
            new AbortController().signal, limits)).rejects.toThrow()
          const another = agent(ctx, `journal-delete-recovery-${mode}`, 'finance', saved.client.workspacePath)
          await ctx.xiaojingFinanceDomain.stage(another, { mode: 'client', clientId: saved.client.id })
          await ctx.xiaojingFinanceDomain.promptContext(another)
          expect(await ctx.xiaojingFinanceDomain.prepareJournalDeletion(another, { action: 'inspect', id: preview.id },
            new AbortController().signal, limits)).toMatchObject({ phase })
          expect(writes).toBe(1)
        }
        expect(approval).toHaveBeenCalledTimes(mode === 'missing-approval' ? 0 : 1)
      } finally { await dispose() }
    })

  it.each(['accepted', 'denied', 'changed', 'stale-version', 'lost', 'rejected', 'readback-denied', 'cancelled'])(
    'enforces voucher deletion confirmation and durable recovery for %s', async (mode) => {
      const { ctx, financeRoot, dispose } = await mounted()
      try {
        const created = await createClient(ctx, financeRoot, 0, '删除测试', '上海')
        const config = { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: '35616' }
        const saved = await ctx.xiaojingFinanceDomain.update({ clientId: created.client.id, expectedRevision: created.revision,
          client: { ...draft('删除测试', '上海'), financeSystem: config }, credentialInput: { youchengAppSecret: 'fake-secret' } })
        const finance = agent(ctx, `delete-${mode}`, 'finance', saved.client.workspacePath)
        await ctx.xiaojingFinanceDomain.stage(finance, { mode: 'client', clientId: saved.client.id })
        await ctx.xiaojingFinanceDomain.promptContext(finance)
        const account = { id: '35616', name: '演示账套' }
        const limits = { maxEntries: 100, maxBytes: 20000, maxPages: 2 }
        const input = { date: '2022-01-01', certificateCode: 40, documentMaker: '测试', sourcePaths: [], entries: [
          { summary: '删除专用', subjectCode: '1001', side: 'debit', amount: '0.01', auxiliary: [] },
          { summary: '删除专用', subjectCode: '100201', side: 'credit', amount: '0.01', auxiliary: [] },
        ] }
        let modified = '2026-09-10'
        let approved = false
        let writes = 0
        let deleted = false
        const detail = () => ({ accountId: '35616', certificateId: '123', certificateWord: '记', certificateCode: 40,
          certificateDate: '2022-01-01', periods: '2022-01', auditingStatus: false, settleStatus: false, documentMaker: '测试',
          modified, channel: 'EXTERNAL_ACCESS', sysCreate: false, relationCode: '', adjustPeriodsStatus: 0,
          attachmentStatus: false, attachmentList: [], corpBalanceSheetCertificateList: [], subjectCertificateWrites: [],
          certificateLists: input.entries.map(row => ({ abstractName: row.summary, subjectCode: row.subjectCode,
            subjectName: '测试科目', direction: row.side === 'debit' ? 0 : 1,
            borrorMoneyStr: row.side === 'debit' ? row.amount : '0.00', loanMoneyStr: row.side === 'credit' ? row.amount : '0.00',
            auxiliaryList: [], currencyCode: '' })),
        })
        vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
          if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
          if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: account.id, sobName: account.name }] })
          if (url.pathname === '/finance/certificate/info.rjson') return Response.json({ result: 100, data: detail() })
          if (url.pathname === '/finance/certificate/list.rjson') {
            if (mode === 'readback-denied') return Response.json({ result: 201, message: 'denied' })
            return Response.json({ result: 100, data: { success: true, count: deleted ? 0 : 1,
              list: deleted ? [] : [{ ...detail(), entryList: detail().certificateLists }] } })
          }
          expect(url.pathname).toBe('/finance/certificate/delCertificate.rjson')
          expect(approved).toBe(true)
          if (typeof init.body !== 'string') throw new Error('expected JSON body')
          expect(JSON.parse(init.body)).toEqual({ accountName: account.name, cerInfoList: [{ cerId: '123' }] })
          writes++
          if (mode === 'rejected') return Response.json({ result: 201 })
          deleted = true
          if (mode === 'lost') throw new Error('response lost')
          return Response.json({ result: 100, data: {} })
        }))
        const controller = new AbortController()
        const prepare = { action: 'prepare', voucherId: '123' }
        const preview = await ctx.xiaojingFinanceDomain.prepareVoucherDeletion(finance, prepare, controller.signal, limits)
        if (!('id' in preview)) throw new Error('Missing deletion ID')
        const approval = vi.fn(async (request: { toolName: string; reason: string }) => {
          expect(request.toolName).toBe('finance_delete_voucher')
          for (const value of ['记-40', '2022-01-01', '2 行']) expect(request.reason).toContain(value)
          expect(request.reason).not.toMatch(new RegExp(`${preview.id}|"version"|"certificateId"`))
          approved = true
          if (mode === 'changed') modified = '2026-09-11'
          if (mode === 'stale-version') await ctx.xiaojingFinanceDomain.prepareVoucherDeletion(finance,
            { ...prepare, action: 'revise', id: preview.id, version: 1 }, controller.signal, limits)
          if (mode === 'cancelled') controller.abort()
          return mode === 'denied' ? 'denied' : 'allowed-once'
        })
        ctx.provide('approval', { requestMandatory: approval } as never)
        const submitted = ctx.xiaojingFinanceDomain.deleteVoucher(finance, { id: preview.id, version: 1 }, controller.signal, limits)
        if (['denied', 'changed', 'stale-version', 'cancelled'].includes(mode)) {
          await expect(submitted).rejects.toThrow()
          expect(writes).toBe(0)
        } else {
          const result = await submitted
          const phase = mode === 'lost' ? 'outcome-unknown' : mode === 'rejected' ? 'rejected' : 'accepted'
          expect(result).toMatchObject({ phase,
            readback: { state: mode === 'readback-denied' ? 'unavailable' : mode === 'rejected' ? 'not-checked' : 'absent' } })
          expect(writes).toBe(1)
          await expect(ctx.xiaojingFinanceDomain.deleteVoucher(finance, { id: preview.id, version: 1 }, controller.signal, limits))
            .rejects.toThrow()
          const another = agent(ctx, `delete-recovery-${mode}`, 'finance', saved.client.workspacePath)
          await ctx.xiaojingFinanceDomain.stage(another, { mode: 'client', clientId: saved.client.id })
          await ctx.xiaojingFinanceDomain.promptContext(another)
          expect(await ctx.xiaojingFinanceDomain.prepareVoucherDeletion(another, { action: 'inspect', id: preview.id },
            controller.signal, limits)).toMatchObject({ phase: mode === 'lost' ? 'outcome-unknown' : mode === 'rejected' ? 'rejected' : 'accepted' })
          expect(writes).toBe(1)
        }
        expect(approval).toHaveBeenCalledTimes(1)
      } finally { await dispose() }
    })

  it('discovers unsaved credentials without persisting them and reuses only this customer’s stored secret', async () => {
    const { ctx, financeRoot, root, dispose } = await mounted()
    try {
      const created = await createClient(ctx, financeRoot, 0, '账套选择', '上海市')
      const before = await readFile(join(root, 'finance', 'clients-v1.json'), 'utf8')
      const request = { clientId: created.client.id, expectedRevision: created.revision,
        environment: 'test' as const, appKey: 'fake-key', youchengAppSecret: 'draft-secret' }
      const fetcher = vi.fn().mockImplementation((url: URL) => Promise.resolve(Response.json({ result: 100,
        data: url.pathname.includes('/auth/') ? 'fake-token' : [{ id: '35581', sobName: '数豆' }],
      })))
      vi.stubGlobal('fetch', fetcher)
      expect(await ctx.xiaojingFinanceDomain.listYouchengAccounts(request)).toEqual({
        state: 'ready', accounts: [{ id: '35581', name: '数豆' }],
      })
      expect(await readFile(join(root, 'finance', 'clients-v1.json'), 'utf8')).toBe(before)
      expect((await ctx.xiaojingFinanceDomain.read(created.client.id)).credentialStatus.youchengAppSecretConfigured).toBe(false)
      expect((await ctx.xiaojingFinanceDomain.workspaces()).clients[0]?.connection).toBeUndefined()
      await expect(ctx.xiaojingFinanceDomain.listYouchengAccounts({ ...request, expectedRevision: 0 })).rejects.toThrow('已变更')
      expect(fetcher).toHaveBeenCalledTimes(2)

      const saved = await ctx.xiaojingFinanceDomain.update({ clientId: created.client.id, expectedRevision: created.revision,
        client: { ...draft('账套选择', '上海市'), financeSystem: {
          system: 'youcheng', environment: 'test', appKey: 'fake-key', accountCode: '35581',
        } }, credentialInput: { youchengAppSecret: 'saved-secret' },
      })
      await ctx.xiaojingFinanceDomain.checkConnection(created.client.id)
      const status = (await ctx.xiaojingFinanceDomain.workspaces()).clients[0]?.connection
      await ctx.xiaojingFinanceDomain.listYouchengAccounts({ clientId: created.client.id, expectedRevision: saved.revision,
        environment: 'test', appKey: 'fake-key' })
      expect(fetcher.mock.calls[4]?.[1]).toMatchObject({ body: JSON.stringify({ appKey: 'fake-key', appSecret: 'saved-secret' }) })
      expect((await ctx.xiaojingFinanceDomain.workspaces()).clients[0]?.connection).toEqual(status)

      const other = await createClient(ctx, financeRoot, saved.revision, '另一客户', '苏州')
      expect(await ctx.xiaojingFinanceDomain.listYouchengAccounts({ clientId: other.client.id, expectedRevision: other.revision,
        environment: 'test', appKey: 'fake-key' })).toEqual({ state: 'failed', failure: 'credentials-missing' })
      expect(fetcher).toHaveBeenCalledTimes(6)
    } finally { await dispose() }
  })

  it('rejects discovery results when the customer changes during the lookup', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    try {
      const created = await createClient(ctx, financeRoot, 0, '并发读取', '上海市')
      let release!: (response: Response) => void
      const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ result: 100, data: 'fake-token' }))
        .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve }))
      vi.stubGlobal('fetch', fetcher)
      const pending = ctx.xiaojingFinanceDomain.listYouchengAccounts({ clientId: created.client.id,
        expectedRevision: created.revision, environment: 'test', appKey: 'fake-key', youchengAppSecret: 'draft-secret' })
      await vi.waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(2) })
      await ctx.xiaojingFinanceDomain.update({ clientId: created.client.id, expectedRevision: created.revision,
        client: draft('已修改', '上海市') })
      release(Response.json({ result: 100, data: [] }))
      await expect(pending).rejects.toThrow('已变更')
    } finally { await dispose() }
  })

  it('deduplicates checks, exposes only the selected name, and invalidates a check overtaken by an edit', async () => {
    const { ctx, financeRoot, root, dispose } = await mounted()
    try {
      const created = await createClient(ctx, financeRoot, 0, '连接测试', '上海市')
      const system = {
        system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key',
        accountCode: '35581', accountName: '数豆',
      }
      const saved = await ctx.xiaojingFinanceDomain.update({
        clientId: created.client.id, expectedRevision: 1,
        client: { ...draft('连接测试', '上海市'), financeSystem: system }, credentialInput: { youchengAppSecret: 'fake-secret' },
      })
      const before = await readFile(join(root, 'finance', 'clients-v1.json'), 'utf8')
      expect((await ctx.xiaojingFinanceDomain.workspaces()).clients[0]?.connection)
        .toEqual({ state: 'unverified', accountId: '35581', accountName: '数豆' })
      let release!: (response: Response) => void
      const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ result: 100, data: 'fake-token' }))
        .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve }))
      vi.stubGlobal('fetch', fetcher)
      const first = ctx.xiaojingFinanceDomain.checkConnection(created.client.id)
      const second = ctx.xiaojingFinanceDomain.checkConnection(created.client.id)
      await vi.waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(2) })
      release(Response.json({ result: 100, data: [{ id: 'other', sobName: '其他公司' }, { id: '35581', sobName: '数豆' }] }))
      expect(await first).toMatchObject({ state: 'connected', accountName: '数豆' })
      expect(await second).toEqual(await first)
      const workspaces = await ctx.xiaojingFinanceDomain.workspaces()
      expect(workspaces.clients[0]?.connection?.state).toBe('connected')
      expect(JSON.stringify(workspaces)).not.toMatch(/fake-key|fake-secret|fake-token|其他公司/)
      expect(await readFile(join(root, 'finance', 'clients-v1.json'), 'utf8')).toBe(before)
      const detail = await ctx.xiaojingFinanceDomain.read(created.client.id)
      expect(detail.youchengApiUrls).toEqual({ test: 'https://cwdata.yiqiyun.com', production: 'https://cwdata.yiqiyun.com' })

      fetcher.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve }))
      const stale = ctx.xiaojingFinanceDomain.checkConnection(created.client.id)
      await vi.waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(3) })
      await ctx.xiaojingFinanceDomain.update({
        clientId: created.client.id, expectedRevision: saved.revision,
        client: {
          ...draft('连接测试', '上海市'),
          financeSystem: { ...system, accountCode: 'new-ledger', accountName: '新账套' },
        },
      })
      release(Response.json({ result: 100, data: [{ id: '35581', sobName: '数豆' }] }))
      expect((await stale).state).toBe('unverified')
      expect((await ctx.xiaojingFinanceDomain.workspaces()).clients[0]?.connection)
        .toEqual({ state: 'unverified', accountId: 'new-ledger', accountName: '新账套' })
    } finally { await dispose() }
  })
})

async function createClient(
  ctx: Context,
  financeRoot: string,
  expectedRevision: number,
  name: string,
  region: string,
) {
  const workspacePath = join(financeRoot, `客户-${name}`)
  await mkdir(workspacePath, { recursive: true })
  return ctx.xiaojingFinanceDomain.create({
    expectedRevision,
    client: draft(name, region),
    workspacePath,
  })
}

describe('XiaojingFinanceDomain', () => {
  describe.each(['subject', 'auxiliary-item'] as const)('%s creation Host', (kind) => {
    it.each(['accepted', 'denied', 'changed', 'reference-changed', 'configuration-changed', 'lost', 'readback-failed', 'rejected'] as const)
    ('requires exact approval and retains %s outcomes', async (mode) => {
      const { ctx, financeRoot, standardRoot, dispose } = await mounted()
      try {
        const created = await createClient(ctx, financeRoot, 0, '基础资料测试', '上海')
        const client = { ...draft('基础资料测试', '上海'), financeSystem: { system: 'youcheng' as const, environment: 'test' as const,
          appKey: 'fake-key', accountCode: '35616' } }
        const saved = await ctx.xiaojingFinanceDomain.update({ clientId: created.client.id, expectedRevision: created.revision,
          client, credentialInput: { youchengAppSecret: 'fake-secret' } })
        const finance = agent(ctx, `master-${kind}-${mode}`, 'finance', saved.client.workspacePath)
        await ctx.xiaojingFinanceDomain.stage(finance, { mode: 'client', clientId: saved.client.id })
        await ctx.xiaojingFinanceDomain.promptContext(finance)
        const proposal = kind === 'subject' ? { kind, input: { subjectCode: '100297', subjectName: '新测试科目', parentCode: '1002',
          subjectCategory: '1', subjectType: '流动资产', direction: 'debit', status: 'enabled', documentMaker: '施', numberUnit: null } }
          : { kind, input: { categoryCode: '02', itemCode: 'F3A02', itemName: '测试供应商', status: 'enabled', documentMaker: '施' } }
        let writes = 0
        let approved = false
        let referenceChanged = false
        const fetcher = vi.fn(async (url: URL) => {
          if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
          if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35616', sobName: '演示账套' }] })
          if (url.pathname.endsWith('/add.rjson')) {
            expect(url.pathname).toBe(kind === 'subject' ? '/finance/subject/add.rjson' : '/finance/auxiliary/add.rjson')
            expect(approved).toBe(true)
            writes += 1
            if (mode === 'lost') throw new Error('response lost')
            return Response.json({ result: mode === 'rejected' ? 201 : 100, data: '' })
          }
          if (writes > 0 && mode === 'readback-failed') return Response.json({ result: 201, message: 'private vendor message' })
          if (url.pathname.includes('queryAuxiliaryCategoryList')) return Response.json({ result: 100, data: [{ id: '473815',
            categoryCode: '02', categoryName: referenceChanged ? '已变更供应商类别' : '供应商' }] })
          const exists = writes > 0 && mode !== 'rejected'
          if (url.pathname.includes('queryAuxiliaryItemList')) return Response.json({ result: 100, data: exists
            ? [{ id: '191568', categoryId: '473815', itemCode: 'F3A02', itemName: '测试供应商' }] : [] })
          expect(url.pathname).toContain('querySubjectInfoList')
          const fields = { subjectType: '流动资产', numberUnit: '', enableStatus: 1, balanceDirection: 0, auxiliaryList: [], currencyList: [] }
          return Response.json({ result: 100, data: [{ ...fields, subjectCode: '1002', subjectName: '银行存款', hasChild: true,
            enableStatus: referenceChanged ? 0 : 1 },
          ...exists ? [{ ...fields, subjectCode: '100297', subjectName: '新测试科目', parentSubjectCode: '1002', hasChild: false }] : []] })
        })
        vi.stubGlobal('fetch', fetcher)
        const signal = new AbortController().signal
        const first = await ctx.xiaojingFinanceDomain.prepareMasterData(finance, { action: 'prepare', proposal }, signal, 10000)
        if (!('id' in first)) throw new Error('Missing local preparation ID')
        expect(first).toMatchObject({ version: 1, phase: 'prepared', proposal })
        expect(JSON.stringify(first)).not.toMatch(/fake-secret|fake-token|fake-key|configurationDigest/)
        expect(writes).toBe(0)
        const approval = vi.fn(async (request: { toolName: string; reason: string }) => {
          expect(request.toolName).toBe('finance_create_master_data')
          expect(request.reason).toContain('演示账套')
          expect(request.reason).toContain(kind === 'subject' ? '新测试科目' : '测试供应商')
          approved = true
          if (mode === 'changed') await ctx.xiaojingFinanceDomain.prepareMasterData(finance,
            { action: 'revise', id: first.id, version: 1, proposal: { ...proposal, input: { ...proposal.input, documentMaker: '另一位提交人' } } }, signal, 10000)
          if (mode === 'reference-changed') referenceChanged = true
          if (mode === 'configuration-changed') await ctx.xiaojingFinanceDomain.update({ clientId: saved.client.id,
            expectedRevision: saved.revision, client, credentialInput: { youchengAppSecret: 'changed-secret' } })
          return mode === 'denied' ? 'denied' : 'allowed-once'
        })
        ctx.provide('approval', { requestMandatory: approval } as never)
        const submitted = ctx.xiaojingFinanceDomain.createMasterData(finance, { id: first.id, version: 1 }, signal, 10000)
        if (mode === 'denied' || mode === 'changed' || mode === 'reference-changed' || mode === 'configuration-changed') {
          await expect(submitted).rejects.toThrow()
          expect(writes).toBe(0)
        } else {
          const phase = mode === 'lost' ? 'outcome-unknown' : mode === 'rejected' ? 'rejected' : 'accepted'
          const result = await submitted
          expect(result).toMatchObject({ phase, complete: kind === 'subject' && mode === 'accepted' })
          expect(JSON.stringify(result)).not.toMatch(/fake-secret|fake-token|fake-key|private vendor message/)
          expect(writes).toBe(1)
          await expect(ctx.xiaojingFinanceDomain.createMasterData(finance, { id: first.id, version: 1 }, signal, 10000)).rejects.toThrow('发送记录')
          const inspected = await ctx.xiaojingFinanceDomain.prepareMasterData(finance, { action: 'inspect', id: first.id }, signal, 10000)
          expect(inspected).toMatchObject({ phase, complete: kind === 'subject' && mode === 'accepted' })
          if (mode === 'lost') expect(inspected).toMatchObject({ outcome: { state: 'outcome-unknown' }, readback: { content: 'matched' } })
          expect(writes).toBe(1)
        }
        await expect(ctx.xiaojingFinanceDomain.prepareMasterData(agent(ctx, 'master-standard', 'standard', standardRoot),
          { action: 'inspect', id: first.id }, signal, 10000)).rejects.toThrow()
        expect(approval).toHaveBeenCalledTimes(1)
      } finally { await dispose() }
    })
  })

  it.each(['accepted', 'denied', 'changed', 'lost', 'currency-changed', 'currency-missing', 'type-changed',
    'direction-changed', 'currency-after-reservation'] as const)('keeps journal approval and durable sending separate with %s results', async (mode) => {
    const { ctx, financeRoot, standardRoot, dispose } = await mounted()
    try {
      const created = await createClient(ctx, financeRoot, 0, '日记账测试', '上海')
      const saved = await ctx.xiaojingFinanceDomain.update({ clientId: created.client.id, expectedRevision: created.revision,
        client: { ...draft('日记账测试', '上海'), financeSystem: { system: 'youcheng', environment: 'test',
          appKey: 'fake-key', accountCode: '35616' } }, credentialInput: { youchengAppSecret: 'fake-secret' } })
      const finance = agent(ctx, `journal-${mode}`, 'finance', saved.client.workspacePath)
      await ctx.xiaojingFinanceDomain.stage(finance, { mode: 'client', clientId: saved.client.id })
      await ctx.xiaojingFinanceDomain.promptContext(finance)
      const input = { cashAccountId: '174622', date: '2022-01-01', direction: 'income', amount: '0.11',
        summary: 'F3A测试', keeperName: '小兢测试', categoryId: '578250' }
      let writes = 0
      let requestedApproval = false
      let currencyId: string | undefined = '120455'
      let accountType = 1
      let accountDirection = 0
      let accountReadsAfterApproval = 0
      vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
        if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
        if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35616', sobName: '演示账套' }] })
        if (url.pathname.includes('getAccountList')) {
          if (requestedApproval && ++accountReadsAfterApproval === 3 && mode === 'currency-after-reservation') currencyId = '120456'
          return Response.json({ result: 100, data: [
            { accountId: 174622, accountName: '库存现金', subjectCode: '1001', status: 0,
              currencyId, type: accountType, direction: accountDirection },
          ] })
        }
        if (url.pathname.includes('getCategoryList')) return Response.json({ result: 100,
          data: [{ id: 578250, code: '06', name: '其他收入', type: 0 }] })
        if (url.pathname.includes('getListPage')) {
          if (typeof init.body !== 'string') throw new Error('Expected journal query JSON')
          expect(JSON.parse(init.body)).toMatchObject({ dateStart: input.date, dateEnd: input.date })
          return Response.json({ result: 100, data: writes === 0 ? [] : [{
            id: 141052 + writes, date: input.date, abstractStr: input.summary, keeperName: input.keeperName,
            subjectId: 174622, accountCode: '', accountName: '', subjectName: '库存现金', currencyCode: 'RMB', baseCurrencyCode: 'RMB',
            borrow: 0.11, categoryId: 578250, categoryName: '收-其他收入', preId: writes > 1 ? 141051 + writes : 0,
            reviewStatus: 0, reviewUser: '', reviewUserId: '',
            certificateWordAndCode: '', cashManagementId: '', auxiliaryItemIds: '', orderCode: '', relationOrderCodeList: [], attachList: [],
          }] })
        }
        expect(url.pathname).toBe('/finance/cashjournal/add.rjson')
        expect(requestedApproval).toBe(true)
        if (typeof init.body !== 'string') throw new Error('Expected journal JSON')
        expect(JSON.parse(init.body)).toMatchObject({ subjectId: 174622, borrow: 0.11, loan: null, categoryName: '其他收入' })
        writes += 1
        if (mode === 'lost') throw new Error('response lost')
        return Response.json({ result: 100, data: String(141052 + writes) })
      }))
      const signal = new AbortController().signal
      const first = await ctx.xiaojingFinanceDomain.prepareJournal(finance, { action: 'prepare', input }, signal, 10000)
      if (!('id' in first)) throw new Error('Missing journal preview ID')
      expect(first).toMatchObject({ version: 1, phase: 'prepared', references: { categoryName: '其他收入' }, position: { previousId: '0' } })
      expect(JSON.stringify(first)).not.toMatch(/fake-secret|fake-token|fake-key|configurationDigest/)
      expect(writes).toBe(0)
      const approval = vi.fn(async (request: { toolName: string; reason: string }) => {
        expect(request.toolName).toBe('finance_create_journal')
        expect(request.reason).toContain('0.11')
        expect(request.reason).toContain('演示账套')
        requestedApproval = true
        if (mode === 'currency-changed') currencyId = '120456'
        if (mode === 'currency-missing') currencyId = undefined
        if (mode === 'type-changed') accountType = 2
        if (mode === 'direction-changed') accountDirection = 1
        if (mode === 'changed') await ctx.xiaojingFinanceDomain.prepareJournal(finance,
          { action: 'revise', id: first.id, version: 1, input: { ...input, amount: '0.22' } }, signal, 10000)
        return mode === 'denied' ? 'denied' : 'allowed-once'
      })
      if (mode === 'accepted') {
        await ctx.plugin(ApprovalService).await()
        finance.session.append('turn/start', { turn: 1 })
        ctx.on('approval/request', async (request) => {
          await approval({ toolName: request.toolName, reason: request.reason ?? '' })
          return 'allowed-session'
        })
      } else ctx.provide('approval', { requestMandatory: approval } as never)
      const submitted = ctx.xiaojingFinanceDomain.createJournal(finance, { id: first.id, version: 1 }, signal, 10000)
      if (mode === 'denied' || mode === 'changed'
        || ['currency-changed', 'currency-missing', 'type-changed', 'direction-changed'].includes(mode)) {
        await expect(submitted).rejects.toThrow()
        expect(writes).toBe(0)
        expect(await ctx.xiaojingFinanceDomain.prepareJournal(finance, { action: 'inspect', id: first.id }, signal, 10000))
          .toMatchObject({ phase: 'prepared', version: mode === 'changed' ? 2 : 1 })
      } else if (mode === 'currency-after-reservation') {
        expect(await submitted).toMatchObject({ phase: 'not-sent', outcome: { state: 'not-sent', reason: 'preflight-failed' }, complete: false })
        expect(writes).toBe(0)
        expect(await ctx.xiaojingFinanceDomain.prepareJournal(finance, { action: 'inspect', id: first.id }, signal, 10000))
          .toMatchObject({ phase: 'not-sent', complete: false })
        await expect(ctx.xiaojingFinanceDomain.createJournal(finance, { id: first.id, version: 1 }, signal, 10000)).rejects.toThrow('发送记录')
      } else {
        expect(await submitted).toMatchObject({ phase: mode === 'accepted' ? 'accepted' : 'outcome-unknown', complete: mode === 'accepted' })
        expect(writes).toBe(1)
        await expect(ctx.xiaojingFinanceDomain.createJournal(finance, { id: first.id, version: 1 }, signal, 10000)).rejects.toThrow('发送记录')
        expect(await ctx.xiaojingFinanceDomain.prepareJournal(finance, { action: 'inspect', id: first.id }, signal, 10000))
          .toMatchObject({ complete: mode === 'accepted' })
        expect(writes).toBe(1)
      }
      await expect(ctx.xiaojingFinanceDomain.prepareJournal(agent(ctx, 'journal-standard', 'standard', standardRoot),
        { action: 'inspect', id: first.id }, signal, 10000)).rejects.toThrow()
      if (mode === 'accepted') {
        const second = await ctx.xiaojingFinanceDomain.prepareJournal(finance, { action: 'prepare', input }, signal, 10000)
        if (!('id' in second)) throw new Error('Missing second journal preview ID')
        expect(second.id).not.toBe(first.id)
        expect(await ctx.xiaojingFinanceDomain.createJournal(finance, { id: second.id, version: 1 }, signal, 10000))
          .toMatchObject({ phase: 'accepted', complete: true })
        expect(writes).toBe(2)
        const third = await ctx.xiaojingFinanceDomain.prepareJournal(finance, { action: 'prepare', input }, signal, 10000)
        if (!('id' in third)) throw new Error('Missing third journal preview ID')
        await ctx.xiaojingFinanceDomain.prepareJournal(finance,
          { action: 'revise', id: third.id, version: 1, input: { ...input, amount: '0.22' } }, signal, 10000)
        await expect(ctx.xiaojingFinanceDomain.createJournal(finance, { id: third.id, version: 1 }, signal, 10000))
          .rejects.toThrow('版本已变化')
        expect(writes).toBe(2)
      }
      expect(approval).toHaveBeenCalledTimes(1)
    } finally { await dispose() }
  })

  it.each((['receivable', 'payable'] as const).flatMap(direction =>
    ['accepted', 'denied', 'changed', 'lost', 'rejected', 'secret-response', 'account-changed', 'source-changed',
      'source-after-reservation', 'config-changed', 'cancelled']
      .map(mode => ({ direction, mode }))))('owns $direction approval and single-send state with $mode', async ({ direction, mode }) => {
    const { ctx, financeRoot, standardRoot, dispose } = await mounted()
    try {
      const created = await createClient(ctx, financeRoot, 0, '往来测试', '上海')
      const saved = await ctx.xiaojingFinanceDomain.update({ clientId: created.client.id, expectedRevision: created.revision,
        client: { ...draft('往来测试', '上海'), financeSystem: { system: 'youcheng', environment: 'test',
          appKey: 'fake-key', accountCode: '35616' } }, credentialInput: { youchengAppSecret: 'fake-secret' } })
      const finance = agent(ctx, `open-item-${direction}-${mode}`, 'finance', saved.client.workspacePath)
      await ctx.xiaojingFinanceDomain.stage(finance, { mode: 'client', clientId: saved.client.id })
      await ctx.xiaojingFinanceDomain.promptContext(finance)
      const payable = direction === 'payable'
      const input = { direction, date: '2022-01-09', amount: '0.05', summary: 'F3往来测试', keeperName: '测试员',
        accountId: payable ? '174624' : '174626', categoryId: payable ? '578260' : '578250',
        auxiliaryCategoryCode: payable ? '02' : '01', auxiliaryItemId: payable ? '191573' : '191501',
        accountReferenceQuery: { direction, periodStart: '2022-01', periodEnd: '2022-01', page: 1, pageSize: 100 } }
      let writes = 0
      let approved = false
      let status = 0
      let sourceId = 70000
      let sourceReadsAfterApproval = 0
      const controller = new AbortController()
      const signal = controller.signal
      const row = (id: number) => ({ id, setOfBooksId: 35616, date: input.date, abstractStr: input.summary,
        money: input.amount, balance: input.amount, currencyCode: 'RMB', baseCurrencyCode: 'RMB', subjectCode: '',
        subjectName: payable ? '应付账款' : '应收账款', subjectId: Number(input.accountId), accountStatus: status, accountWb: false,
        auxiliaryItemIds: input.auxiliaryItemId, auxiliaryItemName: '往来测试',
        thisMoney: 0, badMoney: 0, hedgeMoney: 0, returnMoney: 0, initialBalance: false, isFinish: false,
        categoryName: payable ? '支-其他支出' : '收-其他收入', categoryId: Number(input.categoryId),
        keeperName: input.keeperName, remark: '', attachList: [], certificateWordAndCode: '', orderCode: '' })
      vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
        if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
        if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35616', sobName: '演示账套' }] })
        if (url.pathname.includes('getCategoryList')) return Response.json({ result: 100, data: [{ id: Number(input.categoryId),
          code: '01', name: payable ? '其他支出' : '其他收入', type: payable ? 1 : 0 }] })
        if (url.pathname.includes('queryAuxiliaryCategoryList')) return Response.json({ result: 100, data: [{ id: 101,
          categoryCode: input.auxiliaryCategoryCode, categoryName: payable ? '供应商' : '客户' }] })
        if (url.pathname.includes('queryAuxiliaryItemList')) return Response.json({ result: 100,
          data: [{ id: Number(input.auxiliaryItemId), itemCode: '03', itemName: '往来测试', categoryId: 101 }] })
        if (url.pathname === '/finance/cashjournal/getCashierList') {
          if (approved && ++sourceReadsAfterApproval === 2 && mode === 'source-after-reservation') sourceId = 70001
          return Response.json({ result: 100, data: { count: writes === 0 ? 1 : 2,
            list: [row(sourceId), ...writes === 0 ? [] : [row(72595)]] } })
        }
        expect(url.pathname).toBe('/finance/cashier/account/management/add.rjson')
        expect(approved).toBe(true)
        if (typeof init.body !== 'string') throw new Error('Expected open-item JSON')
        expect(JSON.parse(init.body)).toMatchObject({ auxiliaryItemNames: `${payable ? '供应商' : '客户'}:往来测试`,
          direction: payable, money: 0.05, accountId: Number(input.accountId) })
        writes++
        if (mode === 'lost') throw new Error('response lost')
        if (mode === 'cancelled') controller.abort()
        return Response.json(mode === 'secret-response' ? { result: 201, message: 'fake-secret' }
          : mode === 'rejected' ? { result: 201, message: '测试拒绝' } : { result: 100, data: '72595' })
      }))
      const references = await ctx.xiaojingFinanceDomain.queryObservedOpenItemAccounts(finance, input.accountReferenceQuery, signal)
      expect(references).toMatchObject({ coverage: 'returned-page-only', observations: [{ id: input.accountId }] })
      const first = await ctx.xiaojingFinanceDomain.prepareOpenItem(finance, { action: 'prepare', input }, signal, 10000)
      if (!('id' in first)) throw new Error('Missing open-item preview ID')
      expect(first).toMatchObject({ version: 1, phase: 'prepared', accountObservation: { sourceRecordId: '70000' } })
      expect(JSON.stringify(first)).not.toMatch(/fake-secret|fake-token|fake-key|configurationDigest/)
      expect(writes).toBe(0)
      const approval = vi.fn(async (request: { toolName: string; reason: string }) => {
        expect(request.toolName).toBe('finance_create_open_item')
        for (const value of ['演示账套', '0.05', payable ? '供应商：往来测试' : '客户：往来测试',
          payable ? '应付账款' : '应收账款']) expect(request.reason).toContain(value)
        expect(request.reason).not.toMatch(/不是完整账户目录|70000|"version"/)
        approved = true
        if (mode === 'account-changed') status = 1
        if (mode === 'source-changed') sourceId = 70001
        if (mode === 'changed') await ctx.xiaojingFinanceDomain.prepareOpenItem(finance,
          { action: 'revise', id: first.id, version: 1, input: { ...input, amount: '0.06' } }, signal, 10000)
        if (mode === 'config-changed') await ctx.xiaojingFinanceDomain.update({ clientId: saved.client.id, expectedRevision: saved.revision,
          client: { ...draft('往来测试', '北京'), financeSystem: { system: 'youcheng', environment: 'test',
            appKey: 'fake-key', accountCode: '35616' } } })
        return mode === 'denied' ? 'denied' : 'allowed-once'
      })
      ctx.provide('approval', { requestMandatory: approval } as never)
      const submitted = ctx.xiaojingFinanceDomain.createOpenItem(finance, { id: first.id, version: 1 }, signal, 10000)
      if (['denied', 'changed', 'account-changed', 'source-changed', 'config-changed'].includes(mode)) {
        await expect(submitted).rejects.toThrow()
        expect(writes).toBe(0)
      } else if (mode === 'source-after-reservation') {
        expect(await submitted).toMatchObject({ phase: 'not-sent', outcome: { state: 'not-sent', reason: 'preflight-failed' }, complete: false })
        expect(writes).toBe(0)
        await expect(ctx.xiaojingFinanceDomain.createOpenItem(finance, { id: first.id, version: 1 }, signal, 10000)).rejects.toThrow('发送记录')
      } else {
        const state = mode === 'lost' || mode === 'secret-response' ? 'outcome-unknown' : mode === 'rejected' ? 'rejected' : 'accepted'
        expect(await submitted).toMatchObject({ phase: state, complete: mode === 'accepted' })
        expect(writes).toBe(1)
        const fresh = new AbortController().signal
        await expect(ctx.xiaojingFinanceDomain.createOpenItem(finance, { id: first.id, version: 1 }, fresh, 10000)).rejects.toThrow('发送记录')
        expect(await ctx.xiaojingFinanceDomain.prepareOpenItem(finance, { action: 'inspect', id: first.id }, fresh, 10000))
          .toMatchObject({ phase: state, complete: mode === 'accepted' || mode === 'cancelled' })
        expect(writes).toBe(1)
      }
      const sibling = agent(ctx, `other-${direction}-${mode}`, 'finance', saved.client.workspacePath)
      await ctx.xiaojingFinanceDomain.stage(sibling, { mode: 'client', clientId: saved.client.id })
      await ctx.xiaojingFinanceDomain.promptContext(sibling)
      await expect(ctx.xiaojingFinanceDomain.prepareOpenItem(sibling,
        { action: 'inspect', id: first.id }, new AbortController().signal, 10000)).rejects.toThrow()
      await expect(ctx.xiaojingFinanceDomain.queryObservedOpenItemAccounts(agent(ctx, 'open-item-standard', 'standard', standardRoot),
        input.accountReferenceQuery, new AbortController().signal)).rejects.toThrow()
      expect(approval).toHaveBeenCalledTimes(1)
    } finally { await dispose() }
  })

  it('prepares and revises local vouchers only in the bound session without financial writes', async () => {
    const { ctx, financeRoot, standardRoot, uploadRoot, dispose } = await mounted()
    try {
      const created = await createClient(ctx, financeRoot, 0, '凭证准备', '上海')
      const fields = { ...draft('凭证准备', '上海'), financeSystem: {
        system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: 'ledger-2',
      } }
      const saved = await ctx.xiaojingFinanceDomain.update({ clientId: created.client.id, expectedRevision: created.revision,
        client: fields, credentialInput: { youchengAppSecret: 'fake-secret' } })
      const finance = agent(ctx, 'voucher-preparation', 'finance', saved.client.workspacePath)
      await ctx.xiaojingFinanceDomain.stage(finance, { mode: 'client', clientId: saved.client.id })
      await ctx.xiaojingFinanceDomain.promptContext(finance)
      vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
        if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
        if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: 'ledger-2', sobName: '演示账套' }] })
        expect(url.pathname).toBe('/finance/auxiliary/querySubjectInfoList.rjson')
        return Response.json({ result: 100, data: ['1001', '1002'].map(subjectCode => ({
          subjectCode, subjectName: subjectCode, hasChild: false, enableStatus: '1', auxiliaryList: [], currencyList: [],
        })) })
      }))
      const input = { date: '2026-09-09', documentMaker: '测试', sourcePaths: [], entries: [
        { summary: '测试', subjectCode: '1001', side: 'debit', amount: '0.30', auxiliary: [] },
        { summary: '测试', subjectCode: '1002', side: 'credit', amount: '0.30', auxiliary: [] },
      ] }
      const signal = new AbortController().signal
      const limits = { maxEntries: 10, maxBytes: 10000 }
      const first = await ctx.xiaojingFinanceDomain.prepareVoucher(finance, { action: 'prepare', input }, signal, limits)
      expect(first).toMatchObject({ version: 1, phase: 'prepared', totalDebit: '0.30', account: { id: 'ledger-2' } })
      if (!('id' in first)) throw new Error('Missing prepared ID')
      expect(JSON.stringify(first)).not.toMatch(/fake-secret|fake-token|fake-key|configurationDigest/)
      const changed = await ctx.xiaojingFinanceDomain.prepareVoucher(finance,
        { action: 'revise', id: first.id, version: 1, input: { ...input, documentMaker: '更正' } }, signal, limits)
      expect(changed).toMatchObject({ version: 2, input: { documentMaker: '更正' } })
      await expect(ctx.xiaojingFinanceDomain.prepareVoucher(finance,
        { action: 'revise', id: first.id, version: 1, input }, signal, limits)).rejects.toThrow('版本')
      await expect(ctx.xiaojingFinanceDomain.prepareVoucher(finance,
        { action: 'prepare', input: { ...input, sourcePaths: ['未导入.pdf'] } }, signal, limits)).rejects.toThrow('已导入')
      await expect(ctx.xiaojingFinanceDomain.prepareVoucher(agent(ctx, 'other-voucher', 'standard', standardRoot),
        { action: 'prepare', input }, signal, limits)).rejects.toThrow()
      await expect(ctx.xiaojingFinanceDomain.prepareVoucher(finance, { action: 'submit', id: first.id }, signal, limits))
        .rejects.toThrow('不支持提交')
      const upload = join(uploadRoot, 'preparation-source.pdf')
      await writeFile(upload, '%PDF-1.7\noriginal')
      const imported = await ctx.xiaojingFinanceDomain.importUpload(finance, { path: upload, originalName: '凭证依据.pdf' })
      const withSource = await ctx.xiaojingFinanceDomain.prepareVoucher(finance,
        { action: 'prepare', input: { ...input, sourcePaths: [imported.name] } }, signal, limits)
      expect(withSource).toMatchObject({ sources: [{ sha256: imported.sha256, size: imported.size, contentVerified: true }] })
      if (!('id' in withSource)) throw new Error('Missing source preview ID')
      await writeFile(imported.path, 'tampered')
      await expect(ctx.xiaojingFinanceDomain.prepareVoucher(finance,
        { action: 'inspect', id: withSource.id }, signal, limits)).rejects.toThrow('已变更')
      await expect(ctx.xiaojingFinanceDomain.prepareVoucher(finance,
        { action: 'revise', id: withSource.id, version: 1, input: { ...input, sourcePaths: [imported.name] } }, signal, limits))
        .rejects.toThrow('已变更')
    } finally { await dispose() }
  })

  it('keeps reference reads in the bound workspace and discards changed credentials or client settings', async () => {
    const { ctx, financeRoot, standardRoot, dispose } = await mounted()
    try {
      const created = await createClient(ctx, financeRoot, 0, '基础资料', '上海')
      const fields = { ...draft('基础资料', '上海'), financeSystem: { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: 'ledger-2' } }
      const saved = await ctx.xiaojingFinanceDomain.update({ clientId: created.client.id, expectedRevision: created.revision,
        client: fields, credentialInput: { youchengAppSecret: 'fake-secret' } })
      const finance = agent(ctx, 'references-bound', 'finance', saved.client.workspacePath)
      await ctx.xiaojingFinanceDomain.stage(finance, { mode: 'client', clientId: saved.client.id })
      await ctx.xiaojingFinanceDomain.promptContext(finance)
      const query = { kind: 'subjects' as const }
      let duringRead: (() => Promise<void>) | undefined
      const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
        if (url.pathname.includes('/auth/')) return Response.json({ result: 100, data: 'fake-token' })
        if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: 'ledger-2', sobName: '演示账套' }] })
        expect(url.pathname).toBe('/finance/auxiliary/querySubjectInfoList.rjson')
        if (typeof init.body !== 'string') throw new Error('Expected JSON body')
        expect(JSON.parse(init.body)).toEqual({ setOfBooksId: 'ledger-2', sobName: '演示账套', pageSize: 1000 })
        await duringRead?.()
        return Response.json({ result: 100, data: [{ subjectCode: '1001', subjectName: '现金' }] })
      })
      vi.stubGlobal('fetch', fetcher)
      expect(await ctx.xiaojingFinanceDomain.queryReferences(finance, query, new AbortController().signal))
        .toMatchObject({ accountId: 'ledger-2', rows: [{ code: '1001', status: 'unknown' }] })
      const calls = fetcher.mock.calls.length
      for (const other of [agent(ctx, 'reference-standard', 'standard', standardRoot), agent(ctx, 'reference-consult', 'finance', standardRoot)]) {
        await expect(ctx.xiaojingFinanceDomain.queryReferences(other, query, new AbortController().signal)).rejects.toThrow()
      }
      const cancelled = new AbortController()
      cancelled.abort()
      await expect(ctx.xiaojingFinanceDomain.queryReferences(finance, query, cancelled.signal)).rejects.toThrow()
      expect(fetcher).toHaveBeenCalledTimes(calls)
      duringRead = async () => {
        await ctx.credentials.modifyRecord(credentialKey('xiaojing-finance-domain', `client-${saved.client.id}`),
          async () => ({ kind: 'api-key', key: 'replacement-secret' }))
      }
      await expect(ctx.xiaojingFinanceDomain.queryReferences(finance, query, new AbortController().signal)).rejects.toThrow('已变更')
      duringRead = async () => {
        await ctx.xiaojingFinanceDomain.update({ clientId: saved.client.id, expectedRevision: saved.revision,
          client: { ...fields, financeSystem: { ...fields.financeSystem, accountCode: 'other' } } })
      }
      await expect(ctx.xiaojingFinanceDomain.queryReferences(finance, query, new AbortController().signal)).rejects.toThrow('已变更')
    } finally { await dispose() }
  })

  it('provides read evidence rules without skill loading only to bound Finance sessions', async () => {
    const { ctx, financeRoot, standardRoot, dispose } = await mounted()
    try {
      await ctx.plugin(SystemPrompt).await()
      const consumer = ctx.plugin(financeContext)
      await consumer.await()
      const created = await createClient(ctx, financeRoot, 0, '查询上下文', '上海')
      const finance = agent(ctx, 'read-context', 'finance', created.client.workspacePath)
      await ctx.xiaojingFinanceDomain.stage(finance, { mode: 'client', clientId: created.client.id })
      const assembly = await ctx.systemPrompt.assemble({ agent: finance })
      const rules = assembly.sections.filter(section => section.name === 'xiaojing:finance-read-evidence')
      expect(rules).toHaveLength(1)
      expect(rules[0]?.text).toContain('名称相同不证明账户与科目对应')
      expect(rules[0]?.text).toContain('不代表所有期初余额缺失')
      expect(rules[0]?.text).toContain('不能调用报销模块的users/staff接口来核实财务成员')
      expect(rules[0]?.text).toContain('最终回答、表格和文件先给业务结果与实际数据')
      expect(rules[0]?.text).toContain('不展示工具名、接口路径、参数名、原始 JSON、内部记录 ID、版本号、哈希、指纹、分页字段或英文状态码')
      expect(rules[0]?.text).toContain('展示层精简不得改变金额、范围、执行状态或风险判断')
      expect(rules[0]?.text).toContain('新的只读查询不得续办、重建或确认历史中断的创建、删除、核销等写操作')
      expect(rules[0]?.text).toContain('不得搜索本地文件或复述旧金额、旧分录、旧附件作为当前内容')
      expect(rules[0]?.text).toContain('借方和贷方逐列相减、分别报告')
      expect(rules[0]?.text).toContain('严格区分准备、上传、提交、接口受理和独立回查')
      expect(rules[0]?.text).toContain('用户要求全部数据时，成功结果应是一个完整文件')
      expect(rules[0]?.text).toContain('客户档案名称与外部财务系统账套名称是两个独立业务字段')
      expect(rules[0]?.text).toContain('官方依据标记为已核验时，保持该政策命题为已核验')
      for (const context of [{}, { agent: agent(ctx, 'read-standard', 'standard', standardRoot) }, { agent: agent(ctx, 'read-consult', 'finance', standardRoot) }]) {
        expect((await ctx.systemPrompt.assemble(context)).sections.some(section => section.name === 'xiaojing:finance-read-evidence')).toBe(false)
      }
      await consumer.dispose()
      expect((await ctx.systemPrompt.assemble({ agent: finance })).sections.some(section => section.name === 'xiaojing:finance-read-evidence')).toBe(false)
    } finally { await dispose() }
  })

  it('contributes the capability inventory only to Finance sessions and removes it on disposal', async () => {
    const { ctx, financeRoot, standardRoot, dispose } = await mounted()
    try {
      await ctx.plugin(SystemPrompt).await()
      const consumer = ctx.plugin(financeContext)
      await consumer.await()
      const created = await createClient(ctx, financeRoot, 0, '能力上下文', '上海')
      const finance = agent(ctx, 'capability-context', 'finance', created.client.workspacePath)
      await ctx.xiaojingFinanceDomain.stage(finance, { mode: 'client', clientId: created.client.id })
      const assembly = await ctx.systemPrompt.assemble({ agent: finance })
      const rules = assembly.sections.find(section => section.name === 'xiaojing:finance-capabilities')
      expect(rules?.text).toContain('当前会话已绑定客户档案')
      expect(rules?.text).toContain('小兢会计，您的AI财务助手')
      expect(rules?.text).toContain('不得在一般介绍中主动逐项展开')
      expect(rules?.text).toContain('[暂不支持] 报销业务（适用范围：当前财务工作区）')
      expect(rules?.text).toContain('[暂不支持] 六类原生账簿与报表（适用范围：当前有成财务接入）')
      expect(rules?.text).toContain('支持状态只适用于条目标明的范围')
      expect(assembly.contexts.some(section => section.name === 'xiaojing:finance-client')).toBe(true)
      const consultation = await ctx.systemPrompt.assemble({ agent: agent(ctx, 'context-consult', 'finance', standardRoot) })
      expect(consultation.sections.find(section => section.name === 'xiaojing:finance-capabilities')?.text)
        .toContain('当前会话是通用财务咨询，未绑定客户')
      for (const context of [{}, { agent: agent(ctx, 'context-standard', 'standard', standardRoot) }])
        expect((await ctx.systemPrompt.assemble(context)).sections.some(section => section.name === 'xiaojing:finance-capabilities')).toBe(false)
      expect(assembly.contexts.some(section => section.name === 'xiaojing:reimbursement')).toBe(false)
      await consumer.dispose()
      expect((await ctx.systemPrompt.assemble({ agent: finance })).contexts).toEqual([])
      expect((await ctx.systemPrompt.assemble({ agent: finance })).sections
        .some(section => section.name === 'xiaojing:finance-capabilities')).toBe(false)
    } finally { await dispose() }
  })

  it.each(['vouchers', 'balances', 'journals', 'open-items', 'analysis', 'export', 'voucher-export', 'balance-export', 'journal-export', 'open-item-export', 'journal-analysis', 'journal-analysis-export'])('queries %s only in the bound workspace and discards concurrent edits', async (kind) => {
    const { ctx, financeRoot, standardRoot, dispose } = await mounted()
    try {
      const created = await createClient(ctx, financeRoot, 0, '查询凭证', '上海')
      const saved = await ctx.xiaojingFinanceDomain.update({ clientId: created.client.id, expectedRevision: created.revision,
        client: { ...draft('查询凭证', '上海'), financeSystem: { system: 'youcheng', environment: 'test', appKey: 'fake-key', accountCode: '35601' } },
        credentialInput: { youchengAppSecret: 'fake-secret' },
      })
      const finance = agent(ctx, 'vouchers-bound', 'finance', saved.client.workspacePath)
      await ctx.xiaojingFinanceDomain.stage(finance, { mode: 'client', clientId: saved.client.id })
      await ctx.xiaojingFinanceDomain.promptContext(finance)
      const query = { month: '2022-01', page: 1, pageSize: 20 }
      const endpoint = kind === 'balances' || kind === 'balance-export' ? '/finance/subject/getList.rjson'
        : ['open-items', 'analysis', 'export', 'open-item-export'].includes(kind) ? '/finance/cashjournal/getCashierList'
          : kind === 'journals' || kind.startsWith('journal-') ? '/finance/cashjournal/getListPage.rjson' : '/finance/certificate/list.rjson'
      const read = (owner: Agent) => kind === 'balances'
        ? ctx.xiaojingFinanceDomain.queryBalances(owner, { month: query.month }, new AbortController().signal)
        : kind === 'journal-analysis' ? ctx.xiaojingFinanceDomain.analyzeJournals(owner, { cashAccountId: '174553', current: { month: query.month } }, new AbortController().signal)
          : kind === 'journal-analysis-export' ? ctx.xiaojingFinanceDomain.exportJournalAnalysis(owner, { cashAccountId: '174553', current: { month: query.month } }, new AbortController().signal)
            : kind === 'journal-export' ? ctx.xiaojingFinanceDomain.exportJournals(owner, query, new AbortController().signal)
              : kind === 'open-item-export' ? ctx.xiaojingFinanceDomain.exportOpenItemPage(owner, {
                direction: 'receivable', periodStart: query.month, periodEnd: query.month, page: 1, pageSize: 20,
              }, new AbortController().signal)
                : kind === 'balance-export' ? ctx.xiaojingFinanceDomain.exportBalances(owner, { month: query.month }, new AbortController().signal)
                  : kind === 'voucher-export' ? ctx.xiaojingFinanceDomain.exportVouchers(owner, query, new AbortController().signal)
                    : kind === 'export' ? ctx.xiaojingFinanceDomain.exportOpenItems(owner, {
                      direction: 'receivable', groupBy: 'currency', current: { periodStart: query.month, periodEnd: query.month },
                    }, new AbortController().signal)
                      : kind === 'analysis' ? ctx.xiaojingFinanceDomain.analyzeOpenItems(owner, {
                        direction: 'receivable', groupBy: 'currency', current: { periodStart: query.month, periodEnd: query.month },
                      }, new AbortController().signal)
                        : kind === 'open-items' ? ctx.xiaojingFinanceDomain.queryOpenItems(owner, {
                          direction: 'receivable', periodStart: query.month, periodEnd: query.month, page: 1, pageSize: 20,
                        }, new AbortController().signal)
                          : kind === 'journals' ? ctx.xiaojingFinanceDomain.queryJournals(owner, query, new AbortController().signal)
                            : ctx.xiaojingFinanceDomain.queryVouchers(owner, query, new AbortController().signal)
      const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
        if (typeof init.body !== 'string') throw new Error('Expected JSON body')
        if (url.pathname.includes('/auth/')) {
          expect(JSON.parse(init.body)).toEqual({ appKey: 'fake-key', appSecret: 'fake-secret' })
          return Response.json({ result: 100, data: 'fake-token' })
        }
        if (url.pathname.includes('queryAccountList')) return Response.json({ result: 100, data: [{ id: '35601', sobName: '演示账套' }] })
        if (kind.startsWith('journal-analysis') && url.pathname.includes('getAccountList')) return Response.json({ result: 100, data: [{ accountId: 174553 }] })
        expect(url.pathname).toBe(endpoint)
        expect(JSON.parse(init.body)).toMatchObject(['balances', 'balance-export', 'open-items', 'analysis', 'export', 'open-item-export'].includes(kind) ? { setOfBooksId: 35601 } : { accountName: '演示账套' })
        return Response.json({ result: 100, data: kind.startsWith('journal-analysis') ? [{ date: '', abstractStr: '合计', borrow: 0, loan: 0,
          accountCode: '', accountName: '', currencyCode: '', baseCurrencyCode: '', categoryName: '', keeperName: '' }]
          : kind === 'journals' || kind === 'journal-export' ? [] : { success: true, count: 0, list: [] } })
      })
      vi.stubGlobal('fetch', fetcher)
      const workbookName: unknown = expect.stringMatching(/\.xlsx$/)
      expect(await read(finance)).toMatchObject(['voucher-export', 'balance-export', 'journal-export', 'open-item-export'].includes(kind)
        ? { report: { accountId: '35601', rows: [] }, file: { name: workbookName } }
        : kind === 'export'
          ? { report: { accountId: '35601', current: { recordCount: 0, groups: [] } }, file: { name: workbookName } }
          : kind === 'journal-analysis-export' ? { report: { accountId: '35601', current: { rows: [], income: '0.00' } }, file: { name: workbookName } }
            : kind === 'journal-analysis' ? { accountId: '35601', current: { rows: [], income: '0.00' } }
              : kind === 'analysis' ? { accountId: '35601', current: { recordCount: 0, groups: [] } } : { accountId: '35601', rows: [] })
      if (kind === 'export') {
        expect(finance.session.snapshotEvents().filter(event => event.type === 'finance/file-published')).toHaveLength(1)
        await expect(ctx.xiaojingFinanceDomain.exportOpenItems(finance, {
          direction: 'receivable', groupBy: 'currency', current: { periodStart: query.month, periodEnd: query.month },
        }, AbortSignal.abort())).rejects.toThrow()
        expect(finance.session.snapshotEvents().filter(event => event.type === 'finance/file-published')).toHaveLength(1)
      }
      const calls = fetcher.mock.calls.length
      for (const other of [agent(ctx, 'voucher-standard', 'standard', standardRoot), agent(ctx, 'voucher-consult', 'finance', standardRoot)]) {
        await expect(read(other)).rejects.toThrow()
      }
      expect(fetcher).toHaveBeenCalledTimes(calls)
      const original = fetcher.getMockImplementation()!
      fetcher.mockImplementation(async (url, init) => {
        if (url.pathname === endpoint) {
          await ctx.credentials.modifyRecord(credentialKey('xiaojing-finance-domain', `client-${saved.client.id}`),
            async () => ({ kind: 'api-key', key: 'replacement-secret' }))
        }
        return original(url, init)
      })
      await expect(read(finance)).rejects.toThrow('已变更')
      await ctx.credentials.modifyRecord(credentialKey('xiaojing-finance-domain', `client-${saved.client.id}`),
        async () => ({ kind: 'api-key', key: 'fake-secret' }))
      fetcher.mockImplementation(async (url, init) => {
        if (url.pathname === endpoint) {
          await ctx.xiaojingFinanceDomain.update({ clientId: saved.client.id, expectedRevision: saved.revision,
            client: { ...draft('查询凭证', '上海'), financeSystem: { system: 'youcheng', environment: 'test', appKey: 'fake-key', accountCode: 'other' } },
          })
        }
        return original(url, init)
      })
      await expect(read(finance)).rejects.toThrow('已变更')
      expect(JSON.stringify(finance.session.snapshotEvents())).not.toMatch(/fake-key|fake-secret|fake-token/)
      if (['export', 'voucher-export', 'balance-export', 'journal-export', 'open-item-export', 'journal-analysis-export'].includes(kind)) {
        expect(finance.session.snapshotEvents().filter(event => event.type === 'finance/file-published')).toHaveLength(1)
      }
    } finally { await dispose() }
  })

  it('defaults Finance to explicit general consultation without writing a binding event', async () => {
    const { ctx, standardRoot, dispose } = await mounted()
    const finance = agent(ctx, 'finance-general', 'finance', standardRoot)
    expect(await ctx.xiaojingFinanceDomain.sessionContext(finance)).toEqual({ state: 'general', locked: false })
    const prompt = await ctx.xiaojingFinanceDomain.promptContext(finance)
    expect(prompt).toContain('未绑定任何客户')
    expect(prompt).toContain('不得推测或编造客户')
    expect(finance.session.snapshotEvents().some(event => event.type === 'finance/client-bound')).toBe(false)
    expect(ctx.xiaojingFinanceDomain.currentClientBinding(finance)).toBeUndefined()
    expect(() => ctx.xiaojingFinanceDomain.requireBoundClient(finance)).toThrow(/requires a client-bound Finance session/)
    await dispose()
  })

  it('registers general consultation uploads in the session without copying them into a client workspace', async () => {
    const { ctx, uploadRoot, standardRoot, dispose } = await mounted()
    const finance = agent(ctx, 'finance-general-upload', 'finance', standardRoot)
    const uploadedPath = join(uploadRoot, 'consultation.pdf')
    await writeFile(uploadedPath, 'consultation document', 'utf8')

    const imported = await ctx.xiaojingFinanceDomain.importUpload(finance, {
      path: uploadedPath,
      originalName: 'consultation.pdf',
    })

    expect(imported).toMatchObject({
      sessionId: finance.session.id,
      path: uploadedPath,
      name: 'consultation.pdf',
      size: 21,
    })
    expect(imported).not.toHaveProperty('clientId')
    expect(await readFile(uploadedPath, 'utf8')).toBe('consultation document')
    expect(finance.session.snapshotEvents().map(event => event.type)).toContain('finance/consultation-file-imported')
    expect(finance.session.snapshotEvents().some(event => event.type === 'finance/client-bound')).toBe(false)
    await dispose()
  })

  it('owns a standard Workspace and creates one isolated Workspace for each client', async () => {
    const { ctx, financeRoot, standardRoot, workspaces, dispose } = await mounted()
    const initial = await ctx.xiaojingFinanceDomain.workspaces()
    expect(initial.workspaceRoot).toBe(resolve(financeRoot))
    expect(initial.standard).toMatchObject({ kind: 'standard', title: '咨询', startable: true })
    expect(initial.consultations).toEqual([])
    expect(initial.clients).toEqual([])
    expect(workspaces.byPath.get(resolve(standardRoot))?.id).toBe(initial.standard.workspaceId)

    const created = await createClient(ctx, financeRoot, 0, '客户甲有限公司', '上海市')
    const listed = await ctx.xiaojingFinanceDomain.workspaces()
    expect(listed.clients).toEqual([expect.objectContaining({
      kind: 'client',
      clientId: created.client.id,
      title: '客户',
      startable: true,
    })])
    const clientRoot = created.client.workspacePath
    expect(workspaces.byPath.get(resolve(clientRoot))?.id).toBe(listed.clients[0]?.workspaceId)
    await Promise.all([
      join(clientRoot, '00-客户档案'),
      join(clientRoot, '01-财务政策'),
      join(clientRoot, '02-原始资料'),
      join(clientRoot, '03-会话作业'),
      join(clientRoot, '04-成果输出'),
      join(clientRoot, '05-归档'),
    ].map(path => access(path)))
    const profile = JSON.parse(await readFile(
      join(clientRoot, '00-客户档案', '客户档案快照.json'),
      'utf8',
    )) as { schemaVersion: number; client: { legalName: string } }
    expect(profile).toMatchObject({ schemaVersion: 1, client: { legalName: '客户甲有限公司' } })
    expect(await readFile(join(clientRoot, '01-财务政策', '客户财务政策备注.md'), 'utf8'))
      .toContain('客户甲有限公司专属政策')
    await dispose()
  })

  it('rejects a client directory nested inside the ordinary desktop workspace', async () => {
    const { ctx, root, dispose } = await mounted()
    const clientRoot = join(root, '办公工作区', '错误帐套')
    await mkdir(clientRoot, { recursive: true })
    await expect(ctx.xiaojingFinanceDomain.create({
      expectedRevision: 0,
      client: draft('错误帐套有限公司', '上海市'),
      workspacePath: clientRoot,
    })).rejects.toThrow(/ordinary Workspace|办公工作区/)
    await expect(access(join(clientRoot, '00-客户档案'))).rejects.toThrow()
    await dispose()
  })

  it('stores Youcheng connection metadata with the client and keeps AppSecret in credentials', async () => {
    const { ctx, root, financeRoot, dispose } = await mounted()
    const created = await createClient(ctx, financeRoot, 0, '接口客户有限公司', '上海市')
    const financeSystem = {
      system: 'youcheng' as const,
      environment: 'test' as const,
      appKey: 'app-key-001',
      accountCode: 'ACCT-001',
    }

    await expect(ctx.xiaojingFinanceDomain.update({
      clientId: created.client.id,
      expectedRevision: 1,
      client: { ...draft('接口客户有限公司', '上海市'), financeSystem },
    })).rejects.toThrow(/AppSecret is required/)
    expect((await ctx.xiaojingFinanceDomain.list()).revision).toBe(1)

    const updated = await ctx.xiaojingFinanceDomain.update({
      clientId: created.client.id,
      expectedRevision: 1,
      client: { ...draft('接口客户有限公司', '上海市'), financeSystem },
      credentialInput: { youchengAppSecret: 'secret-001' },
    })
    expect(updated.client.financeSystem).toEqual(financeSystem)

    const read = await ctx.xiaojingFinanceDomain.read(created.client.id)
    expect(read.credentialStatus).toEqual({
      youchengAppSecretConfigured: true,
      youchengAppSecretWritable: true,
    })
    expect(JSON.stringify(read)).not.toContain('secret-001')
    expect(await ctx.credentials.readRecord(credentialKey(
      'xiaojing-finance-domain',
      `client-${created.client.id}`,
    ))).toEqual({ kind: 'api-key', key: 'secret-001' })
    expect(await readFile(join(root, 'finance', 'clients-v1.json'), 'utf8')).not.toContain('secret-001')

    const preserved = await ctx.xiaojingFinanceDomain.update({
      clientId: created.client.id,
      expectedRevision: 2,
      client: {
        ...draft('接口客户有限公司', '上海市'),
        financeSystem: { ...financeSystem, accountCode: 'ACCT-002' },
      },
    })
    expect(preserved.client.financeSystem).toMatchObject({ accountCode: 'ACCT-002' })
    expect(await ctx.credentials.readRecord(credentialKey(
      'xiaojing-finance-domain',
      `client-${created.client.id}`,
    ))).toEqual({ kind: 'api-key', key: 'secret-001' })
    await expect(ctx.xiaojingFinanceDomain.update({
      clientId: created.client.id,
      expectedRevision: 1,
      client: { ...draft('接口客户有限公司', '上海市'), financeSystem },
      credentialInput: { youchengAppSecret: 'stale-secret' },
    })).rejects.toThrow(/revision conflict/)
    expect(await ctx.credentials.readRecord(credentialKey(
      'xiaojing-finance-domain',
      `client-${created.client.id}`,
    ))).toEqual({ kind: 'api-key', key: 'secret-001' })
    const finance = agent(ctx, 'finance-youcheng-config', 'finance', created.client.workspacePath)
    await ctx.xiaojingFinanceDomain.stage(finance, { mode: 'client', clientId: created.client.id })
    const prompt = await ctx.xiaojingFinanceDomain.promptContext(finance)
    expect(prompt).not.toContain('app-key-001')
    expect(prompt).not.toContain('ACCT-002')
    await dispose()
  })

  it('rolls back only the customer Workspace registration when the catalog mutation rejects', async () => {
    const { ctx, financeRoot, workspaces, dispose } = await mounted()
    const clientRoot = join(financeRoot, '客户-过期窗口客户')
    await mkdir(clientRoot, { recursive: true })
    await writeFile(join(clientRoot, '用户文件.txt'), 'preserve', 'utf8')
    await expect(ctx.xiaojingFinanceDomain.create({
      expectedRevision: 99,
      client: draft('过期窗口客户', '北京市'),
      workspacePath: clientRoot,
    })).rejects.toThrow(/revision/i)
    expect(await readFile(join(clientRoot, '用户文件.txt'), 'utf8')).toBe('preserve')
    expect(workspaces.byPath.has(resolve(clientRoot))).toBe(false)
    expect([...workspaces.byPath.values()].map(workspace => workspace.title)).toEqual(['咨询'])
    await dispose()
  })

  it('registers a user-selected consultation Workspace and permits general Finance sessions there', async () => {
    const { ctx, financeRoot, workspaces, dispose } = await mounted()
    const consultationRoot = join(financeRoot, '专项咨询')
    await mkdir(consultationRoot, { recursive: true })
    const entry = await ctx.xiaojingFinanceDomain.addConsultationWorkspace({ path: consultationRoot })
    expect(entry).toMatchObject({ kind: 'consultation', title: '专项咨询', startable: true })
    expect(workspaces.byPath.get(resolve(consultationRoot))?.id).toBe(entry.workspaceId)
    expect((await ctx.xiaojingFinanceDomain.workspaces()).consultations).toEqual([entry])
    const finance = agent(ctx, 'finance-custom-consultation', 'finance', consultationRoot)
    expect(await ctx.xiaojingFinanceDomain.promptContext(finance)).toContain('未绑定任何客户')
    await dispose()
  })

  it('persists Finance workspace rename and list removal without deleting clients or registrations', async () => {
    const { ctx, financeRoot, standardRoot, workspaces, dispose } = await mounted()
    const consultationRoot = join(financeRoot, '专项咨询')
    await mkdir(consultationRoot, { recursive: true })
    const consultation = await ctx.xiaojingFinanceDomain.addConsultationWorkspace({ path: consultationRoot })
    const created = await createClient(ctx, financeRoot, 0, '客户甲有限公司', '上海市')
    const before = await ctx.xiaojingFinanceDomain.workspaces()
    const client = before.clients[0]
    expect(client).toBeDefined()

    await ctx.xiaojingFinanceDomain.renameWorkspace({
      workspaceId: consultation.workspaceId,
      title: '税务专项',
    })
    await ctx.xiaojingFinanceDomain.renameWorkspace({
      workspaceId: client!.workspaceId,
      title: '甲公司工作区',
    })
    const renamed = await ctx.xiaojingFinanceDomain.workspaces()
    expect(renamed.consultations[0]?.title).toBe('税务专项')
    expect(renamed.clients[0]?.title).toBe('甲公司工作区')
    expect(workspaces.byPath.get(resolve(consultationRoot))?.title).toBe('税务专项')
    expect(workspaces.byPath.get(resolve(created.client.workspacePath))?.title).toBe('甲公司工作区')

    await ctx.xiaojingFinanceDomain.removeWorkspace({ workspaceId: renamed.standard.workspaceId })
    await ctx.xiaojingFinanceDomain.removeWorkspace({ workspaceId: client!.workspaceId })
    const removed = await ctx.xiaojingFinanceDomain.workspaces()
    expect(removed.listedWorkspaceIds).not.toContain(renamed.standard.workspaceId)
    expect(removed.listedWorkspaceIds).not.toContain(client!.workspaceId)
    expect(removed.listedWorkspaceIds).toContain(consultation.workspaceId)
    expect(workspaces.byPath.get(resolve(standardRoot))?.id).toBe(renamed.standard.workspaceId)
    expect(workspaces.byPath.get(resolve(created.client.workspacePath))?.id).toBe(client!.workspaceId)
    expect((await ctx.xiaojingFinanceDomain.read(created.client.id)).client.status).toBe('active')

    await expect(ctx.xiaojingFinanceDomain.removeWorkspace({
      workspaceId: consultation.workspaceId,
    })).rejects.toThrow(/at least one consultation workspace/)
    const restoredClient = await ctx.xiaojingFinanceDomain.restoreClientWorkspace({
      path: created.client.workspacePath,
    })
    expect(restoredClient?.workspaceId).toBe(client!.workspaceId)
    expect((await ctx.xiaojingFinanceDomain.workspaces()).listedWorkspaceIds).toContain(client!.workspaceId)
    await dispose()
  })

  it('keeps one consultation listed when two windows remove different consultation workspaces concurrently', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const consultationRoot = join(financeRoot, '并发咨询')
    await mkdir(consultationRoot, { recursive: true })
    const consultation = await ctx.xiaojingFinanceDomain.addConsultationWorkspace({ path: consultationRoot })
    const standard = (await ctx.xiaojingFinanceDomain.workspaces()).standard

    const results = await Promise.allSettled([
      ctx.xiaojingFinanceDomain.removeWorkspace({ workspaceId: standard.workspaceId }),
      ctx.xiaojingFinanceDomain.removeWorkspace({ workspaceId: consultation.workspaceId }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const remaining = await ctx.xiaojingFinanceDomain.workspaces()
    const consultationIds = [remaining.standard, ...remaining.consultations]
      .map(entry => entry.workspaceId)
    expect(remaining.listedWorkspaceIds.filter(id => consultationIds.includes(id))).toHaveLength(1)
    await dispose()
  })

  it('locks context selection as soon as the first turn starts', async () => {
    const { ctx, financeRoot, standardRoot, dispose } = await mounted()
    const created = await createClient(ctx, financeRoot, 0, '甲公司', '上海市')
    const finance = agent(ctx, 'finance-started', 'finance', standardRoot)
    finance.session.append('turn/start', { turn: 1 })

    await expect(ctx.xiaojingFinanceDomain.stage(finance, { mode: 'general' })).rejects.toThrow(/locked/)
    await expect(ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: created.client.id,
    })).rejects.toThrow(/locked/)
    await dispose()
  })

  it('reopens a blank session already bound to the same client without allowing reassignment', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const first = await createClient(ctx, financeRoot, 0, 'First Company', 'Shanghai')
    const second = await createClient(ctx, financeRoot, 1, 'Second Company', 'Beijing')
    const finance = agent(ctx, 'finance-bound-blank', 'finance', first.client.workspacePath)

    await ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: first.client.id,
    })
    await ctx.xiaojingFinanceDomain.promptContext(finance)
    expect(finance.session.snapshotEvents().some(event => event.type === 'turn/start')).toBe(false)

    await expect(ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: first.client.id,
    })).resolves.toMatchObject({
      state: 'bound',
      locked: true,
      clientName: first.client.shortName ?? first.client.legalName,
    })
    await expect(ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: second.client.id,
    })).rejects.toThrow(/locked/)
    await expect(ctx.xiaojingFinanceDomain.stage(finance, { mode: 'general' })).rejects.toThrow(/locked/)
    await dispose()
  })

  it('stages in memory and locks an immutable client snapshot before model use', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const created = await createClient(ctx, financeRoot, 0, '甲公司', '上海市')
    const clientRoot = created.client.workspacePath
    const finance = agent(ctx, 'finance-bound', 'finance', clientRoot)

    expect(await ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: created.client.id,
    })).toMatchObject({ state: 'ready', clientName: '甲公' })
    expect(finance.session.snapshotEvents().some(event => event.type === 'finance/client-bound')).toBe(false)

    const prompt = await ctx.xiaojingFinanceDomain.promptContext(finance)
    expect(prompt).toContain('甲公司')
    expect(prompt).toContain('本会话只绑定客户，不绑定会计期间')
    const bindings = finance.session.snapshotEvents().filter(event => event.type === 'finance/client-bound')
    expect(bindings).toHaveLength(1)
    expect(bindings[0]?.type === 'finance/client-bound' && bindings[0].data.clientVersion).toBe(1)
    expect(ctx.sessionProjections.snapshot(finance.session).values.financeClient)
      .toEqual({ state: 'bound', clientName: '甲公' })
    const binding = ctx.xiaojingFinanceDomain.requireBoundClient(finance)
    expect(ctx.xiaojingFinanceDomain.currentClientBinding(finance)).toEqual(binding)
    expect(ctx.xiaojingFinanceDomain.currentClientBinding(finance)).not.toBe(binding)
    const clientWorkspace = resolveFinanceClientWorkspace(binding, finance.session.id)
    await Promise.all([
      clientWorkspace.profileDirectory,
      clientWorkspace.policyDirectory,
      clientWorkspace.sourceDirectory,
      clientWorkspace.sessionWorkDirectory,
      clientWorkspace.outputDirectory,
      clientWorkspace.archiveDirectory,
    ].map(path => access(path)))
    const marker = await readFile(join(clientWorkspace.clientRoot, '.xiaojing-client.json'), 'utf8')
    expect(JSON.parse(marker)).toEqual({
      schemaVersion: 1,
      clientId: created.client.id,
      clientVersion: 1,
      displayName: '甲公',
    })
    expect(marker).not.toContain('上海市')
    expect(marker).not.toContain('甲公司专属政策')
    expect(JSON.parse(await readFile(
      join(clientWorkspace.sessionWorkDirectory, '会话信息.json'),
      'utf8',
    ))).toEqual({
      schemaVersion: 1,
      sessionId: finance.session.id,
      clientId: created.client.id,
      clientVersion: 1,
      clientName: '甲公',
    })

    const updated = await ctx.xiaojingFinanceDomain.update({
      clientId: created.client.id,
      expectedRevision: 1,
      client: draft('甲公司新名称', '北京市'),
    })
    expect(updated.client.version).toBe(2)
    expect(await ctx.xiaojingFinanceDomain.promptContext(finance)).toContain('上海市')
    expect(await ctx.xiaojingFinanceDomain.promptContext(finance)).not.toContain('北京市')
    await expect(ctx.xiaojingFinanceDomain.stage(finance, { mode: 'general' })).rejects.toThrow(/locked/)
    await dispose()
  })

  it('preserves an invalid session manifest instead of replacing it', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const created = await createClient(ctx, financeRoot, 0, '清单客户', '上海市')
    const finance = agent(ctx, 'finance-invalid-manifest', 'finance', created.client.workspacePath)
    await ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: created.client.id,
    })
    await ctx.xiaojingFinanceDomain.promptContext(finance)
    const binding = ctx.xiaojingFinanceDomain.requireBoundClient(finance)
    const manifestPath = join(
      resolveFinanceClientWorkspace(binding, finance.session.id).sessionWorkDirectory,
      '会话信息.json',
    )
    await writeFile(manifestPath, '{broken', 'utf8')

    await expect(ctx.xiaojingFinanceDomain.promptContext(finance)).rejects.toThrow(/cannot parse/)
    expect(await readFile(manifestPath, 'utf8')).toBe('{broken')
    await dispose()
  })

  it('imports uploads and copies final outputs and archives without removing their sources', async () => {
    const { ctx, financeRoot, uploadRoot, dispose } = await mounted()
    const created = await createClient(ctx, financeRoot, 0, '文件客户', '上海市')
    const finance = agent(ctx, 'finance-files', 'finance', created.client.workspacePath)
    await ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: created.client.id,
    })

    const uploadedPath = join(uploadRoot, 'upload-1.bin')
    await writeFile(uploadedPath, '原始凭证', 'utf8')
    const imported = await ctx.xiaojingFinanceDomain.importUpload(finance, {
      path: uploadedPath,
      originalName: '原始凭证.txt',
    })
    expect(imported).toMatchObject({ action: 'import', stage: 'source', name: '原始凭证.txt' })
    expect(imported.path).toBe(join(created.client.workspacePath, '02-原始资料', '原始凭证.txt'))
    expect(await readFile(imported.path, 'utf8')).toBe('原始凭证')
    expect(await readFile(uploadedPath, 'utf8')).toBe('原始凭证')

    const binding = ctx.xiaojingFinanceDomain.requireBoundClient(finance)
    const workspace = resolveFinanceClientWorkspace(binding, finance.session.id)
    const draftPath = join(workspace.sessionWorkDirectory, '月结报告.md')
    await writeFile(draftPath, '# 月结报告\n', 'utf8')
    const published = await ctx.xiaojingFinanceDomain.publishFile(finance, { sourcePath: draftPath })
    expect(published).toMatchObject({ action: 'publish', stage: 'output', name: '月结报告.md' })
    expect(published.path).toBe(join(workspace.outputDirectory, '月结报告.md'))
    expect(await readFile(draftPath, 'utf8')).toBe('# 月结报告\n')
    expect(await readFile(published.path, 'utf8')).toBe('# 月结报告\n')

    const archived = await ctx.xiaojingFinanceDomain.archiveFile(finance, { sourcePath: published.path })
    expect(archived).toMatchObject({
      action: 'archive',
      stage: 'archive',
      name: '月结报告.md',
      sourceFileId: published.id,
    })
    expect(archived.path).toContain(join(workspace.archiveDirectory, '20'))
    expect(await readFile(published.path, 'utf8')).toBe('# 月结报告\n')
    expect(await readFile(archived.path, 'utf8')).toBe('# 月结报告\n')

    const customDraftPath = join(workspace.sessionWorkDirectory, '指定归档.md')
    await writeFile(customDraftPath, '# 指定归档\n', 'utf8')
    const customPublished = await ctx.xiaojingFinanceDomain.publishFile(finance, { sourcePath: customDraftPath })
    const customArchived = await ctx.xiaojingFinanceDomain.archiveFile(finance, {
      sourcePath: customPublished.path,
      archiveFolder: '月结资料',
    })
    expect(customArchived.path).toBe(join(workspace.archiveDirectory, '月结资料', '指定归档.md'))
    expect(await readFile(customArchived.path, 'utf8')).toBe('# 指定归档\n')
    expect((await readdir(workspace.archiveDirectory, { recursive: true }))
      .filter(path => path.endsWith('指定归档.md'))).toEqual([join('月结资料', '指定归档.md')])
    await expect(ctx.xiaojingFinanceDomain.archiveFile(finance, {
      sourcePath: customPublished.path,
      archiveFolder: '..\\越界',
    })).rejects.toThrow(/one directory name/u)
    expect(finance.session.snapshotEvents().map(event => event.type)).toEqual(expect.arrayContaining([
      'finance/client-bound',
      'finance/file-imported',
      'finance/file-published',
      'finance/file-archived',
    ]))
    const prompt = await ctx.xiaojingFinanceDomain.promptContext(finance)
    expect(prompt).toContain(imported.path)
    expect(prompt).toContain(published.path)
    expect(prompt).toContain(archived.path)
    await dispose()
  })

  it('uploads only unchanged invoice originals imported into the calling session', async () => {
    const { ctx, financeRoot, uploadRoot, dispose } = await mounted()
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    try {
      const created = await createClient(ctx, financeRoot, 0, '附件隔离', '上海市')
      const first = agent(ctx, 'attachment-first', 'finance', created.client.workspacePath)
      const second = agent(ctx, 'attachment-second', 'finance', created.client.workspacePath)
      for (const current of [first, second]) {
        await ctx.xiaojingFinanceDomain.stage(current, { mode: 'client', clientId: created.client.id })
        await ctx.xiaojingFinanceDomain.promptContext(current)
      }
      const storage = await ctx.xiaojingFinanceDomain.readAttachmentStorage()
      await ctx.xiaojingFinanceDomain.saveAttachmentStorage({ expectedRevision: storage.revision, config: storage.config,
        accessKeyId: 'fixtureKey123', accessKeySecret: 'fixtureSecret123' })
      const source = join(uploadRoot, 'invoice-upload.bin')
      const bytes = Buffer.from('%PDF-1.4\nfixture invoice\n%%EOF\n')
      await writeFile(source, bytes)
      const imported = await ctx.xiaojingFinanceDomain.importUpload(first, { path: source, originalName: 'invoice.pdf' })
      const signal = new AbortController().signal
      await expect(ctx.xiaojingFinanceDomain.uploadFinanceAttachment(second, imported.path, signal)).rejects.toThrow('本会话')
      await expect(ctx.xiaojingFinanceDomain.uploadFinanceAttachment(first, source, signal)).rejects.toThrow('本会话')
      expect(fetcher).not.toHaveBeenCalled()
      const receipt = await ctx.xiaojingFinanceDomain.uploadFinanceAttachment(first, imported.name, signal)
      expect(receipt).toMatchObject({ name: 'invoice.pdf', size: bytes.length })
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(await readFile(imported.path)).toEqual(bytes)
      await writeFile(imported.path, Buffer.from('%PDF-1.4\nchanged invoice\n%%EOF\n'))
      await expect(ctx.xiaojingFinanceDomain.uploadFinanceAttachment(first, imported.path, signal)).rejects.toThrow('已变更')
      await writeFile(source, 'not a PDF')
      const invalid = await ctx.xiaojingFinanceDomain.importUpload(first, { path: source, originalName: 'invalid.pdf' })
      await expect(ctx.xiaojingFinanceDomain.uploadFinanceAttachment(first, invalid.path, signal)).rejects.toThrow('格式不符')
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally { await dispose() }
  })

  it('rejects upload and publication paths outside the selected client and preserves a corrupt index', async () => {
    const { ctx, financeRoot, uploadRoot, dispose } = await mounted()
    const first = await createClient(ctx, financeRoot, 0, '甲文件客户', '上海市')
    const second = await createClient(ctx, financeRoot, 1, '乙文件客户', '北京市')
    const finance = agent(ctx, 'finance-file-isolation', 'finance', first.client.workspacePath)
    await ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: first.client.id,
    })
    const outsideUpload = join(financeRoot, 'outside-upload.txt')
    await writeFile(outsideUpload, 'outside', 'utf8')
    await expect(ctx.xiaojingFinanceDomain.importUpload(finance, {
      path: outsideUpload,
      originalName: 'outside.txt',
    })).rejects.toThrow(/uploaded file must stay inside/)

    await ctx.xiaojingFinanceDomain.promptContext(finance)
    const otherClientFile = join(second.client.workspacePath, '03-会话作业', 'other.txt')
    await mkdir(join(second.client.workspacePath, '03-会话作业'), { recursive: true })
    await writeFile(otherClientFile, 'other', 'utf8')
    await expect(ctx.xiaojingFinanceDomain.publishFile(finance, {
      sourcePath: otherClientFile,
    })).rejects.toThrow(/published file must stay inside/)

    const validUpload = join(uploadRoot, 'valid.txt')
    await writeFile(validUpload, 'valid', 'utf8')
    await ctx.xiaojingFinanceDomain.importUpload(finance, {
      path: validUpload,
      originalName: 'valid.txt',
    })
    const indexPath = join(first.client.workspacePath, '.xiaojing-finance-files-v1.json')
    await writeFile(indexPath, '{broken', 'utf8')
    const secondUpload = join(uploadRoot, 'second.txt')
    await writeFile(secondUpload, 'second', 'utf8')
    await expect(ctx.xiaojingFinanceDomain.importUpload(finance, {
      path: secondUpload,
      originalName: 'second.txt',
    })).rejects.toThrow(/cannot parse/)
    expect(await readFile(indexPath, 'utf8')).toBe('{broken')
    await expect(access(join(first.client.workspacePath, '02-原始资料', 'second.txt'))).rejects.toThrow()
    await dispose()
  })

  it('keeps two client prompts and projections isolated', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const first = await createClient(ctx, financeRoot, 0, '甲公司', '上海市')
    const second = await createClient(ctx, financeRoot, 1, '乙公司', '北京市')
    const a = agent(ctx, 'finance-a', 'finance', first.client.workspacePath)
    const b = agent(ctx, 'finance-b', 'finance', second.client.workspacePath)
    await ctx.xiaojingFinanceDomain.stage(a, {
      mode: 'client', clientId: first.client.id,
    })
    await ctx.xiaojingFinanceDomain.stage(b, {
      mode: 'client', clientId: second.client.id,
    })
    const [aPrompt, bPrompt] = await Promise.all([
      ctx.xiaojingFinanceDomain.promptContext(a),
      ctx.xiaojingFinanceDomain.promptContext(b),
    ])
    expect(aPrompt).toContain('甲公司')
    expect(aPrompt).not.toContain('乙公司')
    expect(bPrompt).toContain('乙公司')
    expect(bPrompt).not.toContain('甲公司')
    const aBinding = ctx.xiaojingFinanceDomain.requireBoundClient(a)
    const bBinding = ctx.xiaojingFinanceDomain.requireBoundClient(b)
    expect(aBinding.client.legalName).toBe('甲公司')
    expect(bBinding.client.legalName).toBe('乙公司')
    expect(a.session.snapshotEvents().filter(event => event.type === 'finance/client-bound')).toHaveLength(1)
    expect(b.session.snapshotEvents().filter(event => event.type === 'finance/client-bound')).toHaveLength(1)
    expect(resolveFinanceClientWorkspace(aBinding, a.session.id).sessionWorkDirectory)
      .not.toBe(resolveFinanceClientWorkspace(aBinding, b.session.id).sessionWorkDirectory)
    await dispose()
  })

  it('refuses to bind one customer while the Session belongs to another customer Workspace', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const first = await createClient(ctx, financeRoot, 0, '甲公司', '上海市')
    const second = await createClient(ctx, financeRoot, 1, '乙公司', '北京市')
    const wrongWorkspace = agent(
      ctx,
      'finance-cross-client',
      'finance',
      second.client.workspacePath,
    )
    await expect(ctx.xiaojingFinanceDomain.stage(wrongWorkspace, {
      mode: 'client',
      clientId: first.client.id,
    })).rejects.toThrow(/does not match the Session workspace/)
    expect(wrongWorkspace.session.snapshotEvents().some(event => event.type === 'finance/client-bound')).toBe(false)
    await dispose()
  })

  it('restores the immutable binding and safe projection from session events', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const created = await createClient(ctx, financeRoot, 0, '历史公司', '杭州市')
    const clientRoot = created.client.workspacePath
    const original = agent(ctx, 'finance-original', 'finance', clientRoot)
    await ctx.xiaojingFinanceDomain.stage(original, {
      mode: 'client', clientId: created.client.id,
    })
    const originalPrompt = await ctx.xiaojingFinanceDomain.promptContext(original)
    const restoredSession = ctx.sessions.create(SessionId('finance-restored'), {
      seed: [...original.session.snapshotEvents()],
      meta: { agentPreset: 'finance', cwd: clientRoot },
    })
    const restored = agentForSession(ctx, restoredSession)

    expect(await ctx.xiaojingFinanceDomain.sessionContext(restored)).toEqual({
      state: 'bound', locked: true, clientName: '历史',
    })
    const restoredPrompt = await ctx.xiaojingFinanceDomain.promptContext(restored)
    expect(restoredPrompt).toContain('历史公司')
    expect(restoredPrompt).toContain('不绑定会计期间')
    expect(restoredPrompt).not.toBe(originalPrompt)
    expect(ctx.sessionProjections.snapshot(restored.session).values.financeClient)
      .toEqual({ state: 'bound', clientName: '历史' })
    await dispose()
  })

  it('does not create client directories for standard consultation', async () => {
    const { ctx, financeRoot, standardRoot, dispose } = await mounted()
    const finance = agent(ctx, 'finance-standard-workspace', 'finance', standardRoot)
    await ctx.xiaojingFinanceDomain.promptContext(finance)
    expect(await readdir(financeRoot)).toEqual(['标准咨询'])
    await dispose()
  })

  it('preserves a conflicting client marker and refuses to bind the session', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const created = await createClient(ctx, financeRoot, 0, '冲突公司', '南京市')
    const clientRoot = created.client.workspacePath
    const finance = agent(ctx, 'finance-marker-conflict', 'finance', clientRoot)
    const binding = {
      schemaVersion: 1 as const,
      clientVersion: created.client.version,
      client: created.client,
      workspacePath: clientRoot,
    }
    const layout = resolveFinanceClientWorkspace(binding, finance.session.id)
    const markerPath = join(layout.clientRoot, '.xiaojing-client.json')
    await mkdir(layout.clientRoot, { recursive: true })
    const conflict = '{"schemaVersion":1,"clientId":"11111111-1111-4111-8111-111111111111","clientVersion":1,"displayName":"其他客户"}\n'
    await writeFile(markerPath, conflict, 'utf8')

    await expect(ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: created.client.id,
    })).rejects.toThrow(/belongs to another client/)
    expect(await readFile(markerPath, 'utf8')).toBe(conflict)
    expect(finance.session.snapshotEvents().some(event => event.type === 'finance/client-bound')).toBe(false)
    await dispose()
  })

  it('rejects standard sessions and archived clients for new bindings', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const created = await createClient(ctx, financeRoot, 0, '归档公司', '深圳市')
    const standard = agent(ctx, 'standard-session', 'standard')
    await expect(ctx.xiaojingFinanceDomain.stage(standard, { mode: 'general' })).rejects.toThrow(/only in the Finance preset/)
    expect(await ctx.xiaojingFinanceDomain.sessionContext(standard)).toEqual({ state: 'not-finance', locked: true })

    await ctx.xiaojingFinanceDomain.archive({ clientId: created.client.id, expectedRevision: 1 })
    const finance = agent(
      ctx,
      'finance-archive',
      'finance',
      created.client.workspacePath,
    )
    await expect(ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: created.client.id,
    })).rejects.toThrow(/archived clients/)
    await dispose()
  })
})
