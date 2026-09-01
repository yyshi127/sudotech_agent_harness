// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Context, Service } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import {
  createSnapshotStore,
  SlotRegistry,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  SessionId,
  SessionListState,
  WorkspaceId,
  WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { WorkspaceCategoryRegistry } from '@deepseek-ai/dsh-client-ui-workspace/client'
import {
  FinanceClientId,
  type FinanceClientListView,
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

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('FinanceClientsController', () => {
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
      current: sessionId,
      byId: {
        [sessionId]: {
          id: sessionId,
          agentPreset: options.preset ?? 'finance',
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
        clientName: clients.getSnapshot().catalog.clients.find(client => client.id === request.clientId)?.shortName ?? '客户',
      }
    })
    const setBlocked = vi.fn()
    const runtime = {
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
    expect(screen.queryByRole('button', { name: '选择客户' })).toBeNull()
    await waitFor(() => { expect(bench.setBlocked).toHaveBeenLastCalledWith(sessionId, undefined) })

    fireEvent.click(mode)
    fireEvent.click(await screen.findByRole('menuitem', { name: '客户' }))
    const client = await screen.findByRole('button', { name: '选择客户' })
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
    expect(screen.queryByRole('button', { name: '选择客户' })).toBeNull()
  })

  it('shows an immutable client binding on a blank session without blocking input', async () => {
    const bench = renderHero({
      sessionContext: vi.fn().mockResolvedValue({
        state: 'bound', locked: true, clientName: '瑞华云',
      }),
    })

    const mode = await screen.findByRole('button', { name: '选择咨询模式' })
    const client = await screen.findByRole('button', { name: '选择客户' })
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
    fireEvent.click(await screen.findByRole('menuitem', { name: '客户' }))
    fireEvent.click(await screen.findByRole('button', { name: '选择客户' }))
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
    expect(screen.queryByText('新增客户')).toBeNull()
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
    expect((await screen.findByRole('button', { name: '选择客户' })).textContent).toContain('数豆科技')
    await act(async () => {
      bench.clients.update((state) => { state.contextEpoch += 1 })
    })
    await waitFor(() => { expect(sessionContext).toHaveBeenCalledTimes(2) })
    expect(screen.queryByRole('button', { name: '选择客户' })).toBeNull()

    await act(async () => {
      bench.sessions.update((state) => { state.byId[sessionId]!.agentPreset = 'standard' })
    })
    expect(screen.queryByLabelText('客户上下文')).toBeNull()
  })
})

describe('Finance client management', () => {
  function renderSection() {
    const clients = createSnapshotStore({
      status: 'ready' as const, catalog, workspaces: financeWorkspaces, error: null,
      clientCreation: null, contextEpoch: 0,
    })
    const actions = {
      load: vi.fn(() => Promise.resolve()),
      read: vi.fn(async () => ({
        revision: catalog.revision,
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
          createdAt: 1,
          updatedAt: 2,
        },
      })),
      update: vi.fn((_editor: EditorState) => Promise.resolve()),
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
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: {
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
      ids: [], byId: {}, current: undefined, phase: 'ready' as const,
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    })
    const workspaceList = createSnapshotStore({
      items: [], archivedSessionIds: [], state: 'idle' as const, phase: 'ready' as const,
      error: null, baselinesReady: true, recentWorkspaceId: undefined,
    })
    const noteAgentPreset = vi.fn()
    const open = vi.fn()
    const connectWorkspace = vi.fn(async () => sessionId)
    const selectPreset = vi.fn(async () => ({
      result: { ok: true as const, value: { agentPreset: 'finance' } },
    }))
    ctx.provide('sessions', {
      list: sessionList,
      noteAgentPreset,
      open,
    } as never)
    ctx.provide('workspaces', {
      list: workspaceList,
      connectWorkspace,
    } as never)
    ctx.provide('connection', {
      api: { agentPresets: { select: selectPreset } },
    } as never)
    const workspaceCategories = new WorkspaceCategoryRegistry()
    ctx.provide('workspaceCategories', workspaceCategories)
    ctx.provide('conversation', { blocks: { setOwned: vi.fn() } } as never)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const section = ctx.slots.entries('settings.section')[0]
    expect(section?.options).toMatchObject({ id: 'finance-clients', order: 22 })
    expect(resolveSlotLabel(section?.options.label)).toBe('客户管理')
    expect(ctx.slots.entries('conversation.hero.context')).toHaveLength(1)
    expect(ctx.slots.entries('conversation.session.header.actions')).toHaveLength(1)
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(1)
    await waitFor(() => {
      expect(workspaceCategories.store.getSnapshot().categories).toEqual([{
        id: 'finance',
        label: '财务工作区',
        ordinaryLabel: '普通工作区',
        workspaceIds: ['finance-standard', 'finance-client', 'finance-archived'],
        reservedWorkspaceIds: ['finance-standard', 'finance-client', 'finance-archived'],
        manageableWorkspaceIds: ['finance-standard', 'finance-client', 'finance-archived'],
        newSessionDisabledWorkspaceIds: ['finance-archived'],
        sections: [
          {
            id: 'clients',
            label: '客户',
            icon: 'person',
            workspaceIds: ['finance-client', 'finance-archived'],
            addLabel: '添加客户工作区',
          },
          {
            id: 'consultations',
            label: '咨询',
            icon: 'discussion',
            workspaceIds: ['finance-standard'],
            addLabel: '添加咨询工作区',
          },
        ],
      }])
    })

    await workspaceCategories.activate('finance')
    expect(connectWorkspace).toHaveBeenCalledWith('finance-standard')
    expect(selectPreset).toHaveBeenCalledWith({ sessionId, agentPreset: 'finance' })
    expect(api.stage).toHaveBeenCalledWith(sessionId, { mode: 'general' })
    expect(noteAgentPreset).toHaveBeenCalledWith(sessionId, 'finance')
    expect(open).toHaveBeenCalledWith(sessionId)

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
          agentPreset: 'standard',
        },
      },
      current: ordinarySessionId,
      phase: 'ready' as const,
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
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
      ids: [], byId: {}, current: undefined, phase: 'ready' as const,
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
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
    expect(ctx.slots.entries('settings.section')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.hero.context')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.session.header.actions')).toHaveLength(0)
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(0)
    expect(workspaceCategories.store.getSnapshot().categories).toEqual([])
    expect(unmount).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('routes a blank Finance preset into the standard Workspace and returns on preset exit', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: {
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
    const sessionList = createSnapshotStore({
      ids: [ordinarySessionId],
      byId: {
        [ordinarySessionId]: {
          id: ordinarySessionId,
          displayTitle: '新会话',
          running: false,
          blank: true,
          updatedAt: 1,
          agentPreset: 'finance',
        },
      },
      current: ordinarySessionId,
      phase: 'ready' as const,
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
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
      baselinesReady: true,
      recentWorkspaceId: ordinaryWorkspaceId,
    })
    const connectWorkspace = vi.fn(async workspaceId =>
      workspaceId === financeWorkspaces.standard.workspaceId ? financeSessionId : ordinaryReturnSessionId)
    const open = vi.fn()
    const clear = vi.fn()
    const selectPreset = vi.fn(async ({ agentPreset }: { agentPreset: string }) => ({
      result: { ok: true as const, value: { agentPreset } },
    }))
    ctx.provide('sessions', {
      list: sessionList,
      noteAgentPreset: vi.fn(),
      open,
      clear,
    } as never)
    ctx.provide('workspaces', { list: workspaceList, connectWorkspace } as never)
    ctx.provide('connection', { api: { agentPresets: { select: selectPreset } } } as never)
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
          agentPreset: 'standard',
        },
      },
      current: financeSessionId,
      phase: 'ready' as const,
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
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
      expect(selectPreset).toHaveBeenCalledWith({ sessionId: ordinaryReturnSessionId, agentPreset: 'standard' })
      expect(open).toHaveBeenCalledWith(ordinaryReturnSessionId)
    })

    clear.mockClear()
    workspaceList.set({
      ...workspaceList.getSnapshot(),
      items: [workspaceList.getSnapshot().items[1]!],
      recentWorkspaceId: financeWorkspaces.standard.workspaceId,
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
