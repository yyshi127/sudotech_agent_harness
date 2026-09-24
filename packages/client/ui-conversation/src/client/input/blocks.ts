/**
 * Composer blocks: the one way another plugin stops a session's input.
 *
 * The composer cannot read the plugins that would know — the dependency runs
 * ui-model-selection → ui-conversation, never back — so a blocker pushes here and the
 * bar reads its own session's store. A block carries the localized reason it
 * exists, because the plugin that raised it owns that copy; the composer only
 * knows how to render an inert textarea with a placeholder, exactly as it
 * already does for a session with no workspace.
 *
 * This is an affordance, not enforcement: the Host refuses a prompt it cannot
 * route regardless of what any client disables.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComposerBlock, ComposerBlocks } from '../contract/composer-blocks.ts'

/** The per-session composer-block registry (one instance per plugin fiber). */
export class ComposerBlockRegistry implements ComposerBlocks {
  private readonly stores = new Map<SessionId, SnapshotStore<ComposerBlock | undefined>>()
  private readonly owners = new Map<SessionId, Map<string, ComposerBlock>>()

  /** @inheritdoc */
  set(sessionId: SessionId, block: ComposerBlock | undefined): void {
    this.setOwned('', sessionId, block)
  }

  /** @inheritdoc */
  setOwned(owner: string, sessionId: SessionId, block: ComposerBlock | undefined): void {
    const owned = this.owners.get(sessionId) ?? new Map<string, ComposerBlock>()
    if (block === undefined) owned.delete(owner)
    else owned.set(owner, block)
    if (owned.size === 0) this.owners.delete(sessionId)
    else this.owners.set(sessionId, owned)
    const store = this.storeFor(sessionId)
    const next = owned.get('') ?? [...owned.entries()]
      .sort(([left], [right]) => left.localeCompare(right))[0]?.[1]
    const current = store.getSnapshot()
    if (current?.reason === next?.reason) return
    store.set(next)
  }

  /** @inheritdoc */
  storeFor(sessionId: SessionId): SnapshotStore<ComposerBlock | undefined> {
    const existing = this.stores.get(sessionId)
    if (existing !== undefined) return existing
    const created = createSnapshotStore<ComposerBlock | undefined>(undefined)
    this.stores.set(sessionId, created)
    return created
  }

  /** @inheritdoc */
  forget(sessionId: SessionId): void {
    this.stores.delete(sessionId)
    this.owners.delete(sessionId)
  }
}
