/** Fixed official-source registry and Mainland China query planning. */

import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import {
  FinanceEvidenceSourceId,
  type FinanceEvidenceAuthorityLevel,
  type FinanceEvidenceRequest,
  type FinanceEvidenceSourceId as SourceId,
} from './types.ts'

/** Official source definition used for URL admission and baseline authority. */
export interface OfficialSourceDefinition {
  id: SourceId
  authority: string
  authorityLevel: FinanceEvidenceAuthorityLevel
  scope: 'national' | 'local'
  matches(hostname: string): boolean
}

const exactHost = (...hosts: string[]) => (hostname: string): boolean => hosts.includes(hostname)
const hostOrSubdomain = (root: string) => (hostname: string): boolean => hostname === root || hostname.endsWith(`.${root}`)

/** Ordered registry; exact national tax hosts precede the provincial wildcard. */
export const OFFICIAL_SOURCES: readonly OfficialSourceDefinition[] = [
  {
    id: FinanceEvidenceSourceId('national-laws'),
    authority: '国家法律法规数据库',
    authorityLevel: 'L0',
    scope: 'national',
    matches: exactHost('flk.npc.gov.cn'),
  },
  {
    id: FinanceEvidenceSourceId('state-council'),
    authority: '中国政府网',
    authorityLevel: 'L1',
    scope: 'national',
    matches: exactHost('gov.cn', 'www.gov.cn', 'sousuo.www.gov.cn'),
  },
  {
    id: FinanceEvidenceSourceId('state-tax-policy'),
    authority: '国家税务总局政策法规库',
    authorityLevel: 'L1',
    scope: 'national',
    matches: exactHost('fgk.chinatax.gov.cn'),
  },
  {
    id: FinanceEvidenceSourceId('state-tax'),
    authority: '国家税务总局',
    authorityLevel: 'L2',
    scope: 'national',
    matches: exactHost('chinatax.gov.cn', 'www.chinatax.gov.cn'),
  },
  {
    id: FinanceEvidenceSourceId('ministry-finance'),
    authority: '财政部',
    authorityLevel: 'L1',
    scope: 'national',
    matches: hostOrSubdomain('mof.gov.cn'),
  },
  {
    id: FinanceEvidenceSourceId('local-tax'),
    authority: '地方税务机关',
    authorityLevel: 'L2',
    scope: 'local',
    matches: hostname => hostname.endsWith('.chinatax.gov.cn'),
  },
]

const MAINLAND_LOCALITIES = [
  '中国大陆', '大陆',
  '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江',
  '上海', '江苏', '苏州', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北',
  '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州', '云南', '西藏',
  '陕西', '甘肃', '青海', '宁夏', '新疆',
] as const

const EXCLUDED_LOCALITIES = /香港|澳门|澳門|台湾|臺灣|hong\s*kong|macao|macau|taiwan/iu

/**
 * Resolve an admitted official HTTPS source.
 * @param value - Candidate URL.
 * @returns Matching source or undefined.
 */
export function sourceForUrl(value: string): OfficialSourceDefinition | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return undefined
  const hostname = url.hostname.toLowerCase()
  return OFFICIAL_SOURCES.find(source => source.matches(hostname))
}

/**
 * Whether a supplied locality is supported by the Mainland-only service.
 * @param locality - User or client locality.
 * @returns Support decision.
 */
export function isMainlandLocality(locality: string): boolean {
  const normalized = locality.trim()
  if (normalized.length === 0 || EXCLUDED_LOCALITIES.test(normalized)) return false
  return MAINLAND_LOCALITIES.some(candidate => normalized.includes(candidate))
}

/**
 * Normalize and validate one research request.
 * @param request - Raw tool request.
 * @param today - Beijing date fallback.
 * @returns Valid request.
 */
export function normalizeEvidenceRequest(
  request: FinanceEvidenceRequest,
  today: string,
): Required<Pick<FinanceEvidenceRequest, 'query' | 'asOfDate'>> & Pick<FinanceEvidenceRequest, 'locality'> {
  const query = request.query.trim().replace(/\s+/gu, ' ')
  if (query.length < 2 || query.length > 500) {
    throw new Error('xiaojing-finance-evidence: query must contain 2 to 500 characters')
  }
  const asOfDate = request.asOfDate?.trim() || today
  const match = asOfDate.match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  const calendarDate = match === null
    ? undefined
    : new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (match === null
    || calendarDate === undefined
    || calendarDate.getUTCFullYear() !== Number(match[1])
    || calendarDate.getUTCMonth() !== Number(match[2]) - 1
    || calendarDate.getUTCDate() !== Number(match[3])) {
    throw new Error('xiaojing-finance-evidence: asOfDate must be a real YYYY-MM-DD date')
  }
  const locality = request.locality?.trim()
  return { query, asOfDate, ...locality ? { locality } : {} }
}

/**
 * Build bounded official-domain discovery queries.
 * @param request - Normalized request.
 * @returns Search queries.
 */
export function planOfficialQueries(request: FinanceEvidenceRequest): string[] {
  const query = request.query.replace(/["\r\n]/gu, ' ')
  const queries = [
    `(site:fgk.chinatax.gov.cn OR site:mof.gov.cn) ${query}`,
    `(site:flk.npc.gov.cn OR site:www.gov.cn) ${query}`,
  ]
  if (request.locality !== undefined) queries.push(`site:chinatax.gov.cn ${request.locality} ${query}`)
  return queries
}

/**
 * Admit and classify one search result.
 * @param candidate - Provider search result.
 * @param locality - Requested locality.
 * @returns Classified result or undefined.
 */
export function classifyCandidate(
  candidate: WebSearchSource,
  locality: string | undefined,
): { candidate: WebSearchSource; source: OfficialSourceDefinition } | undefined {
  const source = sourceForUrl(candidate.url)
  if (source === undefined || (source.scope === 'local' && locality === undefined)) return undefined
  return { candidate, source }
}
