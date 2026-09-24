/** Xiaojing Finance official-source evidence service. */

import { Service, type Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'
import type {} from '@deepseek-ai/dsh-web'
import type {} from '@deepseek-ai/dsh-xiaojing-finance-domain'
import { FinanceEvidenceCache } from './cache.ts'
import { financeEvidenceClientLocality, financeEvidenceSearch } from './compat.ts'
import { FinanceEvidenceEngine } from './engine.ts'
import type { FinanceEvidenceRequest, FinanceEvidenceResult } from './types.ts'

export type * from './types.ts'
export { FinanceEvidenceCache } from './cache.ts'
export { FinanceEvidenceEngine } from './engine.ts'
export { OFFICIAL_SOURCES, sourceForUrl } from './source-registry.ts'
export { parseOfficialDocument } from './parser.ts'

/** Deployment limits for official-source retrieval and bounded caching. */
export interface Config {
  /** Explicit Harness home; omission follows `DSH_HOME`, then `~/.dsh`. */
  dshHome?: string
  /** Search result cap for each planned official-domain query. */
  maxResultsPerQuery?: number
  /** Maximum official URLs fetched in one tool call. */
  maxCandidates?: number
  /** Maximum characters retained in one official-text excerpt. */
  maxExcerptChars?: number
  /** Structured-cache entry ceiling. */
  maxCacheEntries?: number
  /** Structured-cache lifetime in milliseconds. */
  cacheTtlMs?: number
  /** Direct official-page fetch timeout in milliseconds. */
  fetchTimeoutMs?: number
  /** Maximum official response bytes read. */
  maxResponseBytes?: number
  /** Maximum decoded official response characters. */
  maxBodyChars?: number
  /** Same-origin redirect ceiling. */
  maxRedirects?: number
}

/** Runtime configuration schema. */
export const Config: s<Config> = s.object({
  dshHome: s.string(),
  maxResultsPerQuery: s.number().default(6),
  maxCandidates: s.number().default(8),
  maxExcerptChars: s.number().default(600),
  maxCacheEntries: s.number().default(200),
  cacheTtlMs: s.number().default(86_400_000),
  fetchTimeoutMs: s.number().default(15_000),
  maxResponseBytes: s.number().default(2_000_000),
  maxBodyChars: s.number().default(120_000),
  maxRedirects: s.number().default(3),
})

type ResolvedConfig = Required<Omit<Config, 'dshHome'>> & Pick<Config, 'dshHome'>

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`xiaojing-finance-evidence: ${name} must be a positive safe integer`)
  }
  return value
}

function nonNegativeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`xiaojing-finance-evidence: ${name} must be a non-negative safe integer`)
  }
  return value
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Date-aware official finance-tax evidence retrieval. */
    xiaojingFinanceEvidence: XiaojingFinanceEvidence
  }
}

/** Host service used only by the Finance preset's evidence tool. */
export class XiaojingFinanceEvidence extends Service {
  static inject = ['web', 'xiaojingFinanceDomain']
  static Config = Config

  private readonly cache: FinanceEvidenceCache
  private readonly engine: FinanceEvidenceEngine

  /** @param ctx - Host context. @param config - Retrieval and cache limits. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'xiaojingFinanceEvidence')
    const resolved = config as ResolvedConfig
    const maxResultsPerQuery = positiveInteger('maxResultsPerQuery', resolved.maxResultsPerQuery)
    const maxCandidates = positiveInteger('maxCandidates', resolved.maxCandidates)
    const maxExcerptChars = positiveInteger('maxExcerptChars', resolved.maxExcerptChars)
    const maxCacheEntries = positiveInteger('maxCacheEntries', resolved.maxCacheEntries)
    const cacheTtlMs = positiveInteger('cacheTtlMs', resolved.cacheTtlMs)
    const fetchTimeoutMs = positiveInteger('fetchTimeoutMs', resolved.fetchTimeoutMs)
    const maxResponseBytes = positiveInteger('maxResponseBytes', resolved.maxResponseBytes)
    const maxBodyChars = positiveInteger('maxBodyChars', resolved.maxBodyChars)
    const maxRedirects = nonNegativeInteger('maxRedirects', resolved.maxRedirects)
    this.cache = new FinanceEvidenceCache(resolveDshHome(resolved.dshHome), maxCacheEntries, cacheTtlMs)
    const fetcher = new HttpFetchProvider({
      maxResponseBytes,
      maxBodyChars,
      timeoutMs: fetchTimeoutMs,
      maxRedirects,
      userAgent: 'xiaojing-accounting/0.2.3 official-evidence (+https://www.sudotech.ai)',
    })
    this.engine = new FinanceEvidenceEngine(financeEvidenceSearch(ctx), fetcher, this.cache, {
      maxResultsPerQuery,
      maxCandidates,
      maxExcerptChars,
    })
  }

  /** Validate the durable cache before the service is published. */
  protected async [Service.init](): Promise<void> {
    await this.cache.init()
  }

  /**
   * Research official evidence for one Finance agent.
   * @param agent - Calling Finance agent.
   * @param request - Research request.
   * @param signal - Cancellation signal.
   * @returns Auditable evidence result.
   */
  research(agent: Agent, request: FinanceEvidenceRequest, signal?: AbortSignal): Promise<FinanceEvidenceResult> {
    const clientLocality = financeEvidenceClientLocality(this.ctx, agent)
    return this.engine.research(request, {
      ...clientLocality === undefined ? {} : { clientLocality },
    }, signal)
  }
}

export default XiaojingFinanceEvidence
