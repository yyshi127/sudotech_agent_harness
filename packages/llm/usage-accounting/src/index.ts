/** Local DeepSeek usage and request-time cost accounting service. */

import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { currentKeyFingerprint, installUsageObserver } from './compat.ts'
import type { UsageObservation } from './compat.ts'
import { EMBEDDED_PRICE_TABLE, priceUsage } from './pricing.ts'
import { ledgerInput, UsageLedgerStore } from './store.ts'
import type { UsageAccountingSnapshot } from './types.ts'

export type * from './types.ts'
export { beijingClock, EMBEDDED_PRICE_TABLE, isPeakTime, priceUsage } from './pricing.ts'
export type { PriceTable, UsageBuckets } from './pricing.ts'

/** Deployment settings for the local usage ledger. */
export interface Config {
  /** Explicit Harness home; omission follows `DSH_HOME`, then `~/.dsh`. */
  dshHome?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    usageAccounting: UsageAccountingService
  }
}

/** Runtime schema for local accounting storage. */
export const Config: s<Config> = s.object({
  dshHome: s.string(),
})

/** Host service owning the ledger, built-in pricing, Remote, and stream observer. */
export class UsageAccountingService extends TypertRemoteService {
  static inject = ['llm', 'settings', 'credentials']
  static Config = Config

  private readonly store: UsageLedgerStore
  private writeTail: Promise<void> = Promise.resolve()
  private accepting = true
  private committedRevision = 0

  /** Current process-local committed revision, read by the invariant companion. */
  get revision(): number {
    return this.committedRevision
  }

  /**
   * @param ctx - Host context carrying LLM, settings, and credentials.
   * @param config - local ledger path.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'usageAccounting')
    this.store = new UsageLedgerStore(resolveDshHome(config.dshHome))
  }

  /** Validate durable state, then observe provider usage. */
  protected async [Service.init](): Promise<void> {
    await this.store.init()
    const dispose = installUsageObserver(this.ctx, {
      settle: observation => this.enqueue(observation),
      fail: (error) => { this.warnContained(error) },
    })
    this.ctx.effect(() => async () => {
      dispose()
      this.accepting = false
      await this.writeTail
    }, 'usage-accounting: stop observer and drain ledger writes')
  }

  /**
   * Return only the current API key's current-month usage.
   * @returns current Beijing-month snapshot without credential material.
   */
  @Remote('snapshot')
  async snapshot(): Promise<UsageAccountingSnapshot> {
    return this.store.snapshot(
      await currentKeyFingerprint(this.ctx),
      this.committedRevision,
      Date.now(),
      [EMBEDDED_PRICE_TABLE],
    )
  }

  private enqueue(observation: UsageObservation): Promise<void> {
    if (!this.accepting) return Promise.resolve()
    const operation = this.writeTail.then(async () => {
      const priced = priceUsage(
        EMBEDDED_PRICE_TABLE,
        observation.model,
        observation.usage,
        observation.occurredAt,
        observation.officialEndpoint,
      )
      await this.store.append(ledgerInput(observation, priced))
      this.committedRevision++
      this.notifyUpdated()
    })
    this.writeTail = operation.catch((error: unknown) => { this.warnContained(error) })
    return operation
  }

  private notifyUpdated(): void {
    let invariantFailure: unknown
    const args = ['usage-accounting/updated', this.committedRevision]
    for (const listener of this.ctx.events.dispatch('emit', args) as Array<(revision: number) => unknown>) {
      try {
        const returned = listener(this.committedRevision)
        if (returned != null && typeof (returned as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(returned as PromiseLike<unknown>).then(undefined, (error: unknown) => {
            this.warnContained(error)
          })
        }
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'INVARIANT') invariantFailure ??= error
        else this.warnContained(error)
      }
    }
    if (invariantFailure !== undefined) throw invariantFailure as Error
  }

  private warnContained(error: unknown): void {
    this.ctx.logger.warn('usage-accounting: a non-fatal accounting operation failed')
    this.ctx.logger.warn(error)
  }
}

export default UsageAccountingService
