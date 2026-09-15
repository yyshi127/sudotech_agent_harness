/** Read-only journal deletion evidence. Counted monthly inventories do not establish global absence or grant deletion. */
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { resolveJournalQuery, type JournalQuery, type JournalResult, type JournalRow, type JournalSummary } from './journals.ts'

/** Authenticated page with the vendor count retained outside the ordinary F1 projection. */
export interface JournalDeletionPage { result: JournalResult; raw: unknown; totalCount: unknown }
/** Transport observation only; an accepted delete still needs independent target and balance readback. */
export type JournalDeletionOutcome = { state: 'accepted' } | { state: 'rejected'; code: number }
  | { state: 'outcome-unknown' } | { state: 'not-sent'; reason: 'preflight-failed' | 'cancelled' }

/**
 * Classify one bounded journal deletion response without forwarding vendor text or asserting success of readback.
 * @param value - Untrusted response body.
 * @param httpOk - Successful HTTP status.
 * @returns Accepted, explicitly rejected or uncertain; uncertainty never permits an automatic retry.
 */
export function classifyJournalDeletion(value: unknown, httpOk: boolean): JournalDeletionOutcome {
  const parsed = z.object({ result: z.number().int() }).safeParse(value)
  if (!httpOk || !parsed.success) return { state: 'outcome-unknown' }
  if (parsed.data.result >= 100 && parsed.data.result < 200) return { state: 'accepted' }
  if (parsed.data.result >= 200 && parsed.data.result < 300) return { state: 'rejected', code: parsed.data.result }
  return { state: 'outcome-unknown' }
}

/** Exact target and observed restrictions, without private attachment contents. */
export interface JournalDeletionInspection {
  accountId: string
  accountName: string
  cashAccountId: string
  row: JournalRow
  fingerprint: string
  reviewStatus: number
  channel: string
  attachmentCount: number
  blockers: string[]
}
/** Two consistent counted inventories for one month; not a vendor transaction or a whole-ledger result. */
export interface JournalDeletionInventory {
  accountId: string
  accountName: string
  selection: { month: string; cashAccountId?: string }
  totalCount: number
  rows: JournalRow[]
  fingerprints: Record<string, string>
  summaries: JournalSummary[]
  target?: JournalDeletionInspection
  scope: 'selected-month'
  notice: string
}

const identifier = z.union([z.string().regex(/^[1-9]\d*$/), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]).transform(String)
const rawRow = z.looseObject({ id: identifier.optional() })
const centsValue = z.union([z.string(), z.number()]).transform(String).pipe(z.string().regex(/^\d+(\.\d{1,2})?$/))
  .transform((value) => {
    const [whole, fraction = ''] = value.split('.')
    return BigInt(`${whole}${fraction.padEnd(2, '0')}`)
  }).refine(value => value <= BigInt(Number.MAX_SAFE_INTEGER))
const state = z.object({
  id: identifier, subjectId: identifier, reviewStatus: z.number().int(), reviewUser: z.string(), reviewUserId: z.string(),
  accountStatus: z.number().int(), channel: z.string(), certificateWordAndCode: z.string(), cashManagementId: z.string(),
  auxiliaryItemIds: z.string(), orderCode: z.string(), relationOrderCodeList: z.array(z.unknown()),
  attachList: z.array(z.unknown()), attachIdList: z.array(z.unknown()), canWriteOffAmount: centsValue,
  certificateId: z.union([z.string(), z.number()]).nullish(), tempCertificateId: z.union([z.string(), z.number()]).nullish(),
})

/**
 * Inspect one exact dated journal from the same authenticated raw/projected page.
 * @param page - Validated original page, including its bounded raw response.
 * @param journalId - Explicit vendor ID, never a summary or row position.
 * @param maxBytes - Complete inspection cap.
 * @returns Current target and conservative local restrictions; missing metadata rejects and no write is authorized.
 */
export function inspectJournalDeletion(page: JournalDeletionPage, journalId: string, maxBytes: number): JournalDeletionInspection {
  const matches = page.result.rows.filter(row => row.id === journalId)
  const records = z.array(rawRow).parse(page.raw).filter(row => row.id === journalId)
  const row = matches[0]
  if (matches.length !== 1 || records.length !== 1 || row === undefined) throw new Error('日记账删除目标不存在于本页或不唯一，不能按摘要替代。')
  const parsed = state.safeParse(records[0])
  if (!parsed.success) throw new Error('日记账删除状态或关联字段未完整返回，不能按未审核或无关联处理。')
  const detail = parsed.data
  if (page.result.selection.cashAccountId !== undefined && page.result.selection.cashAccountId !== detail.subjectId) {
    throw new Error('日记账删除目标资金账户与查询不一致。')
  }
  const blockers: string[] = []
  if (detail.reviewStatus !== 0 || detail.reviewUser !== '' || detail.reviewUserId !== '') blockers.push('日记账存在审核状态或审核人。')
  if (detail.accountStatus !== 0) blockers.push('日记账账户状态尚未核实可操作。')
  if (detail.channel !== 'ADD') blockers.push('该日记账来源的删除影响尚未核实。')
  if (detail.certificateWordAndCode !== '' || detail.cashManagementId !== '' || detail.orderCode !== ''
    || detail.relationOrderCodeList.length > 0 || (detail.certificateId != null && detail.certificateId !== '')
    || (detail.tempCertificateId != null && detail.tempCertificateId !== '')) blockers.push('日记账存在关联业务，不允许自动联动删除。')
  if (detail.auxiliaryItemIds !== '') blockers.push('日记账辅助核算关联的删除影响尚未核实。')
  if (detail.attachList.length > 0 || detail.attachIdList.length > 0) blockers.push('日记账附件删除影响尚未核实。')
  const income = row.income === null ? 0n : BigInt(row.income.replace('.', ''))
  const expense = row.expense === null ? 0n : BigInt(row.expense.replace('.', ''))
  if (!(income > 0n && expense === 0n || expense > 0n && income === 0n)
    || detail.canWriteOffAmount !== income + expense) blockers.push('日记账方向或可核销金额不匹配，需核实是否已有核销。')
  const inspection: JournalDeletionInspection = { accountId: page.result.accountId, accountName: page.result.accountName,
    cashAccountId: detail.subjectId, row, fingerprint: createHash('sha256').update(JSON.stringify(records[0])).digest('hex'),
    reviewStatus: detail.reviewStatus, channel: detail.channel, attachmentCount: detail.attachList.length, blockers }
  if (Buffer.byteLength(JSON.stringify(inspection)) > maxBytes) throw new Error('日记账删除检查结果超过大小限制。')
  return inspection
}

/**
 * Collect two consistent full-month page sets through an explicit empty page and match their vendor counts.
 * @param selection - One month and optional previously verified cash account; no date/summary filters.
 * @param journalId - Exact target to inspect when present; absence remains limited to this selected month.
 * @param read - Authenticated reader returning raw data and count from the same response.
 * @param signal - Whole-operation cancellation.
 * @param limits - Page, accumulated byte and business-row limits for each pass.
 * @returns Stable scoped evidence; throws for missing counts, changed data, duplicates, partial pages or excess. Never calls a write.
 */
export async function collectJournalDeletionInventory(selection: { month: string; cashAccountId?: string }, journalId: string,
  read: (query: JournalQuery) => Promise<JournalDeletionPage>, signal: AbortSignal,
  limits: { maxPages: number; maxRows: number; maxBytes: number; pageSize: number }): Promise<JournalDeletionInventory> {
  const resolved = resolveJournalQuery({ ...selection, page: 1, pageSize: limits.pageSize })
  let previous: JournalDeletionInventory | undefined
  for (let pass = 0; pass < 2; pass++) {
    const rows: JournalRow[] = []
    const fingerprints: Record<string, string> = {}
    let count: number | undefined
    let identity: { accountId: string; accountName: string } | undefined
    const summaries: JournalSummary[] = []
    let target: JournalDeletionInspection | undefined
    let empty = false
    let bytes = 0
    for (let page = 1; page <= limits.maxPages; page++) {
      signal.throwIfAborted()
      const response = await read({ ...resolved, page })
      const { result } = response
      bytes += Buffer.byteLength(JSON.stringify(response))
      if (bytes > limits.maxBytes) throw new Error('日记账删除核验累计数据超过大小限制。')
      const providedCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).safeParse(response.totalCount)
      if (!providedCount.success) throw new Error('日记账删除核验未返回有效业务总数，不能将空页当作不存在。')
      if (count !== undefined && count !== providedCount.data) throw new Error('日记账删除核验分页总数变化。')
      count = providedCount.data
      identity ??= { accountId: result.accountId, accountName: result.accountName }
      if (result.accountId !== identity.accountId || result.accountName !== identity.accountName
        || Object.entries(resolved).some(([key, value]) => result.selection[key as keyof JournalQuery] !== (key === 'page' ? page : value))
        || result.selection.cashAccountId !== resolved.cashAccountId) throw new Error('日记账删除核验账套或查询条件变化。')
      const raw = z.array(rawRow).parse(response.raw)
      for (const summary of result.summaries) {
        const prior = summaries.find(value => value.kind === summary.kind)
        if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(summary)) throw new Error('日记账删除核验分页汇总变化。')
        if (prior === undefined) summaries.push(summary)
      }
      for (const row of result.rows) {
        const matches = raw.filter(value => value.id === row.id)
        if (Object.hasOwn(fingerprints, row.id) || matches.length !== 1) throw new Error('日记账删除核验分页出现重复或缺失业务行。')
        fingerprints[row.id] = createHash('sha256').update(JSON.stringify(matches[0])).digest('hex')
        rows.push(row)
      }
      if (count > limits.maxRows || rows.length > limits.maxRows || rows.length > count) throw new Error('日记账删除核验数量超限或不一致。')
      if (result.rows.some(row => row.id === journalId)) target = inspectJournalDeletion(response, journalId, limits.maxBytes)
      if (result.rows.length === 0) { empty = true; break }
    }
    if (!empty || count === undefined || count !== rows.length || identity === undefined) throw new Error('日记账删除核验未完整读取所选月份。')
    const inventory: JournalDeletionInventory = { ...identity, selection, totalCount: count, rows, fingerprints, summaries,
      ...(target === undefined ? {} : { target }), scope: 'selected-month',
      notice: '两次查询在所选月份内按业务总数及空末页核对一致；未返回目标不等于全账套不存在，不提供供应商锁或删除授权。余额影响须另行对照。' }
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(inventory)) throw new Error('日记账删除核验两次清单或状态不一致。')
    previous = inventory
  }
  signal.throwIfAborted()
  if (previous === undefined || Buffer.byteLength(JSON.stringify(previous)) > limits.maxBytes) throw new Error('日记账删除核验结果超过大小限制。')
  return previous
}

/**
 * Compare scoped deletion evidence and the surviving rows' observed balance changes with exact-cent arithmetic.
 * @param before - Two-pass inventory containing the original target.
 * @param after - Independent two-pass inventory for the same selected cash account and month.
 * @returns Separate target/content/balance findings; monthly absence never becomes global deletion proof.
 */
export function compareJournalDeletion(before: JournalDeletionInventory, after: JournalDeletionInventory): {
  target: 'present' | 'not-observed' | 'unavailable'
  content: 'matched' | 'mismatch' | 'unavailable'
  balances: 'matched' | 'mismatch' | 'unavailable'
  scope: 'selected-month'
} {
  const unavailable = { target: 'unavailable', content: 'unavailable', balances: 'unavailable', scope: 'selected-month' } as const
  const original = before.target
  if (original === undefined || before.accountId !== after.accountId || before.accountName !== after.accountName
    || before.selection.month !== after.selection.month
    || before.selection.cashAccountId !== after.selection.cashAccountId) return unavailable
  if (after.rows.some(row => row.id === original.row.id)) return { ...unavailable, target: 'present' }
  const remaining = before.rows.filter(row => row.id !== original.row.id)
  const withoutBalance = ({ balance: _balance, baseBalance: _baseBalance, ...row }: JournalRow) => row
  const content = before.totalCount - 1 === after.totalCount
    && JSON.stringify(remaining.map(withoutBalance)) === JSON.stringify(after.rows.map(withoutBalance)) ? 'matched' : 'mismatch'
  const base = { ...unavailable, target: 'not-observed' as const, content }
  if (content !== 'matched') return { ...base, content: 'mismatch' }
  if (before.selection.cashAccountId === undefined || original.cashAccountId !== before.selection.cashAccountId) {
    return { ...base, content: 'matched' }
  }
  const money = (value: string | null) => value === null ? undefined : BigInt(value.replace('.', ''))
  const at = before.rows.findIndex(row => row.id === original.row.id)
  const oneSide = (row: JournalRow, income: 'income' | 'baseIncome', expense: 'expense' | 'baseExpense') => {
    const plus = money(row[income])
    const minus = money(row[expense])
    // The checked target has exactly one positive side; the absent opposite side is not an inferred business amount.
    if (plus !== undefined && plus > 0n && (minus === undefined || minus === 0n)) return plus
    if (minus !== undefined && minus > 0n && (plus === undefined || plus === 0n)) return -minus
    return undefined
  }
  for (const [balance, income, expense, currency] of [
    ['balance', 'income', 'expense', 'currencyCode'], ['baseBalance', 'baseIncome', 'baseExpense', 'baseCurrencyCode'],
  ] as const) {
    const delta = oneSide(original.row, income, expense)
    if (delta === undefined || original.row[currency] === '' || before.rows.some(row => row[currency] !== original.row[currency])) {
      return { ...base, content: 'matched' }
    }
    for (let index = 0; index < remaining.length; index++) {
      const oldRow = remaining[index]
      const currentRow = after.rows[index]
      assert(oldRow !== undefined && currentRow !== undefined)
      const old = money(oldRow[balance])
      const current = money(currentRow[balance])
      if (old === undefined || current === undefined) return { ...base, content: 'matched' }
      if (current !== old - (index >= at ? delta : 0n)) return { ...base, content: 'matched', balances: 'mismatch' }
    }
    for (const kind of ['opening', 'total'] as const) {
      const old = before.summaries.find(row => row.kind === kind)
      const current = after.summaries.find(row => row.kind === kind)
      if (old === undefined || current === undefined || old[balance] === null || current[balance] === null) {
        return { ...base, content: 'matched' }
      }
      const oldBalance = money(old[balance])
      assert(oldBalance !== undefined)
      if (money(current[balance]) !== oldBalance - (kind === 'total' ? delta : 0n)) {
        return { ...base, content: 'matched', balances: 'mismatch' }
      }
    }
  }
  return { ...base, content: 'matched', balances: 'matched' }
}
