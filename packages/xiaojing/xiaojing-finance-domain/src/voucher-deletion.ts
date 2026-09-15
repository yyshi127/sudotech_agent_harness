/** Read-only deletion evidence; inspection is neither approval nor proof that vendor deletion is allowed. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { projectVoucherDetail, type VoucherDetail, type VoucherPage, type VoucherQuery } from './vouchers.ts'

/** Deletion consent and readback cannot establish erasure or permanent retention of attachment bytes. */
export const VOUCHER_DELETION_ATTACHMENT_NOTICE = '本操作不清理原OSS文件；凭证删除不证明有成转存附件已清除，也不保证附件长期保留。'

const deletionState = z.object({
  modified: z.string().min(1), channel: z.string().min(1), sysCreate: z.boolean(),
  relationCode: z.string(), adjustPeriodsStatus: z.number().int(),
  attachmentStatus: z.boolean(), attachmentList: z.array(z.unknown()),
  corpBalanceSheetCertificateList: z.array(z.unknown()), subjectCertificateWrites: z.array(z.unknown()),
  certificateLists: z.array(z.object({ auxiliaryList: z.array(z.unknown()), currencyCode: z.string() })).min(1),
})

/** Identity-checked accounting and observed risk indicators; no private attachment URLs or send authority. */
export interface VoucherDeletionInspection {
  detail: VoucherDetail
  /** Exact raw JSON hash. Any difference, including field order, requires a new preview; not a vendor lock. */
  fingerprint: string
  modified: string
  channel: string
  attachmentCount: number
  auxiliaryEntryCount: number
  currencyCodes: string[]
  /** Conservative local refusals, not an exhaustive statement of vendor deletion constraints. */
  blockers: string[]
  notice: string
}

/**
 * Inspect a fresh detail without interpreting missing fields as false or empty collections.
 * @param data - Byte-bounded raw vendor JSON, including fields omitted from the ordinary detail view.
 * @param voucherId - Exact queried ID.
 * @param account - Independently verified ledger identity.
 * @param maxBytes - Complete raw input and returned inspection cap.
 * @returns Read-only evidence; unknown or malformed state throws and cannot authorize deletion.
 */
export function inspectVoucherDeletion(data: unknown, voucherId: string,
  account: { id: string; name: string }, maxBytes: number): VoucherDeletionInspection {
  if (data === undefined) throw new Error('凭证删除检查数据缺失或超过大小限制。')
  const serialized = JSON.stringify(data)
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new Error('凭证删除检查数据缺失或超过大小限制。')
  }
  const detail = projectVoucherDetail(data, voucherId, account, maxBytes)
  const parsed = deletionState.safeParse(data)
  if (!parsed.success) throw new Error('凭证删除所需状态或关联字段未完整返回，不能按无关联处理。')
  const item = parsed.data
  const blockers: string[] = []
  if (detail.audited) blockers.push('凭证已审核。')
  if (detail.settled) blockers.push('凭证已结账。')
  if (item.sysCreate) blockers.push('系统生成凭证需核实来源及关联影响。')
  if (item.relationCode !== '' || item.corpBalanceSheetCertificateList.length > 0 || item.subjectCertificateWrites.length > 0) {
    blockers.push('凭证存在关联标识或关联记录，不能自动联动删除。')
  }
  if (item.adjustPeriodsStatus !== 0) blockers.push('凭证调整期间状态尚未核实。')
  if (item.attachmentStatus !== (item.attachmentList.length > 0)) blockers.push('凭证附件状态与返回列表不一致。')
  const inspection: VoucherDeletionInspection = {
    detail, fingerprint: createHash('sha256').update(serialized).digest('hex'),
    modified: item.modified, channel: item.channel,
    attachmentCount: item.attachmentList.length,
    auxiliaryEntryCount: item.certificateLists.filter(row => row.auxiliaryList.length > 0).length,
    currencyCodes: [...new Set(item.certificateLists.map(row => row.currencyCode).filter(code => code !== ''))],
    blockers,
    notice: `仅检查指定凭证的当前状态及已返回关联；空列表不证明没有其他关联。未执行删除，未取得删除授权。指纹变化需重新预览，不提供供应商并发锁。${VOUCHER_DELETION_ATTACHMENT_NOTICE}`,
  }
  if (Buffer.byteLength(JSON.stringify(inspection), 'utf8') > maxBytes) throw new Error('凭证删除检查结果超过大小限制。')
  return inspection
}

/** Vendor deletion fields for one exact voucher; the endpoint does not consume creation appId/flowId. */
export interface VoucherDeletionPayload {
  accountName: string
  cerInfoList: [{ cerId: string }]
}

/** Acceptance is transport evidence only; independent absence verification remains mandatory. */
export type VoucherDeletionOutcome = { state: 'accepted' } | { state: 'rejected'; code: number }
  | { state: 'outcome-unknown' } | { state: 'not-sent'; reason: 'preflight-failed' | 'cancelled' }

/**
 * Build the minimal vendor request from a fresh, ledger-qualified detail.
 * @param inspection - Fresh, exact-ledger inspection, not consent.
 * @returns One-target request fields; throws for known local blockers. Does not authorize sending.
 */
export function prepareVoucherDeletion(inspection: VoucherDeletionInspection): VoucherDeletionPayload {
  if (inspection.blockers.length > 0) throw new Error('凭证存在尚未处理的删除限制，需要先核实，不能自动解除。')
  return { accountName: inspection.detail.accountName, cerInfoList: [{ cerId: inspection.detail.voucherId }] }
}

/**
 * Classify the single-target deletion envelope without exposing vendor prose or asserting absence.
 * @param value - Parsed, bounded JSON from one deletion request.
 * @param httpOk - Whether HTTP succeeded.
 * @returns Acceptance, explicit parameter rejection or uncertainty; never deletion verification.
 */
export function classifyVoucherDeletion(value: unknown, httpOk: boolean): VoucherDeletionOutcome {
  const parsed = z.object({ result: z.number().int() }).safeParse(value)
  if (!httpOk || !parsed.success) return { state: 'outcome-unknown' }
  const { result } = parsed.data
  if (result >= 100 && result < 200) return { state: 'accepted' }
  if (result >= 200 && result < 300) return { state: 'rejected', code: result }
  return { state: 'outcome-unknown' }
}

/**
 * Observe target absence using two complete, consistent, unfiltered all-period inventories.
 * @param target - Previously verified ledger and exact voucher identity.
 * @param read - Authenticated bounded reader; failures must reject, never return an empty substitute.
 * @param maxPages - Deployment limit per complete pass; excess rejects instead of asserting absence.
 * @returns Present or independently absent; throws on incomplete or changing inventories. Does not prove a vendor transaction lock.
 */
export async function observeVoucherAbsence(target: { accountId: string; accountName: string; voucherId: string },
  read: (query: VoucherQuery) => Promise<VoucherPage>, maxPages: number): Promise<{ state: 'present' | 'absent'; voucherCount: number }> {
  let previous: string | undefined
  let observedCount = 0
  for (let pass = 0; pass < 2; pass++) {
    const ids = new Set<string>()
    let total: number | undefined
    let complete = false
    for (let page = 1; page <= maxPages; page++) {
      const result = await read({ page, pageSize: 100 })
      if (result.accountId !== target.accountId || result.accountName !== target.accountName
        || result.month !== '不限月份' || result.monthEnd !== undefined || result.summary !== undefined
        || result.page !== page || result.pageSize !== 100 || total !== undefined && result.total !== total) {
        throw new Error('删除回查的账套、查询范围或总量发生变化，不能证明目标不存在。')
      }
      total = result.total
      const pageIds = new Set(result.rows.map(row => row.voucherId))
      if (pageIds.has(target.voucherId)) return { state: 'present', voucherCount: total }
      if (pageIds.size !== result.voucherCount || [...pageIds].some(id => ids.has(id))) {
        throw new Error('删除回查分页重复或数量不一致，不能证明目标不存在。')
      }
      for (const id of pageIds) ids.add(id)
      if (!result.hasMore) { complete = true; break }
    }
    if (!complete || total !== ids.size) throw new Error('删除回查未完整读取全部凭证，不能把筛选空页当作删除成功。')
    const current = JSON.stringify([...ids].sort())
    if (previous !== undefined && previous !== current) throw new Error('删除回查两次清单不一致，请稍后只读复查。')
    previous = current
    observedCount = ids.size
  }
  return { state: 'absent', voucherCount: observedCount }
}
