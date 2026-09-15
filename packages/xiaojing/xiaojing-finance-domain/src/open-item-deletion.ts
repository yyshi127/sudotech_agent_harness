/** Direction-bound read-only deletion evidence; public lists do not establish every deletion constraint. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { openItemQuerySchema, type OpenItemQuery, type OpenItemResult, type OpenItemRow } from './open-items.ts'
import { verifyOpenItemDeletionBalances, type DeletionBalanceVerification } from './open-item-deletion-balances.ts'

/** The raw and projected values must come from the same authenticated response. */
export interface OpenItemDeletionPage { result: OpenItemResult; raw: unknown }
/** Explicit original query scope, excluding pagination and free-text filters. */
export type OpenItemDeletionSelection = Pick<OpenItemQuery, 'direction' | 'periodStart' | 'periodEnd'>
/** Observed target restrictions are not a permission to delete. */
export interface OpenItemDeletionInspection {
  accountId: string
  accountName: string
  direction: OpenItemQuery['direction']
  businessAccountId: Branded<'FinanceReferenceId'>
  row: OpenItemRow
  fingerprint: string
  attachmentCount: number
  blockers: string[]
  unverified: string[]
}
/** Counted two-pass evidence is limited to the original direction and periods. */
export interface OpenItemDeletionInventory {
  accountId: string
  accountName: string
  selection: OpenItemDeletionSelection
  totalCount: number
  rows: OpenItemRow[]
  fingerprints: Record<string, string>
  contentFingerprints: Record<string, string>
  target?: OpenItemDeletionInspection
  scope: 'selected-direction-periods'
}

/** A single delete response is not independent proof of absence or unchanged related records. */
export type OpenItemDeletionOutcome = { state: 'accepted' } | { state: 'rejected'; code: number }
  | { state: 'outcome-unknown' } | { state: 'not-sent'; reason: 'preflight-failed' | 'cancelled' }

/**
 * Classify a bounded response without exposing vendor prose or interpreting data as a record ID.
 * @param value - Untrusted delete response.
 * @param httpOk - Whether the HTTP status is successful.
 * @returns Transport observation only; unknown responses never permit automatic resubmission.
 */
export function classifyOpenItemDeletion(value: unknown, httpOk: boolean): OpenItemDeletionOutcome {
  const parsed = z.object({ result: z.number().int() }).safeParse(value)
  if (!httpOk || !parsed.success) return { state: 'outcome-unknown' }
  if (parsed.data.result >= 100 && parsed.data.result < 200) return { state: 'accepted' }
  if (parsed.data.result >= 200 && parsed.data.result < 300) return { state: 'rejected', code: parsed.data.result }
  return { state: 'outcome-unknown' }
}

const identifier = z.union([z.string().regex(/^[1-9]\d*$/), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]).transform(String)
const rawPage = z.object({ list: z.array(z.looseObject({
  id: z.union([z.string().regex(/^-?[1-9]\d*$/), z.number().int().refine(Number.isSafeInteger)]).transform(String),
})) })
const targetState = z.object({
  id: identifier, setOfBooksId: identifier, subjectId: identifier,
  accountStatus: z.number().int(), initialBalance: z.boolean(), isFinish: z.boolean(),
  attachList: z.array(z.unknown()), certificateWordAndCode: z.string(), orderCode: z.string(),
  certificateId: z.union([z.string(), z.number().int().refine(Number.isSafeInteger)]).nullish(),
  tempCertificateId: z.union([z.string(), z.number().int().refine(Number.isSafeInteger)]).nullish(),
  otherMoney: z.unknown().optional(),
})
const fingerprint = (row: unknown) => createHash('sha256').update(JSON.stringify(row)).digest('hex')
const contentFingerprint = (row: Record<string, unknown>) => {
  const { balance: _balance, baseBalance: _baseBalance, thisMoney: _thisMoney, badMoney: _badMoney,
    hedgeMoney: _hedgeMoney, returnMoney: _returnMoney, ...content } = row
  return fingerprint(content)
}

/**
 * Inspect the exact target without treating omitted amounts, audit or source fields as zero or safe.
 * @param page - Same-response raw and validated projected records.
 * @param openItemId - Exact receivable/payable ID, not its account or counterparty ID.
 * @param maxBytes - Complete returned inspection cap.
 * @returns Observed blockers and explicitly unverified constraints; never grants deletion authority.
 */
export function inspectOpenItemDeletion(page: OpenItemDeletionPage, openItemId: string, maxBytes: number): OpenItemDeletionInspection {
  const rows = page.result.rows.filter(row => row.id === openItemId)
  const records = rawPage.parse(page.raw).list.filter(row => row.id === openItemId)
  const row = rows[0]
  if (row === undefined || rows.length !== 1 || records.length !== 1) throw new Error('应收应付删除目标在本页缺失或不唯一。')
  const parsed = targetState.safeParse(records[0])
  if (!parsed.success) throw new Error('应收应付删除检查缺少状态或关联字段，不能按无关联处理。')
  const detail = parsed.data
  if (detail.setOfBooksId !== page.result.accountId) throw new Error('应收应付删除目标账套不符。')
  const blockers: string[] = []
  if (detail.accountStatus !== 0) blockers.push('往来账户状态尚未核实可操作。')
  if (detail.initialBalance || row.initialBalance !== false) blockers.push('期初往来删除影响未核实。')
  if (detail.isFinish || row.finished !== false) blockers.push('往来已结清或结清状态未提供。')
  if (detail.attachList.length > 0) blockers.push('往来附件删除影响未核实。')
  if (detail.certificateWordAndCode !== '' || detail.orderCode !== ''
    || [detail.certificateId, detail.tempCertificateId].some(value => value != null && value !== '' && value !== 0 && value !== '0')) {
    blockers.push('往来已关联凭证或订单，不自动联动删除。')
  }
  if (row.amount === null || BigInt(row.amount.replace('.', '')) <= 0n || row.balance !== row.amount) {
    blockers.push('往来金额或未结余额不符合未核销正数记录。')
  }
  if ([row.settledAmount, row.badDebtAmount, row.offsetAmount, row.returnAmount].some(value => value !== '0.00')) {
    blockers.push('往来存在收付、坏账、对冲、退回金额，或相关金额未提供。')
  }
  const unverified = ['查询方向由原请求限定；列表未独立提供方向字段。',
    '审核状态和记录来源字段未提供，不能据此认定无审批或外部来源限制。',
    '有成网页提示删除可能连带删除对冲、核销或收入记录；公开接口的完整关联影响未核实，本检查不能排除该影响。']
  if (detail.otherMoney == null || detail.otherMoney === '') unverified.push('其他核销金额未提供，不按零处理。')
  else if (![0, '0', '0.0', '0.00'].some(value => value === detail.otherMoney)) blockers.push('往来其他核销金额非零或格式未核实。')
  const inspection: OpenItemDeletionInspection = { accountId: page.result.accountId, accountName: page.result.accountName,
    direction: page.result.selection.direction, businessAccountId: detail.subjectId as Branded<'FinanceReferenceId'>, row,
    fingerprint: fingerprint(records[0]), attachmentCount: detail.attachList.length, blockers, unverified }
  if (Buffer.byteLength(JSON.stringify(inspection)) > maxBytes) throw new Error('应收应付删除检查结果超过大小限制。')
  return inspection
}

/**
 * Read two complete counted inventories, requiring an empty terminal page and stable per-record evidence.
 * @param selection - Original direction and inclusive accounting-period range.
 * @param openItemId - Exact target to inspect if present.
 * @param read - Authenticated, bounded, serial page reader; no write callback.
 * @param signal - Whole-operation cancellation.
 * @param limits - Per-pass page, business-row and accumulated-byte caps, plus fixed page size.
 * @returns Consistent scoped evidence; rejects changing counts, duplicate IDs, incomplete pages and failed queries.
 */
export async function collectOpenItemDeletionInventory(selection: OpenItemDeletionSelection, openItemId: string,
  read: (query: OpenItemQuery) => Promise<OpenItemDeletionPage>, signal: AbortSignal,
  limits: { maxPages: number; maxRows: number; maxBytes: number; pageSize: number }): Promise<OpenItemDeletionInventory> {
  const selected = openItemQuerySchema.parse({ ...selection, page: 1, pageSize: limits.pageSize })
  identifier.parse(openItemId)
  let previous: OpenItemDeletionInventory | undefined
  for (let pass = 0; pass < 2; pass++) {
    const rows: OpenItemRow[] = []
    const fingerprints: Record<string, string> = {}
    const contentFingerprints: Record<string, string> = {}
    let identity: { accountId: string; accountName: string } | undefined
    let count: number | undefined
    let target: OpenItemDeletionInspection | undefined
    let bytes = 0
    let ended = false
    for (let page = 1; page <= limits.maxPages; page++) {
      signal.throwIfAborted()
      const response = await read({ ...selected, page })
      signal.throwIfAborted()
      bytes += Buffer.byteLength(JSON.stringify(response))
      if (bytes > limits.maxBytes) throw new Error('应收应付删除核验累计数据超过大小限制。')
      const result = response.result
      identity ??= { accountId: result.accountId, accountName: result.accountName }
      if (result.accountId !== identity.accountId || result.accountName !== identity.accountName
        || result.selection.direction !== selected.direction || result.selection.periodStart !== selected.periodStart
        || result.selection.periodEnd !== selected.periodEnd || result.selection.page !== page
        || result.selection.pageSize !== selected.pageSize) throw new Error('应收应付删除核验账套、方向或查询条件变化。')
      if (count !== undefined && count !== result.totalCount) throw new Error('应收应付删除核验分页总数变化。')
      count = result.totalCount
      const raw = rawPage.parse(response.raw).list
      for (const row of result.rows) {
        const matches = raw.filter(value => value.id === row.id)
        const rawRecord = matches[0]
        if (Object.hasOwn(fingerprints, row.id) || matches.length !== 1 || rawRecord === undefined) {
          throw new Error('应收应付删除核验分页重复或缺失业务行。')
        }
        if (row.date.slice(0, 7) < selected.periodStart || row.date.slice(0, 7) > selected.periodEnd) {
          throw new Error('应收应付删除核验返回所选期间外的记录。')
        }
        fingerprints[row.id] = fingerprint(rawRecord)
        contentFingerprints[row.id] = contentFingerprint(rawRecord)
        rows.push(row)
      }
      if (count > limits.maxRows || rows.length > limits.maxRows || rows.length > count) throw new Error('应收应付删除核验数量超限或不符。')
      if (result.rows.some(row => row.id === openItemId)) target = inspectOpenItemDeletion(response, openItemId, limits.maxBytes)
      if (result.rows.length === 0) { ended = true; break }
    }
    if (!ended || identity === undefined || count !== rows.length) throw new Error('应收应付删除核验没有完整读取原查询范围。')
    const inventory: OpenItemDeletionInventory = { ...identity, selection, totalCount: count, rows, fingerprints, contentFingerprints,
      ...(target === undefined ? {} : { target }), scope: 'selected-direction-periods' }
    if (Buffer.byteLength(JSON.stringify(inventory)) > limits.maxBytes) throw new Error('应收应付删除核验结果超过大小限制。')
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(inventory)) throw new Error('应收应付删除核验两次清单或状态变化。')
    previous = inventory
  }
  if (previous === undefined) throw new Error('应收应付删除核验未取得清单。')
  return previous
}

/**
 * Compare independent original-scope inventories without treating empty pages as global deletion proof.
 * @param before - Original counted evidence containing the exact target.
 * @param after - Independently collected evidence for the same ledger, direction and periods.
 * @returns Scoped target/content checks and per-currency original/base balance evidence; never ledger totals or bank payments.
 */
export function compareOpenItemDeletion(before: OpenItemDeletionInventory, after: OpenItemDeletionInventory): {
  target: 'present' | 'not-observed' | 'unavailable'
  content: 'matched' | 'mismatch' | 'unavailable'
  remainingBalances: 'matched' | 'mismatch' | 'unavailable'
  balances?: { original: DeletionBalanceVerification; base: DeletionBalanceVerification }
  scope: 'selected-direction-periods'
} {
  const unavailable = { target: 'unavailable', content: 'unavailable', remainingBalances: 'unavailable',
    scope: 'selected-direction-periods' } as const
  const target = before.target
  if (target === undefined || before.accountId !== after.accountId || before.accountName !== after.accountName
    || before.selection.direction !== after.selection.direction || before.selection.periodStart !== after.selection.periodStart
    || before.selection.periodEnd !== after.selection.periodEnd) return unavailable
  if (after.rows.some(row => row.id === target.row.id)) return { ...unavailable, target: 'present' }
  const remaining = before.rows.filter(row => row.id !== target.row.id)
  if (before.totalCount - 1 !== after.totalCount || remaining.length !== after.rows.length
    || remaining.some((row, index) => row.id !== after.rows[index]?.id)) {
    return { ...unavailable, target: 'not-observed', content: 'mismatch' }
  }
  const content = ({ balance: _balance, baseBalance: _baseBalance, settledAmount: _settledAmount,
    badDebtAmount: _badDebtAmount, offsetAmount: _offsetAmount, returnAmount: _returnAmount, ...row }: OpenItemRow) => row
  const rawChanged = remaining.some(row => before.contentFingerprints[row.id] !== after.contentFingerprints[row.id])
  const original = verifyOpenItemDeletionBalances(before.rows, after.rows, target.row, false)
  const base = verifyOpenItemDeletionBalances(before.rows, after.rows, target.row, true)
  const states = [original.state, base.state]
  return { target: 'not-observed', scope: 'selected-direction-periods',
    content: !rawChanged && JSON.stringify(remaining.map(content)) === JSON.stringify(after.rows.map(content)) ? 'matched' : 'mismatch',
    remainingBalances: states.includes('mismatch') ? 'mismatch' : states.includes('unavailable') ? 'unavailable' : 'matched',
    balances: { original, base } }
}
