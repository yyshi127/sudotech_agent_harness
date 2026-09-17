import { describe, expect, it } from 'vitest'
import {
  classifyCandidate,
  isMainlandLocality,
  normalizeEvidenceRequest,
  planOfficialQueries,
  sourceForUrl,
} from '../src/source-registry.ts'

describe('official source registry', () => {
  it.each([
    ['https://flk.npc.gov.cn/detail.html', 'national-laws'],
    ['https://www.gov.cn/zhengce/test.htm', 'state-council'],
    ['https://fgk.chinatax.gov.cn/zcfgk/test.html', 'state-tax-policy'],
    ['https://www.chinatax.gov.cn/chinatax/n810341/index.html', 'state-tax'],
    ['https://kjs.mof.gov.cn/zhengcefabu/test.htm', 'ministry-finance'],
    ['https://jiangsu.chinatax.gov.cn/art/test.html', 'local-tax'],
  ])('admits %s as %s', (url, id) => {
    expect(sourceForUrl(url)?.id).toBe(id)
  })

  it.each([
    'http://fgk.chinatax.gov.cn/zcfgk/test.html',
    'https://fgk.chinatax.gov.cn.evil.example/test',
    'https://user:secret@www.gov.cn/test',
    'not a url',
  ])('rejects unsafe or nonofficial URL %s', (url) => {
    expect(sourceForUrl(url)).toBeUndefined()
  })

  it('searches national sources and adds local discovery only when locality exists', () => {
    expect(planOfficialQueries({ query: '企业所得税' })).toHaveLength(2)
    expect(planOfficialQueries({ query: '企业所得税', locality: '上海市' })).toEqual([
      '(site:fgk.chinatax.gov.cn OR site:mof.gov.cn) 企业所得税',
      '(site:flk.npc.gov.cn OR site:www.gov.cn) 企业所得税',
      'site:chinatax.gov.cn 上海市 企业所得税',
    ])
  })

  it('normalizes query and validates a real as-of date', () => {
    expect(normalizeEvidenceRequest({ query: '  增值税   发票  ', locality: ' 上海市 ' }, '2026-08-28'))
      .toEqual({ query: '增值税 发票', asOfDate: '2026-08-28', locality: '上海市' })
    expect(() => normalizeEvidenceRequest({ query: '增值税', asOfDate: '2026-02-31' }, '2026-08-28'))
      .toThrow(/real YYYY-MM-DD/)
    expect(() => normalizeEvidenceRequest({ query: ' ' }, '2026-08-28')).toThrow(/2 to 500/)
  })

  it('supports Mainland localities but not Hong Kong, Macao, Taiwan, or unknown jurisdictions', () => {
    expect(isMainlandLocality('上海市浦东新区')).toBe(true)
    expect(isMainlandLocality('苏州市')).toBe(true)
    expect(isMainlandLocality('新疆维吾尔自治区')).toBe(true)
    expect(isMainlandLocality('香港特别行政区')).toBe(false)
    expect(isMainlandLocality('United States')).toBe(false)
  })

  it('does not admit a local result when no local applicability was requested', () => {
    const candidate = { url: 'https://shanghai.chinatax.gov.cn/test', title: '上海税务' }
    expect(classifyCandidate(candidate, undefined)).toBeUndefined()
    expect(classifyCandidate(candidate, '上海市')?.source.id).toBe('local-tax')
  })
})
