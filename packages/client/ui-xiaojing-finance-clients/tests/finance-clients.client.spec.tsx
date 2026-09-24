// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LayoutController } from '@deepseek-ai/dsh-client-ui-layout/client'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Context, Service } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot as WorkspaceListState } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { ConversationEventRegistry } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { WorkspaceCategoryRegistry } from '@deepseek-ai/dsh-client-ui-workspace/client'
import {
  FinanceClientId,
  type FinanceClientListView,
  type FinanceYouchengAccountsResult,
  type ListFinanceYouchengAccountsRequest,
  type FinanceWorkspaceListView,
  type StageFinanceClientRequest,
} from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import { apply, inject } from '../src/client/index.ts'
import { FinanceClientsController, type FinanceClientsRemote } from '../src/client/controller.ts'
import {
  FinanceClientsSection,
  type EditorState,
  type FinanceClientsSectionProps,
} from '../src/client/FinanceClientsSection.tsx'
import {
  FinanceHeroContext,
  type FinanceHeroContextProps,
} from '../src/client/FinanceHeroContext.tsx'
import { zh } from '../src/client/locales.ts'

const clientId = FinanceClientId('6ba7b810-9dad-11d1-80b4-00c04fd430c8')
const archivedId = FinanceClientId('6ba7b811-9dad-11d1-80b4-00c04fd430c8')
const sessionId = 'finance-blank' as SessionId
const catalog: FinanceClientListView = {
  revision: 2,
  clients: [
    {
      id: clientId,
      legalName: '上海数豆科技有限公司',
      shortName: '数豆科技',
      taxpayerType: 'general-vat',
      registeredRegion: '上海市',
      accountingStandard: 'enterprise',
      version: 2,
      status: 'active',
    },
    {
      id: archivedId,
      legalName: '历史客户有限公司',
      taxpayerType: 'small-scale-vat',
      registeredRegion: '北京市',
      accountingStandard: 'small-enterprise',
      version: 3,
      status: 'archived',
    },
  ],
}

const financeWorkspaces: FinanceWorkspaceListView = {
  workspaceRoot: '/finance',
  standard: {
    kind: 'standard', workspaceId: 'finance-standard' as never, title: '咨询', startable: true,
  },
  consultations: [],
  clients: [
    {
      kind: 'client', clientId, workspaceId: 'finance-client' as never,
      title: '数豆科技', startable: true,
    },
    {
      kind: 'client', clientId: archivedId, workspaceId: 'finance-archived' as never,
      title: '历史客户有限公司', startable: false,
    },
  ],
  listedWorkspaceIds: [
    'finance-standard' as never,
    'finance-client' as never,
    'finance-archived' as never,
  ],
}

const t = (key: keyof typeof zh): string => zh[key]

function ok<T>(value: T) {
  return Promise.resolve({ ok: true as const, value })
}

function remote(overrides: Partial<FinanceClientsRemote> = {}): FinanceClientsRemote {
  const unused = vi.fn(() => Promise.reject(new Error('unused Remote method')))
  return {
    list: vi.fn(() => ok(catalog)),
    workspaces: vi.fn(() => ok(financeWorkspaces)),
    addConsultationWorkspace: unused,
    renameWorkspace: unused,
    removeWorkspace: unused,
    restoreClientWorkspace: unused,
    read: unused,
    checkConnection: unused,
    listYouchengAccounts: unused,
    create: unused,
    update: unused,
    archive: unused,
    stage: unused,
    sessionContext: unused,
    importUpload: unused,
    ...overrides,
  }
}

class DynamicRemoteService extends Service {
  readonly $host = { isLoopback: true }
  constructor(
    ctx: Context,
    private readonly financeClients: FinanceClientsRemote,
    private readonly unmounted: () => void,
  ) {
    super(ctx, 'remote')
  }

  async $mount(): Promise<() => Promise<void>> {
    const namespace = this.ctx.plugin({
      name: 'test-finance-clients-remote',
      apply: (ctx: Context) => { ctx.provide('remote.financeClients', this.financeClients) },
    })
    await namespace
    const dispose = async (): Promise<void> => {
      this.unmounted()
      await namespace.dispose()
    }
    this.ctx.effect(() => dispose, 'test Finance Remote namespace')
    return dispose
  }
}

const navigationContexts: Context[] = []

function provideNavigation(ctx: Context): LayoutController {
  navigationContexts.push(ctx)
  const layout = new LayoutController({
    selectPanel: vi.fn(), retainMainPanels: vi.fn(),
    setSidebar: vi.fn(), toggleSidebar: vi.fn(), setViewportWidth: vi.fn(),
    setRightbar: vi.fn(), openRightbar: vi.fn(), closeRightbar: vi.fn(),
  }, () => true)
  ctx.provide('layout', layout)
  ctx.effect(() => () => { layout.dispose() })
  return layout
}

afterEach(async () => {
  cleanup()
  for (const ctx of navigationContexts.splice(0)) await ctx.fiber.dispose()
  vi.unstubAllEnvs()
})

describe('FinanceClientsController', () => {
  it('connects saved settings once, reports failure, and retries without saving or staging', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<FinanceClientsRemote['checkConnection']>>>()
    const api = remote({
      checkConnection: vi.fn().mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce({ ok: true, value: { state: 'failed', accountId: '35581', failure: 'account-unavailable' } })
        .mockResolvedValueOnce({ ok: true, value: { state: 'connected', accountId: '35581', accountName: '数豆演示' } }),
    })
    const controller = new FinanceClientsController(api)
    await controller.load()
    const checking = controller.checkConnection(clientId)
    await controller.checkConnection(clientId)
    expect(api.checkConnection).toHaveBeenCalledExactlyOnceWith(clientId)
    expect(controller.store.getSnapshot().workspaces?.clients[0]?.connection?.state).toBe('checking')
    pending.reject(new Error('transport lost'))
    await checking
    expect(controller.store.getSnapshot().workspaces?.clients[0]?.connection).toMatchObject({ state: 'failed', failure: 'network' })
    await controller.checkConnection(clientId)
    expect(controller.store.getSnapshot().workspaces?.clients[0]?.connection?.state).toBe('failed')
    await controller.checkConnection(clientId)
    expect(controller.store.getSnapshot().workspaces?.clients[0]?.connection).toMatchObject({ state: 'connected', accountName: '数豆演示', accountId: '35581' })
    expect(controller.store.getSnapshot().workspaces?.clients[1]?.connection).toBeUndefined()
    expect(api.update).not.toHaveBeenCalled()
    expect(api.create).not.toHaveBeenCalled()
    expect(api.stage).not.toHaveBeenCalled()
  })

  it('discards an old connection response after the Host state reloads', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<FinanceClientsRemote['checkConnection']>>>()
    const api = remote({ checkConnection: vi.fn(() => pending.promise) })
    const controller = new FinanceClientsController(api)
    await controller.load()
    const checking = controller.checkConnection(clientId)
    controller.resetSessionContexts()
    await controller.load()
    pending.resolve({ ok: true, value: { state: 'connected', accountId: '35581', accountName: '旧连接' } })
    await checking
    expect(controller.store.getSnapshot().workspaces?.clients[0]?.connection).toBeUndefined()
  })

  it.each([
    { checkStartsFirst: true, listFinishesFirst: true },
    { checkStartsFirst: true, listFinishesFirst: false },
    { checkStartsFirst: false, listFinishesFirst: true },
    { checkStartsFirst: false, listFinishesFirst: false },
  ])('preserves overlapping connection and list responses: %j', async ({ checkStartsFirst, listFinishesFirst }) => {
    const result = { state: 'connected' as const, accountId: '35581', accountName: '演示账套' }
    const pending = Promise.withResolvers<Awaited<ReturnType<FinanceClientsRemote['checkConnection']>>>()
    const list = Promise.withResolvers<Awaited<ReturnType<FinanceClientsRemote['workspaces']>>>()
    const api = remote({ checkConnection: vi.fn(() => pending.promise) })
    const controller = new FinanceClientsController(api)
    await controller.load()
    vi.mocked(api.workspaces).mockReturnValueOnce(list.promise)
    const [checking, refreshing] = checkStartsFirst
      ? [controller.checkConnection(clientId), controller.load()]
      : [undefined, controller.load()]
    const check = checking ?? controller.checkConnection(clientId)
    if (listFinishesFirst) {
      list.resolve({ ok: true, value: financeWorkspaces })
      await refreshing
      expect(controller.store.getSnapshot().workspaces?.clients[0]?.connection?.state).toBe('checking')
    }
    pending.resolve({ ok: true, value: result })
    await check
    if (!listFinishesFirst) {
      list.resolve({ ok: true, value: financeWorkspaces })
      await refreshing
    }
    expect(controller.store.getSnapshot().workspaces?.clients[0]?.connection).toEqual(result)
    // A later, non-overlapping refresh remains authoritative.
    await controller.load()
    expect(controller.store.getSnapshot().workspaces?.clients[0]?.connection).toBeUndefined()
  })

  it('does not restore an old ledger result after the saved record changes', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<FinanceClientsRemote['checkConnection']>>>()
    const api = remote({ checkConnection: vi.fn(() => pending.promise) })
    const controller = new FinanceClientsController(api)
    await controller.load()
    const checking = controller.checkConnection(clientId)
    vi.mocked(api.list).mockResolvedValueOnce({ ok: true, value: { ...catalog,
      clients: catalog.clients.map(client => ({ ...client, version: client.version + 1 })),
    } })
    await controller.load()
    pending.resolve({ ok: true, value: { state: 'connected', accountId: 'old-ledger', accountName: '旧账套' } })
    await checking
    expect(controller.store.getSnapshot().workspaces?.clients[0]?.connection).toBeUndefined()
  })

  it('refreshes the displayed context after successful staging but not after failure', async () => {
    const context = { state: 'general' as const, locked: false as const }
    const api = remote({ stage: vi.fn().mockResolvedValueOnce({ ok: true, value: context })
      .mockResolvedValueOnce({ ok: false, error: { message: 'staging failed' } }) })
    const controller = new FinanceClientsController(api)
    expect(await controller.stage(sessionId, { mode: 'general' })).toEqual(context)
    expect(controller.store.getSnapshot().contextEpoch).toBe(1)
    await expect(controller.stage(sessionId, { mode: 'client', clientId })).rejects.toThrow('staging failed')
    expect(controller.store.getSnapshot().contextEpoch).toBe(1)
    expect(api.list).not.toHaveBeenCalled()
  })

  it('forwards ledger discovery without refreshing or saving the catalog', async () => {
    const api = remote({ listYouchengAccounts: vi.fn(() => ok({ state: 'ready' as const, accounts: [] })) })
    const controller = new FinanceClientsController(api)
    const request = { clientId, expectedRevision: 2, environment: 'test' as const, appKey: 'fake-key' }
    expect(await controller.listYouchengAccounts(request)).toEqual({ state: 'ready', accounts: [] })
    expect(api.listYouchengAccounts).toHaveBeenCalledWith(request)
    expect(api.list).not.toHaveBeenCalled()
    expect(api.update).not.toHaveBeenCalled()
  })

  it('keeps a committed save successful when the separate connection check fails', async () => {
    const client = {
      id: clientId, legalName: '数豆科技', taxpayerType: 'general-vat' as const,
      registeredRegion: '苏州', accountingStandard: 'enterprise' as const,
      chartMappings: [], externalSystemRefs: [], version: 3, status: 'active' as const,
      workspacePath: 'E:/Finance/test', createdAt: 1, updatedAt: 2,
      financeSystem: { system: 'youcheng' as const, environment: 'test' as const, appKey: 'fake-key', accountCode: '35581' },
    }
    const api = remote({
      update: vi.fn(() => ok({ revision: 3, client })),
      checkConnection: vi.fn(() => Promise.reject(new Error('transport lost'))),
    })
    const controller = new FinanceClientsController(api)
    expect(await controller.update({ clientId, expectedRevision: 2, client })).toEqual({ revision: 3, client })
    expect(api.checkConnection).toHaveBeenCalledWith(clientId)
    expect(controller.store.getSnapshot().workspaces?.clients[0]?.connection?.state).toBe('failed')
    expect(controller.store.getSnapshot().error).toBeNull()
    expect(api.update).toHaveBeenCalledOnce()
  })

  it('keeps the newest list response and invalidates Host-memory staging on reconnect', async () => {
    let releaseFirst!: (value: Awaited<ReturnType<FinanceClientsRemote['list']>>) => void
    const first = new Promise<Awaited<ReturnType<FinanceClientsRemote['list']>>>((resolve) => { releaseFirst = resolve })
    const newer = { revision: 3, clients: catalog.clients }
    const api = remote({
      list: vi.fn()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce({ ok: true, value: newer }),
    })
    const controller = new FinanceClientsController(api)
    const older = controller.load()
    await controller.load()
    releaseFirst({ ok: true, value: catalog })
    await older
    expect(controller.store.getSnapshot().catalog.revision).toBe(3)

    controller.resetSessionContexts()
    expect(controller.store.getSnapshot().contextEpoch).toBe(1)
    expect(controller.store.getSnapshot().catalog.revision).toBe(3)
  })

  it('surfaces typed Remote failures without discarding the last catalog', async () => {
    const api = remote({ list: vi.fn().mockResolvedValue({ ok: false, error: { message: 'revision unavailable' } }) })
    const controller = new FinanceClientsController(api)
    controller.store.set({
      status: 'ready', catalog, workspaces: financeWorkspaces, error: null,
      clientCreation: null, contextEpoch: 0,
    })
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'error',
      catalog: { revision: 2 },
      error: 'revision unavailable',
    })
  })

  it('imports a prepared local upload and invalidates the displayed session context', async () => {
    const imported = {
      id: '6ba7b812-9dad-11d1-80b4-00c04fd430c8' as never,
      clientId,
      sessionId,
      action: 'import' as const,
      stage: 'source' as const,
      path: 'E:/Finance/数豆科技/02-原始资料/凭证.pdf',
      name: '凭证.pdf',
      sha256: 'a'.repeat(64),
      size: 12,
      createdAt: 1,
    }
    const importUpload = vi.fn(() => ok(imported))
    const controller = new FinanceClientsController(remote({ importUpload }))
    expect(await controller.importUpload(sessionId, {
      path: 'E:/uploads/random.bin',
      originalName: '凭证.pdf',
    })).toEqual(imported)
    expect(importUpload).toHaveBeenCalledWith(sessionId, {
      path: 'E:/uploads/random.bin',
      originalName: '凭证.pdf',
    })
    expect(controller.store.getSnapshot().contextEpoch).toBe(1)
  })
})

describe('Finance hero client context', () => {
  function renderHero(options: {
    preset?: string
    blank?: boolean
    catalog?: FinanceClientListView
    sessionContext?: ReturnType<typeof vi.fn>
    stage?: ReturnType<typeof vi.fn>
  } = {}) {
    const sessions = createSnapshotStore({
      byId: {
        [sessionId]: {
          id: sessionId,
          projectionValues: { agentPreset: options.preset ?? 'finance' },
          blank: options.blank ?? true,
        },
      },
    })
    const initialCatalog = options.catalog ?? catalog
    const clients = createSnapshotStore({
      status: 'ready' as const,
      catalog: initialCatalog,
      workspaces: financeWorkspaces,
      error: null,
      clientCreation: null,
      contextEpoch: 0,
    })
    const sessionContext = options.sessionContext ?? vi.fn(() => ok({ state: 'general' as const, locked: false as const }).then(result => result.value))
    const stage = options.stage ?? vi.fn(async (_id: SessionId, request: StageFinanceClientRequest) => {
      if (request.mode === 'general') return { state: 'general' as const, locked: false as const }
      return {
        state: 'ready' as const,
        locked: false as const,
        clientId: request.clientId,
        clientName: clients.getSnapshot().catalog.clients.find(client => client.id === request.clientId)?.shortName ?? '客户帐套',
      }
    })
    const setBlocked = vi.fn()
    const runtime = {
      sessionId,
      useSessions: bindSnapshotSelector(sessions),
      useWorkspaces: (() => { throw new Error('unused workspace hook') }) as never,
      useFinanceClients: bindSnapshotSelector(clients),
      loadClients: vi.fn(() => Promise.resolve()),
      sessionContext,
      stage,
      setBlocked,
      t,
    }
    const view = render(<FinanceHeroContext {...runtime as FinanceHeroContextProps} />)
    return { sessions, clients, sessionContext, stage, setBlocked, view }
  }

  it('defaults to consultation and reveals a client selector on demand', async () => {
    const bench = renderHero()
    const mode = await screen.findByRole('button', { name: '选择咨询模式' })
    expect(mode.textContent).toContain('咨询')
    expect(screen.queryByRole('button', { name: '选择账套' })).toBeNull()
    await waitFor(() => { expect(bench.setBlocked).toHaveBeenLastCalledWith(sessionId, undefined) })

    fireEvent.click(mode)
    fireEvent.click(await screen.findByRole('menuitem', { name: '账套' }))
    const client = await screen.findByRole('button', { name: '选择账套' })
    await waitFor(() => { expect(bench.setBlocked).toHaveBeenLastCalledWith(sessionId, zh.clientRequired) })

    fireEvent.click(client)
    expect(await screen.findByRole('menuitem', { name: '数豆科技' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '历史客户有限公司' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '数豆科技' }))
    await waitFor(() => {
      expect(bench.stage).toHaveBeenCalledWith(sessionId, { mode: 'client', clientId })
    })
    await waitFor(() => {
      expect(bench.setBlocked).toHaveBeenLastCalledWith(sessionId, undefined)
    })

    fireEvent.click(screen.getByRole('button', { name: '选择咨询模式' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '咨询' }))
    await waitFor(() => { expect(bench.stage).toHaveBeenLastCalledWith(sessionId, { mode: 'general' }) })
    expect(screen.queryByRole('button', { name: '选择账套' })).toBeNull()
  })

  it('distinguishes same-name customers by ledger and retains the selected ledger label', async () => {
    const bench = renderHero({ catalog: { revision: 2, clients: [catalog.clients[0]!, {
      ...catalog.clients[0]!, id: archivedId,
    }] } })
    await act(async () => {
      bench.clients.update((state) => {
        state.workspaces.clients = [
          { ...financeWorkspaces.clients[0]!, connection: { state: 'connected', accountId: '21563', accountName: '荷花演示账套' } },
          { ...financeWorkspaces.clients[1]!, startable: true, connection: { state: 'connected', accountId: '35601', accountName: '数豆测试帐套勿删' } },
        ]
      })
    })
    fireEvent.click(await screen.findByRole('button', { name: '选择咨询模式' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '账套' }))
    fireEvent.click(await screen.findByRole('button', { name: '选择账套' }))
    expect(await screen.findByRole('menuitem', { name: '数豆科技-荷花演示账套-ID 21563' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('menuitem', { name: '数豆科技-数豆测试帐套勿删-ID 35601' }))
    await waitFor(() => { expect(bench.stage).toHaveBeenCalledWith(sessionId, { mode: 'client', clientId: archivedId }) })
    await waitFor(() => { expect(screen.getByRole('button', { name: '选择账套' }).title).toContain('ID 35601') })
    await act(async () => {
      bench.clients.update((state) => {
        state.workspaces.clients[1]!.connection = { state: 'unverified', accountId: '35601' }
      })
    })
    expect(screen.getByRole('button', { name: '选择账套' }).textContent).toContain('ID 35601')
    expect(screen.getByRole('button', { name: '选择账套' }).textContent).not.toContain('数豆测试帐套勿删')
  })

  it('shows an immutable client binding on a blank session without blocking input', async () => {
    const bench = renderHero({
      sessionContext: vi.fn().mockResolvedValue({
        state: 'bound', locked: true, clientName: '瑞华云',
      }),
    })

    const mode = await screen.findByRole('button', { name: '选择咨询模式' })
    const client = await screen.findByRole('button', { name: '选择账套' })
    expect((mode as HTMLButtonElement).disabled).toBe(true)
    expect((client as HTMLButtonElement).disabled).toBe(true)
    expect(client.textContent).toContain('瑞华云')
    await waitFor(() => {
      expect(bench.setBlocked).toHaveBeenLastCalledWith(sessionId, undefined)
    })
  })

  it('keeps customer creation out of the hero selector', async () => {
    renderHero({ catalog: { revision: 0, clients: [] } })
    fireEvent.click(await screen.findByRole('button', { name: '选择咨询模式' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '账套' }))
    fireEvent.click(await screen.findByRole('button', { name: '选择账套' }))
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
    expect(screen.queryByText('新建账套')).toBeNull()
  })

  it('fails closed when the staged context cannot be read', async () => {
    const bench = renderHero({ sessionContext: vi.fn(() => Promise.reject(new Error('offline'))) })
    await screen.findByRole('button', { name: '选择咨询模式' })
    await waitFor(() => {
      expect(bench.setBlocked).toHaveBeenLastCalledWith(sessionId, `${zh.contextError}offline`)
    })
  })

  it('re-reads Host-memory context after reconnect and stays absent from other presets', async () => {
    const sessionContext = vi.fn()
      .mockResolvedValueOnce({ state: 'ready', locked: false, clientId, clientName: '数豆科技' })
      .mockResolvedValueOnce({ state: 'general', locked: false })
    const bench = renderHero({ sessionContext })
    expect((await screen.findByRole('button', { name: '选择账套' })).textContent).toContain('数豆科技')
    await act(async () => {
      bench.clients.update((state) => { state.contextEpoch += 1 })
    })
    await waitFor(() => { expect(sessionContext).toHaveBeenCalledTimes(2) })
    expect(screen.queryByRole('button', { name: '选择账套' })).toBeNull()

    await act(async () => {
      bench.sessions.update((state) => { state.byId[sessionId]!.projectionValues.agentPreset = 'standard' })
    })
    expect(screen.queryByLabelText('账套上下文')).toBeNull()
  })
})

describe('Finance client management', () => {
  function renderSection(financePolicyNotes?: string) {
    const clients = createSnapshotStore({
      status: 'ready' as const, catalog, workspaces: financeWorkspaces, error: null,
      clientCreation: null, contextEpoch: 0,
    })
    const actions = {
      load: vi.fn(() => Promise.resolve()),
      read: vi.fn(async () => ({
        revision: catalog.revision,
        youchengApiUrls: { test: 'https://cwdata.yiqiyun.com', production: 'https://cwdata.yiqiyun.com' },
        credentialStatus: {
          youchengAppSecretConfigured: false,
          youchengAppSecretWritable: true,
        },
        client: {
          id: clientId,
          version: 2,
          status: 'active' as const,
          workspacePath: 'E:/Finance/数豆科技',
          legalName: '上海数豆科技有限公司',
          shortName: '数豆科技',
          taxpayerType: 'general-vat' as const,
          registeredRegion: '上海市',
          accountingStandard: 'enterprise' as const,
          chartMappings: [],
          externalSystemRefs: [],
          ...financePolicyNotes === undefined ? {} : { financePolicyNotes },
          createdAt: 1,
          updatedAt: 2,
        },
      })),
      update: vi.fn((_editor: EditorState) => Promise.resolve()),
      listYouchengAccounts: vi.fn((_request: ListFinanceYouchengAccountsRequest): Promise<FinanceYouchengAccountsResult> =>
        Promise.resolve({ state: 'ready', accounts: [{ id: 'ACCT-001', name: '数豆测试账套' }] })),
      archive: vi.fn(() => Promise.resolve()),
    }
    render(<FinanceClientsSection {...({
      useFinanceClients: bindSnapshotSelector(clients),
      ...actions,
      t,
    } as FinanceClientsSectionProps)} />)
    return { clients, ...actions }
  }

  it('updates a taxpayer entity against the revision shown when editing began', async () => {
    const bench = renderSection()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    await screen.findByRole('heading', { name: zh.editTitle })
    fireEvent.change(screen.getByLabelText('主体全称'), { target: { value: '新客户有限公司' } })
    fireEvent.change(screen.getByLabelText('注册地区'), { target: { value: '浙江省杭州市' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => { expect(bench.update).toHaveBeenCalledOnce() })
    const editor = bench.update.mock.calls[0]?.[0]
    expect(editor?.expectedRevision).toBe(2)
    expect(editor?.draft).toMatchObject({
      legalName: '新客户有限公司',
      registeredRegion: '浙江省杭州市',
      taxpayerType: 'general-vat',
      accountingStandard: 'enterprise',
    })
  })

  it('requires a short name and explains its compact-menu purpose', async () => {
    const bench = renderSection()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const shortName = await screen.findByLabelText<HTMLInputElement>('简称')
    expect(screen.getByText(zh.shortNameHint)).toBeTruthy()
    fireEvent.change(shortName, { target: { value: '   ' } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled).toBe(true)
    fireEvent.submit(shortName.closest('form')!)
    expect(bench.update).not.toHaveBeenCalled()
  })

  it('keeps optional policy notes collapsed and preserves them when saving other fields', async () => {
    const bench = renderSection('费用按部门归集。')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const notes = await screen.findByLabelText<HTMLTextAreaElement>('财务政策备注')
    expect(notes.closest('details')?.open).toBe(false)
    expect(notes.value).toBe('费用按部门归集。')
    fireEvent.change(screen.getByLabelText('主体全称'), { target: { value: '更新后的客户' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(bench.update).toHaveBeenCalledOnce() })
    expect(bench.update.mock.calls[0]?.[0].draft).toMatchObject({
      legalName: '更新后的客户', financePolicyNotes: '费用按部门归集。',
    })
  })

  it('separates client details from finance-system configuration and collects Youcheng settings', async () => {
    const bench = renderSection()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    await screen.findByRole('group', { name: '主体基本资料' })

    expect(screen.getByRole('group', { name: '财务系统配置' })).toBeTruthy()
    expect(screen.queryByText('科目映射')).toBeNull()
    const system = screen.getByLabelText('财务系统')
    expect([...system.querySelectorAll('option')].map(option => option.textContent)).toEqual([
      '暂不配置', '有成', 'SDOO', '用友', '金蝶',
    ])

    fireEvent.change(system, { target: { value: 'sdoo' } })
    expect(screen.getByText('该财务系统暂未开放配置，当前仅保留系统选择。')).toBeTruthy()
    expect(screen.queryByLabelText('AppKey')).toBeNull()

    fireEvent.change(system, { target: { value: 'youcheng' } })
    expect(screen.getByLabelText<HTMLSelectElement>('API 环境').value).toBe('test')
    expect(screen.getByLabelText<HTMLInputElement>(/^API 地址/).value).toBe('https://cwdata.yiqiyun.com')
    expect(screen.getByLabelText<HTMLInputElement>(/^API 地址/).readOnly).toBe(true)
    expect(screen.queryByRole('textbox', { name: '账套 ID' })).toBeNull()
    fireEvent.change(screen.getByLabelText('AppKey'), { target: { value: 'app-key-001' } })
    fireEvent.change(screen.getByLabelText('AppSecret'), { target: { value: 'secret-001' } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '验证并获取账套' }))
    await screen.findByRole('option', { name: '数豆测试账套 · ID ACCT-001' })
    expect(bench.listYouchengAccounts).toHaveBeenCalledWith({
      clientId, expectedRevision: 2, environment: 'test', appKey: 'app-key-001', youchengAppSecret: 'secret-001',
    })
    expect(bench.update).not.toHaveBeenCalled()
    expect(screen.getByLabelText<HTMLSelectElement>('绑定账套').value).toBe('')
    fireEvent.change(screen.getByLabelText('绑定账套'), { target: { value: 'ACCT-001' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => { expect(bench.update).toHaveBeenCalledOnce() })
    expect(bench.update.mock.calls[0]?.[0]).toMatchObject({
      expectedRevision: 2,
      youchengAppSecret: 'secret-001',
      draft: {
        financeSystem: {
          system: 'youcheng',
          environment: 'test',
          appKey: 'app-key-001',
          accountCode: 'ACCT-001',
          accountName: '数豆测试账套',
        },
      },
    })
  })

  it('invalidates ledger choices on credential changes and ignores an older lookup after a retry', async () => {
    const bench = renderSection()
    let release!: (result: FinanceYouchengAccountsResult) => void
    bench.listYouchengAccounts.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(await screen.findByLabelText('财务系统'), { target: { value: 'youcheng' } })
    fireEvent.change(screen.getByLabelText('AppKey'), { target: { value: 'old-key' } })
    fireEvent.change(screen.getByLabelText('AppSecret'), { target: { value: 'secret-001' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并获取账套' }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '正在验证并获取账套…' }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('AppKey'), { target: { value: 'new-key' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并获取账套' }))
    await screen.findByRole('option', { name: '数豆测试账套 · ID ACCT-001' })
    await act(async () => { release({ state: 'ready', accounts: [{ id: 'old-id', name: '旧授权账套' }] }) })
    expect(screen.queryByText(/旧授权账套/)).toBeNull()
    fireEvent.change(screen.getByLabelText('绑定账套'), { target: { value: 'ACCT-001' } })
    fireEvent.change(screen.getByLabelText('API 环境'), { target: { value: 'production' } })
    expect(screen.getByLabelText<HTMLSelectElement>('绑定账套').value).toBe('')
    expect(screen.queryByRole('option', { name: '数豆测试账套 · ID ACCT-001' })).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(bench.update).not.toHaveBeenCalled()
  })

  it('shows distinct authentication, empty-list, and transport errors without enabling save', async () => {
    const bench = renderSection()
    bench.listYouchengAccounts.mockResolvedValueOnce({ state: 'failed', failure: 'authentication' })
      .mockResolvedValueOnce({ state: 'ready', accounts: [] })
      .mockRejectedValueOnce(new Error('帐套信息已变更'))
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(await screen.findByLabelText('财务系统'), { target: { value: 'youcheng' } })
    fireEvent.change(screen.getByLabelText('AppKey'), { target: { value: 'test-key' } })
    fireEvent.change(screen.getByLabelText('AppSecret'), { target: { value: 'test-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并获取账套' }))
    expect((await screen.findByRole('alert')).textContent).toBe(zh['connection.authentication'])
    fireEvent.click(screen.getByRole('button', { name: '验证并获取账套' }))
    expect((await screen.findByRole('status')).textContent).toBe(zh.noAccounts)
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '绑定账套' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '验证并获取账套' }))
    expect((await screen.findByRole('alert')).textContent).toBe('获取账套失败，请重试。')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled).toBe(true)
    expect(bench.update).not.toHaveBeenCalled()
  })

  it('archives by id with the current catalog revision after explicit confirmation', async () => {
    const bench = renderSection()
    fireEvent.click(screen.getByRole('button', { name: '归档' }))
    fireEvent.click(screen.getByRole('button', { name: '确认归档' }))
    await waitFor(() => { expect(bench.archive).toHaveBeenCalledWith(clientId, 2) })
  })
})

describe('Finance client plugin composition', () => {
  it('registers removable Xiaojing-only settings, hero, and header surfaces', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
    const ctx = new Context()
    const layout = provideNavigation(ctx)
    const conversationEvents = new ConversationEventRegistry(ctx)
    ctx.provide('uiConversation', { events: conversationEvents } as never)
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: {
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
        'settings.section': { kind: 'list', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
        'conversation.hero.context': { kind: 'single', scope: 'root' },
        'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      },
    } as never, () => null)
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('zh')
    ctx.provide('locale', locale)
    const renameFinanceWorkspace = vi.fn(() => ok(financeWorkspaces.clients[0]!))
    const removeFinanceWorkspace = vi.fn(() => ok(financeWorkspaces.standard))
    const importedFile = {
      id: '6ba7b812-9dad-11d1-80b4-00c04fd430c8' as never,
      clientId,
      sessionId,
      action: 'import' as const,
      stage: 'source' as const,
      path: 'E:/Finance/数豆科技/02-原始资料/发票.pdf',
      name: '发票.pdf',
      sha256: 'b'.repeat(64),
      size: 20,
      createdAt: 2,
    }
    const importUpload = vi.fn(() => ok(importedFile))
    const sessionContext = vi.fn<FinanceClientsRemote['sessionContext']>(() => ok({
      state: 'ready' as const,
      locked: false as const,
      clientId,
      clientName: '数豆科技',
    }))
    const api = remote({
      list: vi.fn(() => ok(catalog)),
      sessionContext,
      stage: vi.fn(() => ok({ state: 'general' as const, locked: false as const })),
      renameWorkspace: renameFinanceWorkspace,
      removeWorkspace: removeFinanceWorkspace,
      importUpload,
    })
    const unmount = vi.fn()
    new DynamicRemoteService(ctx, api, unmount)
    const sessionList = createSnapshotStore<SessionListState>({
      ids: [], byId: {}, phase: 'ready' as const,
      subagentsByParent: {}, jobsBySession: {},
    })
    const workspaceList = createSnapshotStore({
      items: [], archivedSessionIds: [], state: 'idle' as const, phase: 'ready' as const,
      error: null,
    })
    const noteAgentPreset = vi.fn()
    const open = vi.fn()
    const connectWorkspace = vi.fn(async () => sessionId)
    const selectPreset = vi.fn(async () => ok('finance'))
    ctx.provide('remote.agentPresets', { select: selectPreset } as never)
    ctx.provide('sessions', {
      list: sessionList,
      noteAgentPreset,
      open,
    } as never)
    ctx.provide('workspaces', {
      list: workspaceList,
      connectWorkspace,
    } as never)
    ctx.provide('uiWorkspace', { connectWorkspace, openSession: open, clearSession: vi.fn() } as never)
    const workspaceCategories = new WorkspaceCategoryRegistry()
    ctx.provide('workspaceCategories', workspaceCategories)
    ctx.provide('conversation', { blocks: { setOwned: vi.fn() } } as never)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('settings.section').map(entry => entry.options.id)).toEqual(['attachment-storage'])
    expect(ctx.slots.entries('conversation.hero.context')).toHaveLength(1)
    expect(ctx.slots.entries('conversation.chat.node')).toHaveLength(1)
    expect(conversationEvents.entries().map(entry => entry.kind)).toContain('finance-published-file')
    expect(ctx.slots.entries('conversation.session.header.actions')).toHaveLength(1)
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(2)
    await waitFor(() => {
      expect(workspaceCategories.store.getSnapshot().categories).toEqual([{
        id: 'finance',
        label: '财务助手',
        ordinaryLabel: '办公搭子',
        workspaceIds: ['finance-standard', 'finance-client', 'finance-archived'],
        reservedWorkspaceIds: ['finance-standard', 'finance-client', 'finance-archived'],
        manageableWorkspaceIds: ['finance-standard', 'finance-client', 'finance-archived'],
        workspaceDetailsLabel: '帐套信息',
        workspaceBadges: [],
        workspaceDetailsWorkspaceIds: ['finance-client', 'finance-archived'],
        newSessionDisabledWorkspaceIds: ['finance-archived'],
        sections: [
          {
            id: 'clients',
            label: '账套',
            icon: 'ledger',
            workspaceIds: ['finance-client', 'finance-archived'],
            addLabel: '添加账套工作区',
            initialPath: '/finance',
          },
          {
            id: 'consultations',
            label: '咨询',
            icon: 'discussion',
            workspaceIds: ['finance-standard'],
            addLabel: '添加咨询工作区',
            initialPath: '/finance',
          },
        ],
      }])
    })

    api.checkConnection = vi.fn(() => ok({ state: 'connected' as const, accountId: '35581', accountName: '演示账套' }))
    await workspaceCategories.activateWorkspaceBadge('finance', 'finance-client' as WorkspaceId)
    expect(api.checkConnection).not.toHaveBeenCalled()
    vi.mocked(api.workspaces).mockImplementation(() => ok({
      ...financeWorkspaces,
      clients: financeWorkspaces.clients.map(entry => ({ ...entry, connection: { state: 'unverified', accountId: '35581' } })),
    }))
    ctx.emit('connection/reset')
    await waitFor(() => { expect(workspaceCategories.store.getSnapshot().categories[0]?.workspaceBadges).toHaveLength(2) })
    expect(workspaceCategories.store.getSnapshot().categories[0]?.workspaceBadges?.[0]?.actionLabel).toBe('连接账套 · 数豆科技 · ID 35581')
    expect(workspaceCategories.store.getSnapshot().categories[0]?.workspaceBadges?.[1]?.actionLabel).toBeUndefined()
    await workspaceCategories.activateWorkspaceBadge('finance', 'finance-archived' as WorkspaceId)
    expect(api.checkConnection).not.toHaveBeenCalled()
    await workspaceCategories.activateWorkspaceBadge('finance', 'finance-client' as WorkspaceId)
    expect(api.checkConnection).toHaveBeenCalledExactlyOnceWith(clientId)
    expect(workspaceCategories.store.getSnapshot().categories[0]?.workspaceBadges?.[0]).toMatchObject({
      text: '演示账套', state: 'success', brandIconSrc: '/youcheng-finance-logo.png',
    })
    expect(connectWorkspace).not.toHaveBeenCalled()
    expect(api.stage).not.toHaveBeenCalled()

    workspaceCategories.openWorkspaceDetails('finance', 'finance-client' as never)
    expect(workspaceCategories.store.getSnapshot().categories[0]?.workspaceDetailsLabel).toBe('帐套信息')

    await workspaceCategories.activate('finance')
    expect(connectWorkspace).toHaveBeenCalledWith('finance-standard')
    expect(selectPreset).toHaveBeenCalledWith(sessionId, 'finance')
    expect(api.stage).toHaveBeenCalledWith(sessionId, { mode: 'general' })
    expect(open).toHaveBeenCalledWith(sessionId)

    const pendingStage = Promise.withResolvers<Awaited<ReturnType<FinanceClientsRemote['stage']>>>()
    const stageStarted = Promise.withResolvers<undefined>()
    vi.mocked(api.stage).mockImplementationOnce(() => {
      stageStarted.resolve(undefined)
      return pendingStage.promise
    })
    const earlierActivation = workspaceCategories.activate('finance')
    await stageStarted.promise
    layout.selectPanel(null)
    open.mockClear()
    pendingStage.resolve(await ok({ state: 'general' as const, locked: false as const }))
    await earlierActivation
    expect(open).not.toHaveBeenCalled()

    const upload = vi.fn(async () => ({
      name: 'random.bin', path: 'E:/uploads/random.bin', size: 20, modifiedAt: '2026-08-28T00:00:00.000Z',
    }))
    await expect(ctx.serial('xiaojing-finance/local-file-prepare', {
      sessionId,
      originalName: '发票.pdf',
      upload,
    })).resolves.toEqual({
      name: '发票.pdf',
      path: importedFile.path,
      size: 20,
      modifiedAt: '2026-08-28T00:00:00.000Z',
    })
    expect(upload).toHaveBeenCalledOnce()
    expect(importUpload).toHaveBeenCalledWith(sessionId, {
      path: 'E:/uploads/random.bin',
      originalName: '发票.pdf',
    })

    sessionContext.mockReturnValue(ok({ state: 'general' as const, locked: false as const }))
    upload.mockClear()
    importUpload.mockClear()
    await expect(ctx.serial('xiaojing-finance/local-file-prepare', {
      sessionId,
      originalName: '咨询资料.pdf',
      upload,
    })).resolves.toEqual({
      name: '发票.pdf',
      path: importedFile.path,
      size: 20,
      modifiedAt: '2026-08-28T00:00:00.000Z',
    })
    expect(upload).toHaveBeenCalledOnce()
    expect(importUpload).toHaveBeenCalledWith(sessionId, {
      path: 'E:/uploads/random.bin',
      originalName: '咨询资料.pdf',
    })

    const ordinarySessionId = 'ordinary-upload' as SessionId
    sessionList.set({
      ids: [ordinarySessionId],
      byId: {
        [ordinarySessionId]: {
          id: ordinarySessionId,
          displayTitle: '普通会话',
          running: false,
          blank: true,
          updatedAt: 3,
          retainedBy: { mainView: 1 },
          projectionValues: { agentPreset: 'standard' },
        },
      },
      phase: 'ready' as const,
      subagentsByParent: {}, jobsBySession: {},
    })
    sessionContext.mockRejectedValue(new Error('ordinary uploads must not call the Finance Remote'))
    upload.mockClear()
    importUpload.mockClear()
    sessionContext.mockClear()
    await expect(ctx.serial('xiaojing-finance/local-file-prepare', {
      sessionId: ordinarySessionId,
      originalName: '普通资料.pdf',
      upload,
    })).resolves.toBeUndefined()
    expect(sessionContext).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
    expect(importUpload).not.toHaveBeenCalled()
    sessionList.set({
      ids: [], byId: {}, phase: 'ready' as const,
      subagentsByParent: {}, jobsBySession: {},
    })

    await workspaceCategories.renameWorkspace('finance', 'finance-client' as WorkspaceId, '新客户名称')
    expect(renameFinanceWorkspace).toHaveBeenCalledWith({
      workspaceId: 'finance-client',
      title: '新客户名称',
    })
    await workspaceCategories.removeWorkspace('finance', 'finance-standard' as WorkspaceId)
    expect(removeFinanceWorkspace).toHaveBeenCalledWith({ workspaceId: 'finance-standard' })

    connectWorkspace.mockClear()
    ctx.emit('agent-preset/staged', 'standard')
    expect(connectWorkspace).not.toHaveBeenCalled()
    ctx.emit('agent-preset/staged', 'finance')
    await waitFor(() => {
      expect(connectWorkspace).toHaveBeenCalledWith('finance-standard')
    })

    await fiber.dispose()
    expect(ctx.slots.entries('conversation.chat.node')).toHaveLength(0)
    expect(conversationEvents.entries()).toHaveLength(0)
    expect(ctx.slots.entries('settings.section')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.hero.context')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.session.header.actions')).toHaveLength(0)
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(0)
    expect(workspaceCategories.store.getSnapshot().categories).toEqual([])
    await expect(workspaceCategories.activateWorkspaceBadge('finance', 'finance-client' as WorkspaceId)).rejects.toThrow('unknown workspace category')
    expect(unmount).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('routes a blank Finance preset into the standard Workspace and returns on preset exit', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
    const ctx = new Context()
    provideNavigation(ctx)
    ctx.provide('uiConversation', { events: new ConversationEventRegistry(ctx) } as never)
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: {
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
        'settings.section': { kind: 'list', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
        'conversation.hero.context': { kind: 'single', scope: 'root' },
        'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      },
    } as never, () => null)
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('zh')
    ctx.provide('locale', locale)
    const api = remote({
      stage: vi.fn((_id: SessionId, request: StageFinanceClientRequest) => ok(
        request.mode === 'general'
          ? { state: 'general' as const, locked: false as const }
          : { state: 'ready' as const, locked: false as const, clientId: request.clientId, clientName: '数豆科技' },
      )),
      sessionContext: vi.fn(() => ok({ state: 'general' as const, locked: false as const })),
    })
    new DynamicRemoteService(ctx, api, vi.fn())

    const ordinarySessionId = 'ordinary-finance-switch' as SessionId
    const financeSessionId = 'finance-standard-switch' as SessionId
    const ordinaryReturnSessionId = 'ordinary-return-switch' as SessionId
    const sessionList = createSnapshotStore<SessionListState>({
      ids: [ordinarySessionId],
      byId: {
        [ordinarySessionId]: {
          id: ordinarySessionId,
          displayTitle: '新会话',
          running: false,
          blank: true,
          updatedAt: 1,
          retainedBy: { mainView: 1 },
          projectionValues: { agentPreset: 'finance' },
        },
      },
      phase: 'ready' as const,
      subagentsByParent: {}, jobsBySession: {},
    })
    const ordinaryWorkspaceId = 'ordinary-workspace' as WorkspaceId
    const workspaceList = createSnapshotStore<WorkspaceListState>({
      items: [
        {
          workspaceId: ordinaryWorkspaceId,
          path: 'E:/ordinary',
          title: '普通工作区',
          sessionIds: [ordinarySessionId],
          createdAt: '2026-08-27T00:00:00.000Z',
          updatedAt: '2026-08-27T00:00:00.000Z',
        },
        {
          workspaceId: financeWorkspaces.standard.workspaceId,
          path: 'E:/Finance工作区/标准咨询',
          title: '咨询',
          sessionIds: [],
          createdAt: '2026-08-27T00:00:00.000Z',
          updatedAt: '2026-08-27T00:00:00.000Z',
        },
      ],
      archivedSessionIds: [],
      state: 'idle' as const,
      phase: 'ready' as const,
      error: null,
    })
    const connectWorkspace = vi.fn(async workspaceId =>
      workspaceId === financeWorkspaces.standard.workspaceId ? financeSessionId : ordinaryReturnSessionId)
    const open = vi.fn((id: SessionId) => {
      sessionList.update((state) => {
        state.ids = [id]
        state.byId = { [id]: {
          id, displayTitle: '新会话', running: false, blank: true, updatedAt: 2,
          retainedBy: { mainView: 1 },
          projectionValues: { agentPreset: id === financeSessionId ? 'finance' : 'standard' },
        } }
      })
      const state = workspaceList.getSnapshot()
      const workspaceId = id === financeSessionId ? financeWorkspaces.standard.workspaceId : ordinaryWorkspaceId
      workspaceList.set({ ...state, items: state.items.map(workspace => ({
        ...workspace, sessionIds: workspace.workspaceId === workspaceId ? [id] : [],
      })) })
    })
    const clear = vi.fn()
    const selectPreset = vi.fn(async (_sessionId: SessionId, agentPreset: string) => ok(agentPreset))
    ctx.provide('remote.agentPresets', { select: selectPreset } as never)
    ctx.provide('sessions', {
      list: sessionList,
      noteAgentPreset: vi.fn(),
      open,
      clear,
    } as never)
    ctx.provide('workspaces', { list: workspaceList, connectWorkspace } as never)
    ctx.provide('uiWorkspace', { connectWorkspace, openSession: open, clearSession: clear } as never)
    ctx.provide('workspaceCategories', new WorkspaceCategoryRegistry())
    ctx.provide('conversation', { blocks: { setOwned: vi.fn() } } as never)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await waitFor(() => {
      expect(connectWorkspace).toHaveBeenCalledWith(financeWorkspaces.standard.workspaceId)
      expect(api.stage).toHaveBeenCalledWith(financeSessionId, { mode: 'general' })
      expect(open).toHaveBeenCalledWith(financeSessionId)
    })

    connectWorkspace.mockClear()
    open.mockClear()
    sessionList.set({
      ids: [financeSessionId],
      byId: {
        [financeSessionId]: {
          id: financeSessionId,
          displayTitle: '新会话',
          running: false,
          blank: true,
          updatedAt: 2,
          retainedBy: { mainView: 1 },
          projectionValues: { agentPreset: 'standard' },
        },
      },
      phase: 'ready' as const,
      subagentsByParent: {}, jobsBySession: {},
    })
    workspaceList.set({
      ...workspaceList.getSnapshot(),
      items: [
        {
          ...workspaceList.getSnapshot().items[0]!,
          sessionIds: [],
        },
        {
          ...workspaceList.getSnapshot().items[1]!,
          sessionIds: [financeSessionId],
        },
      ],
    })
    await waitFor(() => {
      expect(connectWorkspace).toHaveBeenCalledWith(ordinaryWorkspaceId)
      expect(selectPreset).toHaveBeenCalledWith(ordinaryReturnSessionId, 'standard')
      expect(open).toHaveBeenCalledWith(ordinaryReturnSessionId)
    })

    clear.mockClear()
    sessionList.update((state) => {
      state.ids = [financeSessionId]
      state.byId = { [financeSessionId]: {
        id: financeSessionId, displayTitle: '新会话', running: false, blank: true,
        updatedAt: 3, retainedBy: { mainView: 1 }, projectionValues: { agentPreset: 'standard' },
      } }
    })
    workspaceList.set({
      ...workspaceList.getSnapshot(),
      items: [{ ...workspaceList.getSnapshot().items[1]!, sessionIds: [financeSessionId] }],
    })
    await waitFor(() => { expect(clear).toHaveBeenCalledTimes(1) })

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('does not register outside the Xiaojing profile', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: { 'conversation.hero.context': { kind: 'single', scope: 'root' } },
    } as never, () => null)
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.hero.context')).toHaveLength(0)
    await ctx.fiber.dispose()
  })
})
