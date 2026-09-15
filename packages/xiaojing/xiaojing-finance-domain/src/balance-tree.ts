/** Bounded child retrieval follows supplier-confirmed parent IDs without asserting root completeness. */
import { z } from 'zod'
import { projectBalances, type BalanceQuery, type BalanceResult } from './balances.ts'

const rawPage = z.object({ success: z.literal(true), count: z.number().int().nonnegative(),
  list: z.array(z.record(z.string(), z.unknown())) })

/**
 * Read each declared child branch through the selected end level; retain only initial summaries.
 * @param query - Explicit inclusive level range and periods.
 * @param account - Independently authorized ledger identity.
 * @param read - Credential-scoped request for one level and optional parent.
 * @param signal - Shared operation cancellation and deadline.
 * @param maxRows - Combined subject and initial-summary row limit.
 * @param maxBytes - Combined raw and projected result limit.
 * @returns Validated selected tree; missing or repeated children reject the entire operation.
 */
export async function readBalanceTree(
  query: BalanceQuery & { subjectLevel: number; subjectLevelEnd: number },
  account: { id: string; name: string },
  read: (level: number, parentSubjectId: number | undefined) => Promise<unknown>,
  signal: AbortSignal, maxRows: number, maxBytes: number,
): Promise<BalanceResult> {
  const pending: { level: number; parent: number | undefined }[] = [
    { level: query.subjectLevel, parent: query.subjectLevel === 1 ? 0 : undefined },
  ]
  const combined: Record<string, unknown>[] = []
  const ids = new Set<number>()
  const codes = new Set<string>()
  for (const [index, branch] of pending.entries()) {
    signal.throwIfAborted()
    const page = rawPage.parse(await read(branch.level, branch.parent))
    signal.throwIfAborted()
    const projected = projectBalances(page,
      { month: query.month, monthEnd: query.monthEnd, subjectLevel: branch.level }, account, maxRows, maxBytes)
    if (index > 0 && projected.rows.length === 0) throw new Error('声明存在子科目，但未返回子科目。')
    for (const row of projected.rows) {
      const id = row.subjectInfoId
      if (id === undefined || row.parentSubjectId === undefined || ids.has(id) || codes.has(row.subjectCode)
        || (branch.parent !== undefined && row.parentSubjectId !== branch.parent)) {
        throw new Error('子科目标识重复、缺失或父级不匹配。')
      }
      ids.add(id)
      codes.add(row.subjectCode)
      if (row.hasChild && branch.level < query.subjectLevelEnd) pending.push({ level: branch.level + 1, parent: id })
    }
    combined.push(...page.list.filter(row => row.subjectCode !== '' || index === 0))
    if (combined.length > maxRows || Buffer.byteLength(JSON.stringify(combined), 'utf8') > maxBytes) {
      throw new Error('科目余额遍历超过完整结果上限。')
    }
  }
  return projectBalances({ success: true, count: 0, list: combined }, query, account, maxRows, maxBytes)
}
