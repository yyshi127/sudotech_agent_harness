/** Xiaojing Finance client-management settings, workspace category, hero context, and session label. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceCategoryProvider } from '@deepseek-ai/dsh-client-ui-workspace/client'
import financeClientsRemote from '@deepseek-ai/dsh-xiaojing-finance-domain/remote'
import type {} from '@deepseek-ai/dsh-xiaojing-finance-domain/remote'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { AttachmentStorageSection, type AttachmentStorageSectionInjected } from './AttachmentStorageSection.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { FinanceClientsController } from './controller.ts'
import {
  FinanceClientCreateOverlay,
  type FinanceClientCreateOverlayInjected,
} from './FinanceClientCreateOverlay.tsx'
import { FinanceClientDetailsOverlay, type FinanceClientDetailsOverlayInjected } from './FinanceClientDetailsOverlay.tsx'
import { FinanceContextLabel } from './FinanceContextLabel.tsx'
import { FinanceHeroContext, type FinanceHeroContextInjected } from './FinanceHeroContext.tsx'
import { PublishedFile } from './PublishedFile.tsx'
import { FinanceToolCard } from './FinanceToolCard.tsx'
import { publishedFileDefinition } from './published-file.ts'
import type {
  FinanceSessionContextView,
  FinanceWorkspaceEntry,
  StageFinanceClientRequest,
} from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import { en, zh, type FinanceClientsKey } from './locales.ts'
import type { LocalUploadedFile } from './upload-contract.ts'

export type { FinanceClientsRemote, FinanceClientsView } from './controller.ts'
export type { FinanceLocalFilePrepareRequest, LocalUploadedFile } from './upload-contract.ts'
export type { FinanceClientsSectionInjected, FinanceClientsSectionProps } from './FinanceClientsSection.tsx'
export type {
  FinanceClientCreateOverlayInjected,
  FinanceClientCreateOverlayProps,
} from './FinanceClientCreateOverlay.tsx'
export type { FinanceHeroContextInjected, FinanceHeroContextProps } from './FinanceHeroContext.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Xiaojing Finance client records and session-context copy. */
    'finance.clients': FinanceClientsKey
  }
}

const NS = 'finance.clients'
const BLOCK_OWNER = '@deepseek-ai/dsh-client-ui-xiaojing-finance-clients'
const FINANCE_TOOL_NAMES = [
  'finance_balances', 'finance_files', 'finance_references', 'finance_journals',
  'finance_open_items', 'finance_open_item_analysis', 'finance_open_item_accounts',
  'finance_vouchers', 'finance_voucher_detail', 'finance_prepare_voucher',
  'finance_create_voucher', 'finance_prepare_voucher_deletion', 'finance_delete_voucher',
  'finance_prepare_journal', 'finance_create_journal',
  'finance_prepare_journal_deletion', 'finance_delete_journal',
  'finance_prepare_master_data', 'finance_create_master_data',
  'finance_prepare_open_item', 'finance_create_open_item',
  'finance_prepare_open_item_deletion', 'finance_delete_open_item',
  'finance_prepare_open_item_write_off', 'finance_write_off_open_item',
] as const

/** Required service used to mount the product-only Finance Remote contribution. */
export const inject = ['remote']

/** Mount the Finance Remote contribution, then register its product-only UI consumer. */
export async function apply(ctx: ClientContext): Promise<void> {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'xiaojing') return
  await ctx.remote.$mount(financeClientsRemote)
  ctx.inject(
    [
      'slots', 'remote.financeClients', 'remote.agentPresets', 'locale', 'sessions', 'conversation',
      'workspaces', 'uiWorkspace', 'workspaceCategories', 'uiConversation', 'layout',
    ],
    registerFinanceClientSurfaces,
  )
}

function registerFinanceClientSurfaces(ctx: ClientContext): void {
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() }, 'ui-xiaojing-finance-clients: navigation lifetime')
  const beginNavigation = (): AbortSignal => AbortSignal.any([ctx.layout.beginNavigation(), lifetime.signal])
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-xiaojing-finance-clients: dictionaries')
  for (const toolName of FINANCE_TOOL_NAMES) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      { name: 'tool.call.toolview', key: toolName, locale: NS }, FinanceToolCard,
    ))
  }

  const controller = new FinanceClientsController(ctx.remote.financeClients)
  const isLoopback = ctx.remote.$host.isLoopback
  const mainSession = () => Object.values(ctx.sessions.list.getSnapshot().byId)
    .find(summary => (summary.retainedBy.mainView ?? 0) > 0)
  const presetOf = (summary: ReturnType<typeof mainSession>): string | undefined => {
    const value = summary?.projectionValues?.agentPreset
    return typeof value === 'string' ? value : undefined
  }
  ctx.effect(() => ctx.uiConversation.events.register(publishedFileDefinition), 'ui-xiaojing-finance-clients: publication node')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'finance-published-file', locale: NS,
    inject: () => ({ canOpen: isLoopback }),
  }, PublishedFile))
  const t = ctx.locale.bind(NS)
  const unwrap = async <T>(pending: Promise<RemoteResult<T>>): Promise<T> => {
    const result = await pending
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  if (isLoopback) {
    const attachmentActions: AttachmentStorageSectionInjected = {
      load: () => unwrap(ctx.remote.financeClients.readAttachmentStorage()),
      save: request => unwrap(ctx.remote.financeClients.saveAttachmentStorage(request)),
      test: revision => unwrap(ctx.remote.financeClients.testAttachmentStorage(revision)),
    }
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: 'attachment-storage', order: 26, locale: NS,
      label: () => t('storageTitle'), inject: () => attachmentActions,
    }, AttachmentStorageSection))
  }
  const loadClients = (): Promise<void> => controller.load()
  const read = controller.read.bind(controller)
  const sessionContext = controller.sessionContext.bind(controller)
  ctx.effect(() => ctx.on('xiaojing-finance/local-file-prepare', async (request) => {
    const summary = ctx.sessions.list.getSnapshot().byId[request.sessionId]
    if (summary !== undefined && summary.projectionValues?.agentPreset !== 'finance') return undefined
    const context = await controller.sessionContext(request.sessionId)
    if (context.state === 'not-finance') return undefined
    const uploaded = await request.upload()
    const imported = await controller.importUpload(request.sessionId, {
      path: uploaded.path,
      originalName: request.originalName,
    })
    const prepared: LocalUploadedFile = {
      ...uploaded,
      name: imported.name,
      path: imported.path,
      size: imported.size,
    }
    return prepared
  }), 'ui-xiaojing-finance-clients: controlled upload handoff')
  const workspaceState = async () => {
    if (controller.store.getSnapshot().workspaces === null) await controller.load()
    const workspaces = controller.store.getSnapshot().workspaces
    if (workspaces === null) throw new Error('Finance workspace catalog is unavailable')
    return workspaces
  }
  const selectPreset = async (sessionId: SessionId, agentPreset: string): Promise<void> => {
    const summary = ctx.sessions.list.getSnapshot().byId[sessionId]
    if (summary?.projectionValues?.agentPreset === agentPreset) return
    const response = await ctx.remote.agentPresets.select(sessionId, agentPreset)
    if (!response.ok) throw new Error(response.error.message)
  }
  const enterFinanceWorkspace = async (
    entry: FinanceWorkspaceEntry,
    request: StageFinanceClientRequest,
    navigation: AbortSignal,
  ): Promise<FinanceSessionContextView> => {
    if (!entry.startable) throw new Error('Archived customer workspaces cannot start new sessions')
    const sessionId = await ctx.uiWorkspace.connectWorkspace(entry.workspaceId)
    await selectPreset(sessionId, 'finance')
    const context = await controller.stage(sessionId, request)
    if (!navigation.aborted) ctx.uiWorkspace.openSession(sessionId)
    return context
  }
  const stage = async (
    sessionId: SessionId,
    request: StageFinanceClientRequest,
  ): Promise<FinanceSessionContextView> => {
    const navigation = beginNavigation()
    const workspaces = await workspaceState()
    if (request.mode === 'general') {
      const listedWorkspaceIds = new Set(workspaces.listedWorkspaceIds)
      const currentWorkspaceId = ctx.workspaces.list.getSnapshot().items
        .find(workspace => workspace.sessionIds.includes(sessionId))?.workspaceId
      const entry = [workspaces.standard, ...workspaces.consultations]
        .find(candidate => candidate.workspaceId === currentWorkspaceId && listedWorkspaceIds.has(candidate.workspaceId))
        ?? [workspaces.standard, ...workspaces.consultations]
          .find(candidate => listedWorkspaceIds.has(candidate.workspaceId))
      if (entry === undefined) throw new Error('Finance requires at least one consultation workspace')
      return await enterFinanceWorkspace(entry, request, navigation)
    }
    const entry = workspaces.clients.find(candidate => candidate.clientId === request.clientId)
    if (entry === undefined) throw new Error('The selected customer workspace is unavailable')
    return await enterFinanceWorkspace(entry, request, navigation)
  }
  const setBlocked = (sessionId: SessionId, reason: string | undefined): void => {
    ctx.conversation.blocks.setOwned(BLOCK_OWNER, sessionId, reason === undefined ? undefined : { reason })
  }

  const categorySource: WorkspaceCategoryProvider['source'] = {
    getSnapshot: () => {
      const state = controller.store.getSnapshot()
      const workspaces = state.workspaces
      const entries = workspaces === null
        ? []
        : [workspaces.standard, ...workspaces.consultations, ...workspaces.clients]
      const listedWorkspaceIds = new Set(workspaces?.listedWorkspaceIds ?? [])
      const listedEntries = entries.filter(entry => listedWorkspaceIds.has(entry.workspaceId))
      return {
        ready: workspaces !== null,
        ...(state.error === null ? {} : { loadError: state.error }),
        label: t('financeWorkspace'),
        ordinaryLabel: t('ordinaryWorkspace'),
        workspaceIds: listedEntries.map(entry => entry.workspaceId),
        reservedWorkspaceIds: entries.map(entry => entry.workspaceId),
        manageableWorkspaceIds: listedEntries.map(entry => entry.workspaceId),
        workspaceDetailsLabel: t('workspaceDetails'),
        workspaceDetailsWorkspaceIds: workspaces?.clients.map(entry => entry.workspaceId) ?? [],
        workspaceBadges: (workspaces?.clients ?? []).flatMap((entry) => {
          const status = entry.connection
          if (status === undefined) return []
          const label = status.failure === undefined
            ? t(status.state === 'connected' ? 'connectionConnected'
              : status.state === 'checking' ? 'connectionChecking'
                : status.state === 'failed' ? 'connectionFailed' : 'connectionUnverified')
            : t(`connection.${status.failure}`)
          return [{
            workspaceId: entry.workspaceId,
            ...(!isLoopback || !entry.startable ? {} : {
              actionLabel: `${t(status.state === 'checking' ? 'connectionChecking'
                : status.state === 'connected' ? 'connectionReconnect' : 'connectionConnect')} · ${entry.title} · ID ${status.accountId}`,
            }),
            ...(status.accountName === undefined ? {} : { text: status.accountName }),
            state: status.state === 'connected' ? 'success' as const
              : status.state === 'checking' ? 'pending' as const
                : status.state === 'failed' ? 'error' as const : 'idle' as const,
            ...(status.state === 'connected' ? { brandIconSrc: '/youcheng-finance-logo.png' } : {}),
            label: `${label} · ID ${status.accountId}${status.checkedAt === undefined ? '' : ` · ${new Date(status.checkedAt).toLocaleString()}`}`,
          }]
        }),
        newSessionDisabledWorkspaceIds: listedEntries.filter(entry => !entry.startable)
          .map(entry => entry.workspaceId),
        sections: [
          {
            id: 'clients',
            label: t('clientWorkspaces'),
            icon: 'ledger',
            workspaceIds: workspaces?.clients
              .filter(entry => listedWorkspaceIds.has(entry.workspaceId))
              .map(entry => entry.workspaceId) ?? [],
            addLabel: t('addClientWorkspace'),
            ...(workspaces === null ? {} : { initialPath: workspaces.workspaceRoot }),
          },
          {
            id: 'consultations',
            label: t('generalConsulting'),
            icon: 'discussion',
            workspaceIds: workspaces === null
              ? []
              : [workspaces.standard, ...workspaces.consultations]
                .filter(entry => listedWorkspaceIds.has(entry.workspaceId))
                .map(entry => entry.workspaceId),
            addLabel: t('addConsultationWorkspace'),
            ...(workspaces === null ? {} : { initialPath: workspaces.workspaceRoot }),
          },
        ],
      }
    },
    subscribe: listener => controller.store.subscribe(listener),
  }
  const activateCategory = async (workspaceId?: WorkspaceId): Promise<void> => {
    const navigation = beginNavigation()
    const workspaces = await workspaceState()
    if (navigation.aborted) return
    const listedWorkspaceIds = new Set(workspaces.listedWorkspaceIds)
    const entry = workspaceId === undefined
      ? [workspaces.standard, ...workspaces.consultations]
        .find(candidate => listedWorkspaceIds.has(candidate.workspaceId))
      : [workspaces.standard, ...workspaces.consultations, ...workspaces.clients]
        .find(candidate => candidate.workspaceId === workspaceId && listedWorkspaceIds.has(candidate.workspaceId))
    if (entry === undefined) throw new Error('Unknown Finance workspace')
    const request: StageFinanceClientRequest = entry.kind === 'client'
      ? { mode: 'client', clientId: entry.clientId }
      : { mode: 'general' }
    await enterFinanceWorkspace(entry, request, navigation)
  }
  ctx.effect(() => ctx.workspaceCategories.register({
    id: 'finance',
    order: 10,
    source: categorySource,
    retryLoad: () => { void controller.load() },
    activate: activateCategory,
    addWorkspace: async (sectionId, path) => {
      if (sectionId === 'consultations') {
        return (await controller.addConsultationWorkspace(path)).workspaceId
      }
      if (sectionId !== 'clients') throw new Error(`Unknown Finance workspace section: ${sectionId}`)
      const restored = await controller.restoreClientWorkspace(path)
      if (restored !== null) return restored.workspaceId
      const clientId = await controller.beginClientWorkspaceCreation(path)
      if (clientId === undefined) return undefined
      const workspaces = await workspaceState()
      const entry = workspaces.clients.find(candidate => candidate.clientId === clientId)
      if (entry === undefined) throw new Error('The created customer workspace is unavailable')
      return entry.workspaceId
    },
    renameWorkspace: async (workspaceId, title) => {
      await controller.renameWorkspace(workspaceId, title)
    },
    openWorkspaceDetails: (workspaceId) => {
      const entry = controller.store.getSnapshot().workspaces?.clients.find(item => item.workspaceId === workspaceId)
      if (entry !== undefined) controller.openClientEditor(entry.clientId)
    },
    activateWorkspaceBadge: async (workspaceId) => {
      const entry = controller.store.getSnapshot().workspaces?.clients.find(item => item.workspaceId === workspaceId)
      if (isLoopback && entry?.startable && entry.connection !== undefined) {
        await controller.checkConnection(entry.clientId)
      }
    },
    removeWorkspace: async (workspaceId) => {
      const currentSessionId = mainSession()?.id
      const currentWorkspaceId = currentSessionId === undefined
        ? undefined
        : ctx.workspaces.list.getSnapshot().items
          .find(workspace => workspace.sessionIds.includes(currentSessionId))?.workspaceId
      await controller.removeWorkspace(workspaceId)
      if (currentWorkspaceId === workspaceId) await activateCategory()
    },
  }), 'ui-xiaojing-finance-clients: Finance workspace category')

  ctx.effect(() => {
    let disposed = false
    let running = false
    let rerun = false
    let previousOrdinaryWorkspaceId: WorkspaceId | undefined

    const reconcile = async (): Promise<void> => {
      const summary = mainSession()
      const sessionId = summary?.id
      if (sessionId === undefined) return
      if (summary === undefined) return
      const agentPreset = presetOf(summary)
      ctx.workspaceCategories.setPickerCategory(agentPreset === 'finance' ? 'finance' : undefined)
      if (!summary.blank) return
      const workspaces = controller.store.getSnapshot().workspaces
      if (workspaces === null) return
      const financeIds = new Set([workspaces.standard, ...workspaces.consultations, ...workspaces.clients]
        .map(entry => entry.workspaceId))
      const listedFinanceIds = new Set(workspaces.listedWorkspaceIds)
      const workspaceItems = ctx.workspaces.list.getSnapshot().items
      const currentWorkspaceId = workspaceItems
        .find(workspace => workspace.sessionIds.includes(sessionId))?.workspaceId

      if (agentPreset === 'finance'
        && (currentWorkspaceId === undefined || !listedFinanceIds.has(currentWorkspaceId))) {
        if (currentWorkspaceId !== undefined) previousOrdinaryWorkspaceId = currentWorkspaceId
        await activateCategory()
        return
      }
      if (agentPreset === 'finance' || currentWorkspaceId === undefined || !financeIds.has(currentWorkspaceId)) return

      const ordinaryWorkspace = workspaceItems.find(workspace =>
        workspace.workspaceId === previousOrdinaryWorkspaceId && !financeIds.has(workspace.workspaceId))
        ?? workspaceItems.find(workspace => !financeIds.has(workspace.workspaceId))
      if (ordinaryWorkspace === undefined) {
        ctx.uiWorkspace.clearSession()
        return
      }
      const navigation = beginNavigation()
      const targetSessionId = await ctx.uiWorkspace.connectWorkspace(ordinaryWorkspace.workspaceId)
      if (agentPreset !== undefined) await selectPreset(targetSessionId, agentPreset)
      if (!navigation.aborted) ctx.uiWorkspace.openSession(targetSessionId)
    }

    const schedule = (): void => {
      if (disposed) return
      if (running) {
        rerun = true
        return
      }
      running = true
      void reconcile().catch((reason: unknown) => {
        console.warn('Finance workspace routing failed:', reason)
      }).finally(() => {
        running = false
        if (rerun) {
          rerun = false
          schedule()
        }
      })
    }

    const disposeSessions = ctx.sessions.list.subscribe(schedule)
    const disposeWorkspaces = ctx.workspaces.list.subscribe(schedule)
    const disposeFinance = controller.store.subscribe(schedule)
    const disposePresetStage = ctx.on('agent-preset/staged', (agentPreset) => {
      ctx.workspaceCategories.setPickerCategory(agentPreset === 'finance' ? 'finance' : undefined)
      if (agentPreset !== 'finance' || mainSession() !== undefined) return
      void activateCategory().catch((reason: unknown) => {
        console.warn('Finance workspace activation failed:', reason)
      })
    })
    void controller.load().then(schedule)
    schedule()
    return () => {
      disposed = true
      disposeSessions()
      disposeWorkspaces()
      disposeFinance()
      disposePresetStage()
      ctx.workspaceCategories.setPickerCategory(undefined)
    }
  }, 'ui-xiaojing-finance-clients: preset-workspace routing')

  const heroInjected = (): FinanceHeroContextInjected => ({
    hooks: { financeClients: controller.store },
    loadClients,
    sessionContext,
    stage,
    setBlocked,
  })

  const overlayInjected = (): FinanceClientCreateOverlayInjected => ({
    hooks: { financeClients: controller.store },
    createClient: controller.create.bind(controller),
    complete: controller.completeClientWorkspaceCreation.bind(controller),
    cancel: controller.cancelClientWorkspaceCreation.bind(controller),
  })

  const detailsInjected = (): FinanceClientDetailsOverlayInjected => ({
    hooks: { financeClients: controller.store },
    read,
    listYouchengAccounts: controller.listYouchengAccounts.bind(controller),
    update: async (editor) => {
      const appSecret = editor.youchengAppSecret.trim()
      await controller.update({
        clientId: editor.clientId,
        expectedRevision: editor.expectedRevision,
        client: editor.draft,
        ...appSecret === '' ? {} : { credentialInput: { youchengAppSecret: appSecret } },
      })
    },
    close: () => { controller.closeClientEditor() },
  })

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'finance-client-details', order: 19, locale: NS, inject: detailsInjected,
  }, FinanceClientDetailsOverlay))

  ctx.slots.inject('conversation.hero.context', () => ctx.slots.register({
    name: 'conversation.hero.context',
    locale: NS,
    inject: heroInjected,
  }, FinanceHeroContext))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'finance-client-workspace-create',
    order: 20,
    locale: NS,
    inject: overlayInjected,
  }, FinanceClientCreateOverlay))

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'finance-client-context',
    order: -9,
    locale: NS,
  }, FinanceContextLabel))

  ctx.effect(() => {
    const refresh = (): void => {
      controller.resetSessionContexts()
      void controller.load()
    }
    const dispose = ctx.on('connection/reset', refresh)
    return () => { dispose() }
  }, 'ui-xiaojing-finance-clients: reconnect refresh')

  ctx.effect(() => () => {
    controller.cancelClientWorkspaceCreation()
  }, 'ui-xiaojing-finance-clients: cancel pending customer creation on unload')
}
