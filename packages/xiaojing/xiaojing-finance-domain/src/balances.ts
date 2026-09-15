/** Read-only balance report projection; blank vendor amounts remain unknown, never fabricated zeros. */
import { z } from 'zod'
import type { BalanceQueryReconciliation } from './balance-analysis.ts'

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
/** Periods and an optional exact subject level; ledger identity comes from the saved client binding. */
export const balanceQuerySchema = z.strictObject({
  month: period, monthEnd: period.optional(), subjectLevel: z.number().int().positive().max(2147483647).optional(),
  subjectLevelEnd: z.number().int().positive().max(2147483647).optional(),
})
  .refine(value => value.monthEnd === undefined || value.monthEnd >= value.month, '结束期间不能早于开始期间。')
  .refine(value => value.subjectLevelEnd === undefined || (value.subjectLevel !== undefined && value.subjectLevelEnd >= value.subjectLevel), '层级范围必须提供起始层级，且结束层级不能更小。')
/** Inclusive accounting periods, not voucher creation dates. */
export type BalanceQuery = z.infer<typeof balanceQuerySchema>

const amount = z.string().transform((value, context): string | null => {
  if (value === '') return null
  if (!/^-?(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)(\.\d{1,2})?$/.test(value)) {
    context.addIssue({ code: 'custom', message: 'Invalid balance amount' })
    return z.NEVER
  }
  const [whole, fraction = ''] = value.replaceAll(',', '').split('.')
  return `${whole}.${fraction.padEnd(2, '0')}`
})
const rowSchema = z.object({
  subjectCode: z.string(), subjectName: z.string().min(1),
  subjectLevel: z.number().int().positive(), hasChild: z.boolean(),
  subjectInfoId: z.number().int().positive().optional(),
  parentSubjectId: z.number().int().nonnegative().optional(),
  periodInitialBorrow: amount, periodInitialLoan: amount, periodInitialBalance: amount,
  periodThisBorrow: amount, periodThisLoan: amount, periodThisBalance: amount,
  periodYearBorrow: amount, periodYearLoan: amount, periodYearBalance: amount,
  periodFinalBorrow: amount, periodFinalLoan: amount, periodFinalBalance: amount,
})
const summarySchema = rowSchema.omit({ subjectInfoId: true, parentSubjectId: true }).extend({ subjectCode: z.literal('') })
const responseSchema = z.object({ success: z.literal(true), count: z.number().int().nonnegative(),
  list: z.array(z.union([summarySchema, rowSchema])),
})
/** Vendor-provided amounts; negative debit or credit values retain their original side. */
export type BalanceRow = z.infer<typeof rowSchema>
/** Subject rows and vendor summaries are separate and must not be summed together. */
export interface BalanceResult {
  accountId: string
  accountName: string
  month: string
  monthEnd: string
  subjectLevel?: number
  subjectLevelEnd?: number
  rows: BalanceRow[]
  summaries: BalanceRow[]
  coverage: 'unverified'
  reconciliation?: BalanceQueryReconciliation
  notice: string
}

/**
 * Validate and separate a vendor report without inferring totals or missing amounts.
 * @param data - Untrusted response data.
 * @param query - Validated period selection.
 * @param account - Independently authorized ledger identity.
 * @param maxRows - Cap including vendor summary rows.
 * @param maxBytes - Complete emitted result size cap.
 * @returns Bounded report with explicit coverage and blank-amount limitations.
 */
export function projectBalances(
  data: unknown, query: BalanceQuery, account: { id: string; name: string }, maxRows: number, maxBytes: number,
): BalanceResult {
  const selected = balanceQuerySchema.parse(query)
  const report = responseSchema.parse(data)
  if (report.list.length > maxRows) throw new Error('科目余额表超过行数限制，未返回不完整结果。')
  const rows: BalanceRow[] = report.list.filter(row => row.subjectCode !== '')
  const summaries = report.list.filter(row => row.subjectCode === '')
  const startLevel = selected.subjectLevel
  const endLevel = selected.subjectLevelEnd ?? startLevel
  if (startLevel !== undefined && endLevel !== undefined
    && rows.some(row => row.subjectLevel < startLevel || row.subjectLevel > endLevel)) {
    throw new Error('科目余额表返回层级与查询不一致。')
  }
  if (new Set(rows.map(row => row.subjectCode)).size !== rows.length) throw new Error('科目余额表包含重复科目，无法确认查询口径。')
  if (selected.subjectLevelEnd !== undefined && startLevel !== undefined) {
    const byId = new Map(rows.map(row => [row.subjectInfoId, row]))
    if (byId.size !== rows.length || rows.some(row => row.subjectInfoId === undefined || row.parentSubjectId === undefined)) {
      throw new Error('科目余额范围缺少唯一科目标识，无法核验层级。')
    }
    const parents = new Set(rows.map(row => row.parentSubjectId))
    for (const row of rows) {
      const parent = byId.get(row.parentSubjectId)
      if (parent !== undefined) {
        if (!parent.hasChild || parent.subjectLevel + 1 !== row.subjectLevel) throw new Error('科目余额范围的父子层级不一致。')
      } else if (row.subjectLevel !== startLevel || (startLevel === 1 && row.parentSubjectId !== 0)) {
        throw new Error('科目余额范围缺少父级，不能作为完整层级使用。')
      }
      if (row.hasChild && row.subjectLevel < selected.subjectLevelEnd && !parents.has(row.subjectInfoId)) {
        throw new Error('科目余额范围缺少声明的子级，不能作为完整层级使用。')
      }
    }
  }
  const result: BalanceResult = {
    accountId: account.id, accountName: account.name, month: selected.month, monthEnd: selected.monthEnd ?? selected.month,
    ...selected.subjectLevel === undefined ? {} : { subjectLevel: selected.subjectLevel },
    ...selected.subjectLevelEnd === undefined ? {} : { subjectLevelEnd: selected.subjectLevelEnd },
    rows, summaries, coverage: 'unverified',
    notice: '金额保留接口借贷列及正负号，借贷不统一解释为进出或增减；Balance 只称接口余额。null 在科目行和汇总行均写“未提供”，不能写零或“无（空）”。发生额留空只能说明未提供，不能称“本期无发生”；期初期末相等也不能证明期间没有发生。不从金额相同推断划转，不自行展开算式。科目行可能含父子层级，小计和合计单独列出，禁止将这些行重复加总。接口 count 不能证明数据完整；没有科目行不代表账套无余额或无异常。未执行任何写操作。',
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) throw new Error('科目余额表结果过大，无法完整返回。')
  return result
}
