import { describe, expect, it } from 'vitest'
import { parseOfficialDocument } from '../src/parser.ts'
import { sourceForUrl } from '../src/source-registry.ts'

function source(url: string) {
  const value = sourceForUrl(url)
  if (value === undefined) throw new Error(`missing test source for ${url}`)
  return value
}

function parse(body: string, asOfDate = '2026-08-28', url = 'https://fgk.chinatax.gov.cn/zcfgk/c100009/test/content.html') {
  return parseOfficialDocument({
    source: source(url),
    url,
    body,
    bodyKind: 'html',
    query: '增值税 小规模纳税人',
    asOfDate,
    retrievedAt: '2026-08-28T00:00:00.000Z',
    maxExcerptChars: 120,
  })
}

describe('official document parsing', () => {
  it('extracts current formal policy metadata and hashes only fetched text', () => {
    const item = parse(`
      <html><head><title>关于增值税小规模纳税人政策的公告 - 国家税务总局</title></head>
      <body><h1>关于增值税小规模纳税人政策的公告</h1>
      <p>发文字号：国家税务总局公告〔2026〕12号</p><p>全文有效</p>
      <p>成文日期：2026年01月05日</p><p>自2026年2月1日起施行</p>
      <p>增值税小规模纳税人按本公告规定办理。</p></body></html>
    `)

    expect(item).toMatchObject({
      title: '关于增值税小规模纳税人政策的公告',
      documentNumber: '国家税务总局公告〔2026〕12号',
      publicationDate: '2026-01-05',
      effectiveFrom: '2026-02-01',
      lifecycle: 'current',
      legalEffect: 'normative-document',
      authorityLevel: 'L1',
      role: 'official-text',
      retrieval: 'network',
      rightsStatus: 'terms-review-pending',
    })
    expect(item.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(item.excerpt).toContain('增值税')
    expect(item.excerpt?.length).toBeLessThanOrEqual(122)
  })

  it.each([
    ['historical', '<h1>阶段性政策通知</h1><p>执行日期：2024年1月1日</p><p>执行至2025年12月31日</p>'],
    ['future', '<h1>未来政策公告</h1><p>自2027年1月1日起施行</p>'],
    ['repealed', '<h1>旧政策公告</h1><p>状态：全文废止</p>'],
    ['draft', '<h1>关于公开征求意见稿的通知</h1><p>本文件为草案。</p>'],
    ['amended', '<h1>政策公告</h1><p>状态：部分条款废止</p>'],
    ['transitional', '<h1>衔接政策通知</h1><p>设置两年过渡期。</p>'],
  ] as const)('classifies %s lifecycle without treating it as current', (expected, body) => {
    expect(parse(body).lifecycle).toBe(expected)
  })

  it('keeps status unverified when an official page lacks lifecycle proof', () => {
    const item = parse('<h1>企业会计处理问题解答</h1><p>发布日期：2026-06-01</p><p>提供操作说明。</p>')
    expect(item).toMatchObject({ lifecycle: 'unverified', legalEffect: 'official-guidance', authorityLevel: 'L2' })
    expect(item.limitations).toContain('页面未提供足以确认现行效力的状态或日期信息。')
  })

  it('labels provincial tax guidance as local and conditional', () => {
    const url = 'https://shanghai.chinatax.gov.cn/bsfw/zcjd/test.html'
    const item = parseOfficialDocument({
      source: source(url),
      url,
      searchTitle: '上海税务热点问答',
      searchPublishedAt: '2026-07-01T00:00:00.000Z',
      body: '上海税务热点问题答复。状态：现行有效。',
      bodyKind: 'text',
      query: '发票',
      asOfDate: '2026-08-28',
      retrievedAt: '2026-08-28T00:00:00.000Z',
      maxExcerptChars: 80,
    })
    expect(item).toMatchObject({
      sourceId: 'local-tax',
      applicability: 'local-conditional',
      legalEffect: 'official-guidance',
      authorityLevel: 'L2',
      lifecycle: 'current',
    })
  })
})
