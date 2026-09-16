/** Bounded projection of the V2 Finance voucher-list response; vendor fields are untrusted data. */
import { z } from 'zod'

const money = z.union([z.string(), z.number()]).nullish()
const entry = z.object({
  abstractName: z.string(), subjectCode: z.string(), subjectName: z.string(),
  direction: z.union([z.literal(0), z.literal(1)]),
  borrorMoney: money, loanMoney: money, borrorMoneyStr: money, loanMoneyStr: money,
})
const voucher = z.object({
  certificateId: z.string().min(1), certificateWord: z.string(),
  certificateCode: z.union([z.string(), z.number().int()]), certificateDate: z.iso.date(),
  entryList: z.array(entry).min(1),
})
const pageSchema = z.object({
  success: z.literal(true), count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), list: z.array(voucher),
})
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const detailSchema = voucher.omit({ entryList: true }).extend({
  accountId: z.string().min(1), periods: period,
  certificateLists: z.array(entry).min(1),
  auditingStatus: z.boolean(), settleStatus: z.boolean(), documentMaker: z.string(),
})

/** Verified identity and accounting entries of one voucher; attachments and auxiliary details are not projected. */
export interface VoucherDetail {
  accountId: string
  accountName: string
  voucherId: string
  date: string
  number: string
  period: string
  audited: boolean
  settled: boolean
  documentMaker: string
  rows: VoucherRow[]
  notice: string
}

/**
 * Validate a vendor voucher identifier before authentication.
 * @param voucherId - Identifier from a query result or user.
 */
export function validateVoucherId(voucherId: string): void {
  if (!z.string().trim().min(1).max(200).safeParse(voucherId).success || voucherId.trim() !== voucherId) {
    throw new Error('请提供查询结果中的有效凭证 ID，不要把凭证号或摘要当作 ID。')
  }
}

/**
 * Project one detail response only after matching the requested ledger and voucher.
 * @param data - Untrusted vendor data.
 * @param voucherId - Requested voucher identifier.
 * @param account - Independently verified ledger.
 * @param maxBytes - Complete model-visible result byte limit.
 * @returns Verified accounting fields; throws on identity, amount, format, or size errors.
 */
export function projectVoucherDetail(
  data: unknown, voucherId: string, account: { id: string; name: string }, maxBytes: number,
): VoucherDetail {
  validateVoucherId(voucherId)
  const item = detailSchema.parse(data)
  if (item.accountId !== account.id || item.certificateId !== voucherId) throw new Error('凭证详情身份不匹配，已拒绝返回。')
  const page = projectVoucherPage({ success: true, count: 1, list: [{ ...item, entryList: item.certificateLists }] },
    { page: 1, pageSize: 1 }, account, Number.MAX_SAFE_INTEGER)
  const result: VoucherDetail = {
    accountId: account.id, accountName: account.name, voucherId,
    date: item.certificateDate, number: `${item.certificateWord}-${item.certificateCode}`, period: item.periods,
    audited: item.auditingStatus, settled: item.settleStatus, documentMaker: item.documentMaker,
    rows: page.rows,
    notice: '仅为指定凭证的会计分录、期间和审核/结账状态；不包含附件、辅助核算及外币明细，不代表这些资料不存在。未执行任何写操作。',
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) throw new Error('凭证详情结果过大，无法完整返回。')
  return result
}
const querySchema = z.strictObject({
  month: period.optional(), monthEnd: period.optional(),
  summary: z.string().refine(value => value.trim().length > 0).optional(),
  page: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  pageSize: z.number().int().min(1).max(100),
})

/** One explicitly bounded read of the selected ledger. */
export interface VoucherQuery {
  /** YYYY-MM; without monthEnd, selects this single period. Omitted selects all periods. */
  month?: string
  /** Inclusive final period; requires month and cannot precede it. */
  monthEnd?: string
  /** Vendor-side abstractName filter; matching semantics require live verification. */
  summary?: string
  /** One-based page. */
  page: number
  /** Maximum number of vouchers, not entry rows, requested from the vendor. */
  pageSize: number
}

/** Model-visible voucher entry, with decimal strings preserving monetary precision. */
export interface VoucherRow {
  voucherId: string
  date: string
  number: string
  summary: string
  subjectCode: string
  subjectName: string
  debit: string
  credit: string
}

/** A single page is never represented as the entire ledger. */
export interface VoucherPage {
  accountId: string
  accountName: string
  month: string
  /** Explicit inclusive end of a requested range, absent for single/all-period requests. */
  monthEnd?: string
  /** Requested vendor-side summary filter, not a claim of exact matching. */
  summary?: string
  page: number
  pageSize: number
  total: number
  hasMore: boolean
  voucherCount: number
  /** Number of vendor pages read for a complete export; absent for an ordinary page query. */
  pagesRead?: number
  /** Scope and completeness limits accompanying every model-visible page. */
  notice: string
  rows: VoucherRow[]
}

/**
 * Complete matching voucher rows collected from stable, count-reconciled vendor pages.
 * @param query - Voucher filters; its page values are ignored.
 * @param read - Authenticated reader for one validated vendor page.
 * @param signal - Cancellation checked around every page read.
 * @param options - Export page size and aggregate result byte cap.
 * @returns Every unique voucher row after its count matches the stable vendor total.
 */
export async function collectVoucherPages(query: VoucherQuery,
  read: (query: VoucherQuery) => Promise<VoucherPage>, signal: AbortSignal,
  options: { pageSize: number; maxBytes: number }): Promise<VoucherPage> {
  validateVoucherQuery({ ...query, page: 1, pageSize: options.pageSize })
  const rows: VoucherRow[] = []
  const voucherIds = new Set<string>()
  let identity: { id: string; name: string } | undefined
  let total: number | undefined
  let bytes = 0
  let page = 1
  for (;;) {
    signal.throwIfAborted()
    const selected: VoucherQuery = { ...query, page, pageSize: options.pageSize }
    const result = await read(selected)
    signal.throwIfAborted()
    if (result.page !== page || result.pageSize !== options.pageSize || result.month !== (query.month ?? '不限月份') ||
      result.monthEnd !== query.monthEnd || result.summary !== query.summary) throw new Error('凭证导出来源与查询条件不一致。')
    identity ??= { id: result.accountId, name: result.accountName }
    if (identity.id !== result.accountId || identity.name !== result.accountName) throw new Error('凭证导出期间账套身份变化。')
    total ??= result.total
    if (total !== result.total) throw new Error('凭证导出期间接口总张数发生变化，请重新导出。')
    bytes += Buffer.byteLength(JSON.stringify(result), 'utf8')
    if (bytes > options.maxBytes) throw new Error('凭证完整导出超过上限，请缩小会计期间后重试。')
    const pageIds = new Set(result.rows.map(row => row.voucherId))
    if (pageIds.size !== result.voucherCount) throw new Error('凭证导出页的凭证数与分录不一致。')
    for (const id of pageIds) {
      if (voucherIds.has(id)) throw new Error('凭证导出分页包含重复凭证。')
      voucherIds.add(id)
    }
    rows.push(...result.rows)
    if (!result.hasMore) break
    if (result.voucherCount === 0) throw new Error('凭证导出在完成前出现空页。')
    page += 1
  }
  if (voucherIds.size !== total) {
    throw new Error('凭证导出张数与接口总张数不一致，未生成不完整文件。')
  }
  const result: VoucherPage = {
    accountId: identity.id, accountName: identity.name, month: query.month ?? '不限月份',
    ...query.monthEnd === undefined ? {} : { monthEnd: query.monthEnd },
    ...query.summary === undefined ? {} : { summary: query.summary },
    page: 1, pageSize: options.pageSize, total, hasMore: false, voucherCount: voucherIds.size,
    pagesRead: page, rows,
    notice: '已从第一页开始逐页读取，并核对导出凭证张数与接口总张数；文件包含本次筛选返回的全部凭证分录。month/monthEnd 按起止会计期间传给接口，列表未返回独立会计期间，期间筛选未逐笔复核。summary 由接口筛选，精确或模糊匹配语义未核验。接口不提供原子快照，导出期间发生的数据变化仍可能导致失败或无法识别。金额保持精确文本，未推断币种或合计。',
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > options.maxBytes) {
    throw new Error('凭证完整导出超过上限，请缩小会计期间后重试。')
  }
  return result
}

/**
 * Validate query bounds before authentication.
 * @param query - Tool or service input.
 */
export function validateVoucherQuery(query: VoucherQuery): void {
  if (!querySchema.safeParse(query).success) throw new Error('凭证查询参数无效：仅接受 month、monthEnd、summary、page、pageSize；期间为 YYYY-MM，摘要不能为空白。')
  if (query.monthEnd !== undefined && (query.month === undefined || query.monthEnd < query.month)) {
    throw new Error('结束会计期间需要开始期间，且不能早于开始期间。')
  }
  if (!Number.isSafeInteger(query.page * query.pageSize)) throw new Error('分页范围超出安全整数上限，请减少页码。')
}

function amount(text: string | number | null | undefined, numeric: string | number | null | undefined, inactive: boolean): string {
  const raw = text === undefined || text === null || text === '' ? numeric : text
  if (raw === undefined || raw === null) {
    if (inactive) return '0.00'
    throw new Error('凭证金额缺失，不能作为零金额返回。')
  }
  const value = String(raw)
  if (!/^-?\d+(\.\d{1,2})?$/.test(value)) throw new Error('凭证金额格式无法识别。')
  const [integer, fraction = ''] = value.split('.')
  if (typeof raw === 'number') {
    const cents = BigInt(`${integer}${fraction.padEnd(2, '0')}`)
    if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < -BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('数值金额超出安全精度，请使用接口提供的金额字符串。')
    }
  }
  return `${integer}.${fraction.padEnd(2, '0')}`
}

/**
 * Admit only documented accounting fields, rejecting malformed or oversized pages without partial output.
 * @param data - Vendor response data.
 * @param query - Validated query.
 * @param account - Verified ledger identity.
 * @param maxBytes - Limit for the complete model-visible JSON value.
 * @returns A bounded page of entry rows; throws rather than presenting an invalid response as empty.
 */
export function projectVoucherPage(
  data: unknown, query: VoucherQuery, account: { id: string; name: string }, maxBytes: number,
): VoucherPage {
  validateVoucherQuery(query)
  const parsed = pageSchema.safeParse(data)
  if (!parsed.success) throw new Error('有成凭证响应格式不符合约定，请检查接口权限或联系管理员。')
  const { list, count } = parsed.data
  const expectedLength = Math.min(query.pageSize, Math.max(0, count - (query.page - 1) * query.pageSize))
  if (list.length !== expectedLength
    || new Set(list.map(item => item.certificateId)).size !== list.length) throw new Error('有成凭证分页响应不一致。')
  const result: VoucherPage = {
    accountId: account.id, accountName: account.name, month: query.month ?? '不限月份',
    ...query.monthEnd === undefined ? {} : { monthEnd: query.monthEnd },
    ...query.summary === undefined ? {} : { summary: query.summary },
    page: query.page, pageSize: query.pageSize, total: count,
    hasMore: query.page * query.pageSize < count, voucherCount: list.length,
    notice: 'total 为接口报告的本次筛选总张数，voucherCount 为本页张数，rows 为分录行；本页不是全部结果。month/monthEnd 按起止会计期间传给接口，日期为凭证日期，列表未返回独立会计期间，期间筛选未逐笔复核。summary 由接口筛选，精确或模糊匹配语义未核验；保留返回凭证的全部分录，不把未命中行删掉。翻页须保留筛选条件和 pageSize，期间数据可能变化。',
    rows: list.flatMap(item => item.entryList.map(line => ({
      voucherId: item.certificateId, date: item.certificateDate, number: `${item.certificateWord}-${item.certificateCode}`,
      summary: line.abstractName, subjectCode: line.subjectCode, subjectName: line.subjectName,
      debit: amount(line.borrorMoneyStr, line.borrorMoney, line.direction === 1),
      credit: amount(line.loanMoneyStr, line.loanMoney, line.direction === 0),
    }))),
  }
  if (query.page > 1 && count === 0) {
    result.notice += ' 本次是非首页空页；接口可能将越界页的 count 返回为 0，这不能证明筛选总数为零。需要总张数时用相同筛选条件重查第一页。'
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) throw new Error('凭证结果过大，请减少每页凭证数量后重试。')
  return result
}
