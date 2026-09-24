/** Validated, read-only reference projections; no missing value implies an enabled or selectable record. */
import { z } from 'zod'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { FinanceYouchengAccount } from './types.ts'

const text = z.string().max(500)
const identity = z.union([text.min(1), z.number().int()]).transform(String)
const flag = z.union([z.literal('0'), z.literal('1'), z.literal(0), z.literal(1), z.boolean()])
  .transform(value => value === true || value === 1 || value === '1' ? '1' : '0')
const optionalFlag = flag.nullish()
const auxiliary = z.object({ id: identity, categoryCode: text.min(1), categoryName: text.min(1) })
const subjects = z.object({ subjectCode: text.min(1), subjectName: text.min(1), parentSubjectCode: text.nullish(),
  subjectType: text.nullish(), hasChild: z.boolean().nullish(), enableStatus: optionalFlag, balanceDirection: optionalFlag,
  auxiliaryList: z.array(auxiliary).nullish(), currencyList: z.array(z.object({ currencyCode: text, currencyName: text })).nullish(),
})
const items = z.object({ id: identity, itemCode: text.min(1), itemName: text.min(1), categoryId: identity.nullish() })
const accounts = z.object({ accountId: identity, accountName: text.min(1), status: optionalFlag, direction: optionalFlag,
  subjectCode: text.nullish(), currencyId: identity.nullish(), type: z.number().int().nullish(),
})
const categories = z.object({ id: identity, code: text.min(1), name: text.min(1), type: optionalFlag,
  journalSubjectCode: text.nullish(), cashierSubjectCode: text.nullish(),
})

/** Model inputs have no URL, credential, or ledger override; names and codes are exact local filters. */
export const referenceQuerySchema = z.object({
  kind: z.enum(['subjects', 'auxiliary-categories', 'auxiliary-items', 'cash-accounts', 'cash-categories']),
  categoryCode: text.min(1).optional(), code: text.min(1).optional(), name: text.min(1).optional(),
  subjectTreeRootCode: text.min(1).optional(),
}).strict().superRefine((query, context) => {
  if ((query.kind === 'auxiliary-items') !== (query.categoryCode !== undefined)) {
    context.addIssue({ code: 'custom', message: '仅辅助项目查询必须指定辅助类别编码。' })
  }
  if (query.subjectTreeRootCode !== undefined && query.kind !== 'subjects') {
    context.addIssue({ code: 'custom', message: '只有科目查询可以指定树根编码。' })
  }
  if (query.subjectTreeRootCode !== undefined && (query.code !== undefined || query.name !== undefined)) {
    context.addIssue({ code: 'custom', message: '科目树查询不能同时使用名称或编码筛选。' })
  }
})

/** Validated reference query. */
export type ReferenceQuery = z.infer<typeof referenceQuerySchema>
/** Explicit fields retained from one reference record, not a vendor payload passthrough. */
export interface ReferenceRow {
  id: Branded<'FinanceReferenceId'>
  code: string
  name: string
  status: 'enabled' | 'disabled' | 'unknown'
  parentCode?: string
  /** Vendor type name, not the total category inferred from a subject code. Empty or absent means unavailable. */
  subjectType?: string
  hasChildren?: boolean
  directionRaw?: string
  auxiliaryCodes?: string[]
  currencyCodes?: string[]
  currencyId?: string
  subjectCode?: string
  cashierSubjectCode?: string
  accountType?: number
}
/** A bounded returned set, never a claim that the vendor supplied all ledger records. */
export interface ReferenceResult {
  accountId: string
  accountName: string
  kind: ReferenceQuery['kind']
  categoryCode?: string
  subjectTreeRootCode?: string
  requestedLimit: number
  returnedCount: number
  coverage: 'unverified'
  selection: 'not-requested' | 'unique-returned' | 'ambiguous' | 'not-found-in-returned' | 'tree-returned'
  rows: ReferenceRow[]
  notice: string
}

/**
 * Validate every returned row before exact local filtering; reject duplicate identities and oversized results.
 * @param data - Untrusted vendor array.
 * @param query - Validated query.
 * @param account - Verified ledger.
 * @param limit - Deployment row cap, also sent as pageSize.
 * @param maxBytes - Complete returned-result byte cap.
 * @param categoryId - Verified auxiliary category identity for item membership checks.
 * @returns Safe reference rows with explicit completeness limitations.
 */
export function projectReferences(data: unknown, query: ReferenceQuery, account: FinanceYouchengAccount,
  limit: number, maxBytes: number, categoryId?: string): ReferenceResult {
  const raw = z.array(z.unknown()).max(limit).parse(data)
  const rows = raw.map((value): Omit<ReferenceRow, 'id'> & { id: string } => {
    switch (query.kind) {
      case 'subjects': {
        const row = subjects.parse(value)
        return { id: row.subjectCode, code: row.subjectCode, name: row.subjectName,
          status: row.enableStatus == null ? 'unknown' : row.enableStatus === '1' ? 'enabled' : 'disabled',
          ...row.parentSubjectCode == null ? {} : { parentCode: row.parentSubjectCode },
          ...row.subjectType == null ? {} : { subjectType: row.subjectType },
          ...row.hasChild == null ? {} : { hasChildren: row.hasChild },
          ...row.balanceDirection == null ? {} : { directionRaw: row.balanceDirection },
          ...row.auxiliaryList == null ? {} : { auxiliaryCodes: row.auxiliaryList.map(item => item.categoryCode) },
          ...row.currencyList == null ? {} : { currencyCodes: row.currencyList.map(item => item.currencyCode) },
        }
      }
      case 'auxiliary-categories': {
        const row = auxiliary.parse(value)
        return { id: row.id, code: row.categoryCode, name: row.categoryName, status: 'unknown' }
      }
      case 'auxiliary-items': {
        const row = items.parse(value)
        if (row.categoryId != null && row.categoryId !== categoryId) throw new Error('辅助项目类别不匹配。')
        return { id: row.id, code: row.itemCode, name: row.itemName, status: 'unknown' }
      }
      case 'cash-accounts': {
        const row = accounts.parse(value)
        return { id: row.accountId, code: row.subjectCode ?? '', name: row.accountName,
          status: row.status == null ? 'unknown' : row.status === '0' ? 'enabled' : 'disabled',
          ...row.direction == null ? {} : { directionRaw: row.direction },
          ...row.currencyId == null ? {} : { currencyId: row.currencyId },
          ...row.type == null ? {} : { accountType: row.type },
        }
      }
      case 'cash-categories': {
        const row = categories.parse(value)
        return { id: row.id, code: row.code, name: row.name, status: 'unknown',
          ...row.type == null ? {} : { directionRaw: row.type },
          ...row.journalSubjectCode == null ? {} : { subjectCode: row.journalSubjectCode },
          ...row.cashierSubjectCode == null ? {} : { cashierSubjectCode: row.cashierSubjectCode },
        }
      }
      default: return assertNever(query.kind, 'Finance reference kind')
    }
  }).map(row => ({ ...row, id: row.id as Branded<'FinanceReferenceId'> }))
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('基础资料返回重复标识，请核查。')
  let treeRows: ReferenceRow[] | undefined
  if (query.subjectTreeRootCode !== undefined) {
    const included = new Set<string>()
    if (rows.some(row => row.code === query.subjectTreeRootCode)) included.add(query.subjectTreeRootCode)
    let changed = true
    while (changed) {
      changed = false
      for (const row of rows) {
        if (row.parentCode !== undefined && included.has(row.parentCode) && !included.has(row.code)) {
          included.add(row.code)
          changed = true
        }
      }
    }
    treeRows = rows.filter(row => included.has(row.code))
  }
  const candidates = treeRows ?? rows
  const matched = candidates.filter(row => (query.code === undefined || row.code === query.code)
    && (query.name === undefined || row.name === query.name))
  const filtered = query.code !== undefined || query.name !== undefined
  const directionNotice = query.kind === 'subjects'
    ? '本次科目 directionRaw：0借1贷；未返回方向时不能根据名称或会计惯例推断。subjectType 是返回的科目类型名称；缺失或空白时不推断类型。'
    : query.kind === 'cash-accounts' ? '本次出纳账户 directionRaw：0借1贷。'
      : query.kind === 'cash-categories' ? '本次收支类别 directionRaw：0收1支。' : ''
  const result: ReferenceResult = {
    accountId: account.id, accountName: account.name, kind: query.kind,
    ...query.categoryCode === undefined ? {} : { categoryCode: query.categoryCode },
    ...query.subjectTreeRootCode === undefined ? {} : { subjectTreeRootCode: query.subjectTreeRootCode },
    requestedLimit: limit, returnedCount: rows.length, coverage: 'unverified',
    selection: query.subjectTreeRootCode !== undefined
      ? matched.length === 0 ? 'not-found-in-returned' : 'tree-returned'
      : !filtered ? 'not-requested' : matched.length === 0 ? 'not-found-in-returned' : matched.length === 1 ? 'unique-returned' : 'ambiguous',
    rows: matched,
    notice: `接口未提供总数或翻页游标，完整性未验证；筛选仅针对本次返回。${query.subjectTreeRootCode === undefined ? '' : '科目树结果由本次返回的父子关系确定，包含树根及其全部已返回后代，不按名称抽样。'}同名不猜选，未找到不自动新增；unknown 不代表启用。${directionNotice}`,
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) throw new Error('基础资料结果超出大小限制。')
  return result
}
