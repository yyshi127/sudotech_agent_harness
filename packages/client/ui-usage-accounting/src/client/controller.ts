/** Browser-local current-key usage snapshot controller. */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { UsageAccountingSnapshot } from '@deepseek-ai/dsh-usage-accounting/types'

/** Generated Remote subset consumed by this presentation plugin. */
export interface UsageAccountingRemote {
  snapshot: () => Promise<RemoteResult<UsageAccountingSnapshot>>
}

/** Load state shared by the sidebar summary and settings calendar. */
export interface UsageAccountingView {
  status: 'idle' | 'loading' | 'ready' | 'error'
  snapshot: UsageAccountingSnapshot | null
  error: string | null
}

/** Current-key usage object layer. */
export class UsageAccountingController {
  /** Observable state consumed by both usage views. */
  readonly store: SnapshotStore<UsageAccountingView> = createSnapshotStore({
    status: 'idle', snapshot: null, error: null,
  })

  private generation = 0

  /** @param remote - generated Host accounting Remote. */
  constructor(private readonly remote: UsageAccountingRemote) {}

  /** Refresh the snapshot; a newer request wins over an older response. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    try {
      const carried = await this.remote.snapshot()
      if (generation !== this.generation) return
      if (!carried.ok) {
        this.store.update((state) => {
          state.status = 'error'
          state.error = carried.error.message
        })
        return
      }
      this.store.set({ status: 'ready', snapshot: carried.value, error: null })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'error'
        state.error = error instanceof Error ? error.message : String(error)
      })
    }
  }
}
