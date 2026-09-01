import { describe, expect, it } from 'vitest'
import { renderFinanceEvidence } from '../src/tool.ts'
import { FinanceEvidenceSourceId, type FinanceEvidenceResult } from '../src/types.ts'

describe('Finance evidence transcript rendering', () => {
  it('makes verification state, dates, role, limitations, and direct links explicit', () => {
    const result: FinanceEvidenceResult = {
      status: 'partial',
      query: '企业所得税',
      asOfDate: '2026-08-28',
      jurisdiction: '中国大陆',
      locality: '上海市',
      localitySource: 'request',
      checkedAt: '2026-08-28T00:00:00.000Z',
      assumptions: ['地区只用于检索。'],
      warnings: ['结论待核验。'],
      evidence: [{
        sourceId: FinanceEvidenceSourceId('state-tax-policy'),
        authority: '国家税务总局政策法规库',
        authorityLevel: 'L1',
        title: '企业所得税政策公告',
        documentNumber: '国家税务总局公告〔2026〕1号',
        publicationDate: '2026-01-01',
        lifecycle: 'unverified',
        legalEffect: 'normative-document',
        applicability: 'national-conditional',
        role: 'official-text',
        url: 'https://fgk.chinatax.gov.cn/a',
        retrievedAt: '2026-08-28T00:00:00.000Z',
        sha256: 'a'.repeat(64),
        excerpt: '官方正文摘录。',
        retrieval: 'network',
        rightsStatus: 'terms-review-pending',
        limitations: ['现行状态未确认。'],
      }],
    }
    const rendered = renderFinanceEvidence(result)
    expect(rendered).toContain('官方财税依据：部分核验')
    expect(rendered).toContain('已取得官方正文')
    expect(rendered).toContain('国家税务总局公告〔2026〕1号')
    expect(rendered).toContain('[企业所得税政策公告](https://fgk.chinatax.gov.cn/a)')
    expect(rendered).toContain('结论待核验')
  })
})
