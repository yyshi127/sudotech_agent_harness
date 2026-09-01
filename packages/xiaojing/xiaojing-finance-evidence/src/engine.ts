/** Official-source discovery, safe retrieval, parsing, and evidence-state orchestration. */

import type { WebFetchRequest, WebFetchResult, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { FinanceEvidenceCache } from './cache.ts'
import { parseOfficialDocument } from './parser.ts'
import {
  classifyCandidate,
  isMainlandLocality,
  normalizeEvidenceRequest,
  OFFICIAL_SOURCES,
  planOfficialQueries,
  sourceForUrl,
  type OfficialSourceDefinition,
} from './source-registry.ts'
import type {
  FinanceEvidenceItem,
  FinanceEvidenceRequest,
  FinanceEvidenceResult,
} from './types.ts'

/** Search dependency accepted by the engine. */
export interface FinanceEvidenceSearch {
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
}

/** Fetch dependency accepted by the engine. */
export interface FinanceEvidenceFetch {
  fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>
}

/** Engine limits resolved from deployment configuration. */
export interface FinanceEvidenceEngineOptions {
  maxResultsPerQuery: number
  maxCandidates: number
  maxExcerptChars: number
}

/** Optional immutable client context used only to default locality. */
export interface FinanceEvidenceContext {
  clientLocality?: string
}

interface Candidate {
  candidate: WebSearchSource
  source: OfficialSourceDefinition
}

function beijingDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const read = (type: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === type)?.value ?? ''
  return `${read('year')}-${read('month')}-${read('day')}`
}

function discoveryItem(candidate: Candidate, reason: string): FinanceEvidenceItem {
  const publicationDate = candidate.candidate.publishedAt?.slice(0, 10)
  return {
    sourceId: candidate.source.id,
    authority: candidate.source.authority,
    authorityLevel: candidate.source.authorityLevel,
    title: candidate.candidate.title?.trim() || candidate.source.authority,
    ...publicationDate === undefined ? {} : { publicationDate },
    lifecycle: 'unverified',
    legalEffect: 'unknown',
    applicability: candidate.source.scope === 'local' ? 'local-conditional' : 'unverified',
    role: 'discovery-only',
    url: candidate.candidate.url,
    retrieval: 'not-fetched',
    rightsStatus: 'terms-review-pending',
    limitations: [
      reason,
      '搜索标题和摘要只用于发现官方文件，不能作为最终依据。',
    ],
  }
}

function sourceRank(id: FinanceEvidenceItem['sourceId']): number {
  const rank = OFFICIAL_SOURCES.findIndex(source => source.id === id)
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank
}

function evidenceOrder(left: FinanceEvidenceItem, right: FinanceEvidenceItem): number {
  if (left.role !== right.role) return left.role === 'official-text' ? -1 : 1
  if (left.authorityLevel !== right.authorityLevel) return left.authorityLevel.localeCompare(right.authorityLevel)
  return sourceRank(left.sourceId) - sourceRank(right.sourceId)
}

function deduplicateCandidates(results: readonly WebSearchResult[], locality: string | undefined): Candidate[] {
  const seen = new Set<string>()
  const candidates: Candidate[] = []
  for (const result of results) {
    for (const candidate of result.sources) {
      if (seen.has(candidate.url)) continue
      const classified = classifyCandidate(candidate, locality)
      if (classified === undefined) continue
      seen.add(candidate.url)
      candidates.push(classified)
    }
  }
  return candidates
}

function statusOf(items: readonly FinanceEvidenceItem[]): FinanceEvidenceResult['status'] {
  const fetched = items.filter(item => item.role === 'official-text')
  if (fetched.some(item => item.lifecycle === 'current' && item.legalEffect !== 'unknown')) return 'verified'
  if (items.length > 0) return 'partial'
  return 'pending'
}

/** Date-aware evidence engine that never treats provider snippets as final authority. */
export class FinanceEvidenceEngine {
  /**
   * @param search - Existing Harness search seam.
   * @param fetcher - Whitelist-gated HTTP fetcher.
   * @param cache - Bounded metadata cache.
   * @param options - Deployment limits.
   * @param now - Testable clock.
   */
  constructor(
    private readonly search: FinanceEvidenceSearch,
    private readonly fetcher: FinanceEvidenceFetch,
    private readonly cache: FinanceEvidenceCache,
    private readonly options: FinanceEvidenceEngineOptions,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Research one rule-dependent question.
   * @param request - User research request.
   * @param context - Optional client locality.
   * @param signal - Cancellation signal.
   * @returns Auditable evidence state.
   */
  async research(
    request: FinanceEvidenceRequest,
    context: FinanceEvidenceContext = {},
    signal?: AbortSignal,
  ): Promise<FinanceEvidenceResult> {
    const started = this.now()
    const locality = request.locality?.trim() || context.clientLocality?.trim()
    const normalized = normalizeEvidenceRequest(
      { ...request, ...locality ? { locality } : {} },
      beijingDate(started),
    )
    const localitySource = request.locality?.trim()
      ? 'request' as const
      : context.clientLocality?.trim()
        ? 'client' as const
        : 'none' as const
    const base = {
      query: normalized.query,
      asOfDate: normalized.asOfDate,
      jurisdiction: '中国大陆' as const,
      ...normalized.locality === undefined ? {} : { locality: normalized.locality },
      localitySource,
      checkedAt: started.toISOString(),
    }
    if (normalized.locality !== undefined && !isMainlandLocality(normalized.locality)) {
      return {
        ...base,
        status: 'out-of-scope',
        evidence: [],
        assumptions: [],
        warnings: ['本服务只核验中国大陆财税依据；香港、澳门、台湾及境外规则待使用对应司法辖区来源核验。'],
      }
    }

    const assumptions = normalized.locality === undefined
      ? ['未指定地区；本轮只检索国家层级依据，地方执行口径待核验。']
      : [
        localitySource === 'client'
          ? `使用客户档案注册地址“${normalized.locality}”作为检索线索，不自动断言政策适用于该客户。`
          : `使用用户指定地区“${normalized.locality}”作为检索线索，不自动断言政策适用于全部业务事实。`,
      ]
    const warnings: string[] = []
    const searches = await Promise.allSettled(planOfficialQueries(normalized).map(query => (
      this.search.search({ query, maxResults: this.options.maxResultsPerQuery }, signal)
    )))
    if (signal?.aborted === true) throw signal.reason
    const successful: WebSearchResult[] = []
    for (const outcome of searches) {
      if (outcome.status === 'fulfilled') successful.push(outcome.value)
      else warnings.push('一个官方来源发现查询失败；未将失败查询推断为“无相关政策”。')
    }
    const candidates = deduplicateCandidates(successful, normalized.locality)
      .slice(0, this.options.maxCandidates)
    if (candidates.length === 0) {
      return {
        ...base,
        status: 'pending',
        evidence: [],
        assumptions,
        warnings: [...warnings, '未找到可核验的官方页面，结论待核验。'],
      }
    }

    const items = await Promise.all(candidates.map(candidate => this.resolveCandidate(
      candidate,
      normalized.query,
      normalized.asOfDate,
      signal,
    )))
    items.sort(evidenceOrder)
    const status = statusOf(items)
    if (status !== 'verified') warnings.push('尚未取得同时具备官方正文、明确法律效力和现行状态的依据，关键结论待核验。')
    if (successful.some(result => result.truncated)) warnings.push('搜索提供方截断了部分候选结果，本轮证据不代表完整法规清单。')
    return { ...base, status, evidence: items, assumptions, warnings }
  }

  private async resolveCandidate(
    candidate: Candidate,
    query: string,
    asOfDate: string,
    signal: AbortSignal | undefined,
  ): Promise<FinanceEvidenceItem> {
    const now = this.now().getTime()
    const cached = await this.cache.get(candidate.candidate.url, now)
    if (cached !== undefined) return cached
    try {
      if (sourceForUrl(candidate.candidate.url) === undefined) {
        return discoveryItem(candidate, 'URL 未通过官方 HTTPS 白名单校验，未抓取正文。')
      }
      const fetched = await this.fetcher.fetch({ url: candidate.candidate.url }, signal)
      if (fetched.statusCode < 200 || fetched.statusCode >= 300) {
        return discoveryItem(candidate, `官方页面返回 HTTP ${fetched.statusCode}，未取得正文。`)
      }
      const finalSource = sourceForUrl(fetched.url)
      if (finalSource === undefined || finalSource.id !== candidate.source.id) {
        return discoveryItem(candidate, '页面跳转后的地址不属于原官方来源，未采用正文。')
      }
      const item = parseOfficialDocument({
        source: finalSource,
        url: fetched.url,
        ...candidate.candidate.title === undefined ? {} : { searchTitle: candidate.candidate.title },
        ...candidate.candidate.publishedAt === undefined ? {} : { searchPublishedAt: candidate.candidate.publishedAt },
        body: fetched.body.content,
        bodyKind: fetched.body.kind,
        query,
        asOfDate,
        retrievedAt: this.now().toISOString(),
        maxExcerptChars: this.options.maxExcerptChars,
      })
      if (fetched.truncated) item.limitations.push('官方页面正文抓取达到大小上限，摘录可能不完整。')
      await this.cache.put(item, now)
      return item
    } catch {
      if (signal?.aborted === true) throw signal.reason
      return discoveryItem(candidate, '官方正文抓取失败或超时，未取得正文。')
    }
  }
}
