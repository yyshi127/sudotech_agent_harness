import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebFetchRequest, WebFetchResult, WebSearchResult } from '@deepseek-ai/dsh-web'
import { FinanceEvidenceCache } from '../src/cache.ts'
import { FinanceEvidenceEngine, type FinanceEvidenceFetch, type FinanceEvidenceSearch } from '../src/engine.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function engine(input: {
  results?: WebSearchResult[]
  fetch?: (url: string) => Promise<WebFetchResult>
  maxCandidates?: number
}) {
  const root = await mkdtemp(join(tmpdir(), 'xiaojing-finance-evidence-engine-'))
  roots.push(root)
  const cache = new FinanceEvidenceCache(root, 10, 60_000)
  await cache.init()
  let searchIndex = 0
  const searchMock = vi.fn(async () => input.results?.[searchIndex++] ?? { sources: [], truncated: false })
  const search: FinanceEvidenceSearch = { search: searchMock }
  const fetchMock = vi.fn(async (request: WebFetchRequest): Promise<WebFetchResult> => (
    input.fetch?.(request.url) ?? {
      url: request.url,
      statusCode: 200,
      body: {
        kind: 'html',
        content: '<h1>增值税政策公告</h1><p>全文有效</p><p>发文字号：国家税务总局公告〔2026〕1号</p>',
      },
      truncated: false,
    }
  ))
  const fetcher: FinanceEvidenceFetch = { fetch: fetchMock }
  return {
    value: new FinanceEvidenceEngine(search, fetcher, cache, {
      maxResultsPerQuery: 5,
      maxCandidates: input.maxCandidates ?? 5,
      maxExcerptChars: 120,
    }, () => new Date('2026-08-28T00:00:00.000Z')),
    searchMock,
    fetchMock,
  }
}

const result = (...sources: WebSearchResult['sources']): WebSearchResult => ({ sources, truncated: false })

describe('FinanceEvidenceEngine', () => {
  it('fetches only admitted official HTTPS candidates and verifies current formal text', async () => {
    const { value, searchMock, fetchMock } = await engine({
      results: [result(
        { url: 'https://fgk.chinatax.gov.cn/zcfgk/a.html', title: '增值税政策公告' },
        { url: 'https://evil.example/policy', title: '伪政策' },
        { url: 'http://www.mof.gov.cn/policy', title: '非 HTTPS' },
      ), result()],
    })
    const evidence = await value.research({ query: '增值税政策' })
    expect(evidence).toMatchObject({ status: 'verified', localitySource: 'none', jurisdiction: '中国大陆' })
    expect(evidence.evidence).toHaveLength(1)
    expect(evidence.evidence[0]).toMatchObject({ role: 'official-text', sourceId: 'state-tax-policy' })
    expect(searchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('adds a local query from immutable client locality and does not claim automatic applicability', async () => {
    const { value, searchMock } = await engine({
      results: [result(), result(), result({
        url: 'https://shanghai.chinatax.gov.cn/policy/a.html',
        title: '上海税务热点问答',
      })],
    })
    const evidence = await value.research({ query: '发票开具' }, { clientLocality: '上海市' })
    expect(searchMock).toHaveBeenCalledTimes(3)
    expect(evidence).toMatchObject({ locality: '上海市', localitySource: 'client' })
    expect(evidence.assumptions.join('')).toContain('不自动断言')
    expect(evidence.evidence[0]).toMatchObject({ applicability: 'local-conditional' })
  })

  it('returns out-of-scope without network access for unsupported jurisdictions', async () => {
    const { value, searchMock, fetchMock } = await engine({})
    const evidence = await value.research({ query: '利得税', locality: '香港特别行政区' })
    expect(evidence.status).toBe('out-of-scope')
    expect(searchMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps failed fetches as discovery-only and never uses their snippets as evidence', async () => {
    const { value } = await engine({
      results: [result({
        url: 'https://flk.npc.gov.cn/detail.html',
        title: '中华人民共和国税收征收管理法',
        snippet: '搜索摘要声称这是现行条文',
      }), result()],
      fetch: async () => { throw new Error('HTTP 403') },
    })
    const evidence = await value.research({ query: '税收征收管理法' })
    expect(evidence.status).toBe('partial')
    expect(evidence.evidence[0]).toMatchObject({ role: 'discovery-only', lifecycle: 'unverified' })
    expect(JSON.stringify(evidence)).not.toContain('搜索摘要声称')
    expect(evidence.warnings.join('')).toContain('待核验')
  })

  it('uses the bounded cache on a repeat request without fetching the page twice', async () => {
    const { value, fetchMock } = await engine({
      results: [result({ url: 'https://fgk.chinatax.gov.cn/zcfgk/a.html', title: '政策公告' }), result(),
        result({ url: 'https://fgk.chinatax.gov.cn/zcfgk/a.html', title: '政策公告' }), result()],
    })
    await value.research({ query: '政策公告' })
    const repeated = await value.research({ query: '政策公告' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(repeated.evidence[0]?.retrieval).toBe('cache')
  })

  it('returns pending when every discovery query fails', async () => {
    const { value, searchMock } = await engine({})
    searchMock.mockRejectedValue(new Error('provider unavailable'))
    const evidence = await value.research({ query: '企业所得税' })
    expect(evidence.status).toBe('pending')
    expect(evidence.warnings.join('')).toContain('未找到可核验')
  })

  it('reports truncated discovery and obeys the candidate ceiling', async () => {
    const { value, fetchMock } = await engine({
      maxCandidates: 1,
      results: [{
        sources: [
          { url: 'https://fgk.chinatax.gov.cn/a', title: '甲' },
          { url: 'https://www.mof.gov.cn/b', title: '乙' },
        ],
        truncated: true,
      }, result()],
    })
    const evidence = await value.research({ query: '税收政策' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(evidence.warnings.join('')).toContain('截断')
  })
})
