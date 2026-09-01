/** Parse bounded official pages into attributable evidence metadata and excerpts. */

import { createHash } from 'node:crypto'
import TurndownService from 'turndown'
import type { OfficialSourceDefinition } from './source-registry.ts'
import type {
  FinanceEvidenceApplicability,
  FinanceEvidenceAuthorityLevel,
  FinanceEvidenceItem,
  FinanceEvidenceLegalEffect,
  FinanceEvidenceLifecycle,
} from './types.ts'

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' })
const DATE = '(\\d{4})[年./\\-](\\d{1,2})[月./\\-](\\d{1,2})日?'

/** Inputs required to parse one fetched official page. */
export interface OfficialDocumentInput {
  source: OfficialSourceDefinition
  url: string
  searchTitle?: string
  searchPublishedAt?: string
  body: string
  bodyKind: 'html' | 'text'
  query: string
  asOfDate: string
  retrievedAt: string
  maxExcerptChars: number
}

function normalizeDate(match: RegExpMatchArray): string | undefined {
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function dateAfter(text: string, labels: readonly string[]): string | undefined {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}[^\\d]{0,20}${DATE}`, 'u'))
    if (match !== null) return normalizeDate(match)
  }
  return undefined
}

function pageText(body: string, kind: 'html' | 'text'): string {
  if (kind === 'text') return body.replace(/\s+/gu, ' ').trim()
  const withoutExecutable = body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, ' ')
  return turndown.turndown(withoutExecutable)
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[#>*_`|]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function titleFromHtml(body: string): string | undefined {
  for (const pattern of [/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu, /<title\b[^>]*>([\s\S]*?)<\/title>/iu]) {
    const match = body.match(pattern)
    if (match?.[1] !== undefined) {
      const title = pageText(match[1], 'html').replace(/[-_|]\s*(?:国家税务总局|财政部|中国政府网).*$/u, '').trim()
      if (title.length > 0) return title.slice(0, 300)
    }
  }
  return undefined
}

function documentNumber(text: string): string | undefined {
  const labeled = text.match(/(?:发文字号|文号)[：:\s]*([^\s，。；]{4,80}号)/u)?.[1]
  if (labeled !== undefined) return labeled
  return text.match(/(?:国家税务总局|财政部|国务院|国办|财税|税总发|税总函)[^，。；\n]{0,60}(?:公告|令|发|函)?\s*[〔\[]?\d{4}[〕\]]?\s*第?\d+号/u)?.[0]
}

function legalEffect(title: string, text: string): FinanceEvidenceLegalEffect {
  const head = `${title} ${text.slice(0, 1500)}`
  if (/中华人民共和国[^\s，。]{0,30}法/u.test(title)) return 'law'
  if (/行政法规|国务院令|条例/u.test(head)) return 'administrative-regulation'
  if (/(?:财政部|国家税务总局).*令第?\d+号/u.test(head)) return 'departmental-rule'
  if (/公告|通知|批复|办法|意见|规定/u.test(title)) return 'normative-document'
  if (/解读|问答|解答|答复|指南|指引|热点问题/u.test(title)) return 'official-guidance'
  return 'unknown'
}

function authorityLevel(
  baseline: FinanceEvidenceAuthorityLevel,
  effect: FinanceEvidenceLegalEffect,
): FinanceEvidenceAuthorityLevel {
  if (effect === 'law' || effect === 'administrative-regulation') return 'L0'
  if (effect === 'departmental-rule' || effect === 'normative-document') return baseline === 'L0' ? 'L1' : baseline
  if (effect === 'official-guidance') return baseline === 'L3' ? 'L3' : 'L2'
  return baseline
}

function lifecycle(
  title: string,
  text: string,
  asOfDate: string,
  effectiveFrom: string | undefined,
  effectiveTo: string | undefined,
): FinanceEvidenceLifecycle {
  const statusText = `${title} ${text.slice(0, 2500)}`
  if (/征求意见稿|草案|公开征求意见/u.test(statusText)) return 'draft'
  if (/全文废止|全文失效|已废止|已失效/u.test(statusText)) return 'repealed'
  if (/部分条款(?:废止|失效)|部分有效/u.test(statusText)) return 'amended'
  if (/过渡期|过渡性/u.test(statusText)) return 'transitional'
  if (effectiveFrom !== undefined && effectiveFrom > asOfDate) return 'future'
  if (effectiveTo !== undefined && effectiveTo < asOfDate) return 'historical'
  if (/全文有效|现行有效|状态[：:\s]*有效/u.test(statusText)) return 'current'
  return 'unverified'
}

function applicability(source: OfficialSourceDefinition): FinanceEvidenceApplicability {
  return source.scope === 'local' ? 'local-conditional' : 'national-conditional'
}

function excerptAround(text: string, query: string, maxChars: number): string {
  const terms = query.split(/[\s，。；、：:()（）]+/u).filter(term => term.length >= 2)
  const index = terms.map(term => text.indexOf(term)).find(position => position >= 0) ?? 0
  const start = Math.max(0, index - Math.floor(maxChars / 4))
  const excerpt = text.slice(start, start + maxChars).trim()
  return `${start > 0 ? '…' : ''}${excerpt}${start + maxChars < text.length ? '…' : ''}`
}

/**
 * Parse one fetched official page.
 * @param input - Page, source, and date context.
 * @returns Bounded evidence item.
 */
export function parseOfficialDocument(input: OfficialDocumentInput): FinanceEvidenceItem {
  const text = pageText(input.body, input.bodyKind)
  const title = (input.bodyKind === 'html' ? titleFromHtml(input.body) : undefined)
    ?? input.searchTitle?.trim()
    ?? input.source.authority
  const publicationDate = dateAfter(text, ['成文日期', '发布日期', '发布时间', '发布日'])
    ?? input.searchPublishedAt?.slice(0, 10)
  const effectiveFrom = dateAfter(text, ['施行日期', '执行日期', '生效日期', '自'])
  const effectiveTo = dateAfter(text, ['有效期至', '执行至', '截止日期', '截至'])
  const effect = legalEffect(title, text)
  const status = lifecycle(title, text, input.asOfDate, effectiveFrom, effectiveTo)
  const limitations = ['公开页面的转载与批量使用条款尚待逐站点审阅。']
  if (status === 'unverified') limitations.push('页面未提供足以确认现行效力的状态或日期信息。')
  if (effect === 'unknown') limitations.push('无法仅凭页面确认文件的法律效力类型。')
  if (input.source.scope === 'local') limitations.push('地方口径只在地区和业务事实均匹配时提供条件性依据。')
  const number = documentNumber(text)
  return {
    sourceId: input.source.id,
    authority: input.source.authority,
    authorityLevel: authorityLevel(input.source.authorityLevel, effect),
    title,
    ...number === undefined ? {} : { documentNumber: number },
    ...publicationDate === undefined ? {} : { publicationDate },
    ...effectiveFrom === undefined ? {} : { effectiveFrom },
    ...effectiveTo === undefined ? {} : { effectiveTo },
    lifecycle: status,
    legalEffect: effect,
    applicability: applicability(input.source),
    role: 'official-text',
    url: input.url,
    retrievedAt: input.retrievedAt,
    sha256: createHash('sha256').update(input.body).digest('hex'),
    excerpt: excerptAround(text, input.query, input.maxExcerptChars),
    retrieval: 'network',
    rightsStatus: 'terms-review-pending',
    limitations,
  }
}
