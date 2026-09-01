/** Product-extensible workspace categories rendered by the generic sidebar browser. */

import '@deepseek-ai/cordis'
import {
  createSnapshotStore,
  type ObservableSnapshot,
  type SnapshotStore,
  type WorkspaceId,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Product-neutral semantic icons available to a nested workspace section. */
export type WorkspaceCategorySectionIcon = 'discussion' | 'person'

/** One optional nested collection inside a product workspace category. */
export interface WorkspaceCategorySection {
  /** Stable section id within the owning category. */
  id: string
  /** Active-locale section label. */
  label: string
  /** Category workspaces rendered below this section node. */
  workspaceIds: readonly WorkspaceId[]
  /** Optional semantic icon; omitted sections retain the expandable-folder icon. */
  icon?: WorkspaceCategorySectionIcon
  /** Optional label for the section's directory-backed add action. */
  addLabel?: string
}

/** Dynamic facts for one workspace category. */
export interface WorkspaceCategoryState {
  /** Active-locale label shown beside the ordinary Workspace heading. */
  label: string
  /** Optional product copy replacing the ordinary Workspace heading. */
  ordinaryLabel?: string
  /** Workspaces shown exclusively inside this category. */
  workspaceIds: readonly WorkspaceId[]
  /** Visible and hidden Workspace registrations reserved from ordinary categories. */
  reservedWorkspaceIds?: readonly WorkspaceId[]
  /** Visible Workspaces that expose product-owned rename and remove actions. */
  manageableWorkspaceIds?: readonly WorkspaceId[]
  /** Category workspaces that retain history but cannot create new sessions. */
  newSessionDisabledWorkspaceIds: readonly WorkspaceId[]
  /** Optional nested presentation sections; unlisted workspaces remain at the category root. */
  sections?: readonly WorkspaceCategorySection[]
}

/** One product-owned category provider. */
export interface WorkspaceCategoryProvider {
  /** Stable category id. */
  id: string
  /** Header order among custom categories. */
  order: number
  /** Dynamic label and Workspace membership. */
  source: ObservableSnapshot<WorkspaceCategoryState>
  /** Enter the category or start a session in one of its workspaces. */
  activate: (workspaceId?: WorkspaceId) => Promise<void>
  /** Add one directory-backed Workspace to a section; undefined means the user cancelled. */
  addWorkspace?: (sectionId: string, path: string) => Promise<WorkspaceId | undefined>
  /** Rename one product-owned Workspace. */
  renameWorkspace?: (workspaceId: WorkspaceId, title: string) => Promise<void>
  /** Remove one product-owned Workspace from product lists without deleting its durable data. */
  removeWorkspace?: (workspaceId: WorkspaceId) => Promise<void>
}

/** Workspace-category state consumed by the sidebar. */
export interface WorkspaceCategorySnapshot {
  /** Registered categories ordered by provider order then id. */
  categories: readonly (WorkspaceCategoryState & { id: string })[]
  /** Category whose workspaces are visible in the conversation picker; absent means ordinary workspaces. */
  pickerCategoryId?: string
}

/** Registry keeping product categories outside the generic Workspace implementation. */
export class WorkspaceCategoryRegistry {
  /** Aggregated category snapshot. */
  readonly store: SnapshotStore<WorkspaceCategorySnapshot> = createSnapshotStore({ categories: [] })

  private pickerCategoryId: string | undefined
  private readonly providers = new Map<string, {
    provider: WorkspaceCategoryProvider
    disposeSource: () => void
  }>()

  /**
   * Register one product category.
   * @param provider - Category membership and activation behavior.
   * @returns Idempotent disposer for this registration.
   */
  register(provider: WorkspaceCategoryProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new Error(`workspace category already registered: ${provider.id}`)
    }
    const disposeSource = provider.source.subscribe(() => { this.project() })
    this.providers.set(provider.id, { provider, disposeSource })
    this.project()
    return () => {
      const current = this.providers.get(provider.id)
      if (current?.provider !== provider) return
      current.disposeSource()
      this.providers.delete(provider.id)
      if (this.pickerCategoryId === provider.id) this.pickerCategoryId = undefined
      this.project()
    }
  }

  /**
   * Activate a registered category.
   * @param categoryId - Category identity.
   * @param workspaceId - Optional workspace selected inside the category.
   * @returns Once the provider has opened the destination session.
   */
  async activate(categoryId: string, workspaceId?: WorkspaceId): Promise<void> {
    const provider = this.providers.get(categoryId)?.provider
    if (provider === undefined) throw new Error(`unknown workspace category: ${categoryId}`)
    await provider.activate(workspaceId)
  }

  /**
   * Add one Workspace through its owning product category.
   * @param categoryId - Category identity.
   * @param sectionId - Section receiving the selected directory.
   * @param path - Host directory selected by the user.
   * @returns Created Workspace identity, or undefined when product creation was cancelled.
   */
  async addWorkspace(
    categoryId: string,
    sectionId: string,
    path: string,
  ): Promise<WorkspaceId | undefined> {
    const provider = this.providers.get(categoryId)?.provider
    if (provider === undefined) throw new Error(`unknown workspace category: ${categoryId}`)
    if (provider.addWorkspace === undefined) {
      throw new Error(`workspace category does not support adding workspaces: ${categoryId}`)
    }
    return provider.addWorkspace(sectionId, path)
  }

  /**
   * Rename one Workspace through its owning product category.
   * @param categoryId - Category identity.
   * @param workspaceId - Workspace selected in the category.
   * @param title - New display title.
   * @returns Once the product provider has persisted the title.
   */
  async renameWorkspace(categoryId: string, workspaceId: WorkspaceId, title: string): Promise<void> {
    const provider = this.providers.get(categoryId)?.provider
    if (provider === undefined) throw new Error(`unknown workspace category: ${categoryId}`)
    if (provider.renameWorkspace === undefined) {
      throw new Error(`workspace category does not support renaming workspaces: ${categoryId}`)
    }
    await provider.renameWorkspace(workspaceId, title)
  }

  /**
   * Remove one Workspace through its owning product category.
   * @param categoryId - Category identity.
   * @param workspaceId - Workspace selected in the category.
   * @returns Once the product provider has removed the Workspace from its lists.
   */
  async removeWorkspace(categoryId: string, workspaceId: WorkspaceId): Promise<void> {
    const provider = this.providers.get(categoryId)?.provider
    if (provider === undefined) throw new Error(`unknown workspace category: ${categoryId}`)
    if (provider.removeWorkspace === undefined) {
      throw new Error(`workspace category does not support removing workspaces: ${categoryId}`)
    }
    await provider.removeWorkspace(workspaceId)
  }

  /**
   * Select which registered category filters the conversation Workspace picker.
   * @param categoryId - Category identity, or undefined for ordinary workspaces.
   */
  setPickerCategory(categoryId: string | undefined): void {
    if (categoryId !== undefined && !this.providers.has(categoryId)) {
      throw new Error(`unknown workspace category: ${categoryId}`)
    }
    if (this.pickerCategoryId === categoryId) return
    this.pickerCategoryId = categoryId
    this.project()
  }

  private project(): void {
    const categories = [...this.providers.values()]
      .map(({ provider }) => ({
        id: provider.id,
        ...provider.source.getSnapshot(),
      }))
      .sort((left, right) => {
        const leftOrder = this.providers.get(left.id)?.provider.order ?? 0
        const rightOrder = this.providers.get(right.id)?.provider.order ?? 0
        return leftOrder - rightOrder || left.id.localeCompare(right.id)
      })
    this.store.set({
      categories,
      ...(this.pickerCategoryId === undefined ? {} : { pickerCategoryId: this.pickerCategoryId }),
    })
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Product-extensible workspace categories for the generic sidebar browser. */
    workspaceCategories: WorkspaceCategoryRegistry
  }
}
