/** Read-only resolution of proposed voucher codes against the bound ledger's reference service. */
import type { ReferenceQuery, ReferenceResult, ReferenceRow } from './references.ts'
import type { VoucherPreparation } from './voucher-preparation.ts'

/** Names and identities for a preview; this result does not authorize submission. */
export interface VoucherReferencePreview {
  accountId: string
  accountName: string
  entries: { subject: ReferenceRow; auxiliary: { categoryCode: string; item: ReferenceRow }[] }[]
}

/**
 * Require unique enabled leaf subjects and exactly the configured auxiliary categories.
 * @param prepared - Structurally validated balanced proposal.
 * @param account - Independently verified ledger captured by the calling Host.
 * @param read - Host-scoped exact reference query; retains credential/configuration revision checks.
 * @param signal - Entire preparation cancellation.
 * @param maxBytes - Complete preview result limit.
 * @returns Resolved identities and names; periods, attachments, conversion and approval require separate checks.
 */
export async function resolveVoucherReferences(prepared: VoucherPreparation, account: { id: string; name: string },
  read: (query: ReferenceQuery) => Promise<ReferenceResult>, signal: AbortSignal, maxBytes: number): Promise<VoucherReferencePreview> {
  const cache = new Map<string, ReferenceRow>()
  const lookup = async (query: ReferenceQuery): Promise<ReferenceRow> => {
    signal.throwIfAborted()
    const key = JSON.stringify(query)
    const cached = cache.get(key)
    if (cached) return cached
    const result = await read(query)
    signal.throwIfAborted()
    if (result.accountId !== account.id || result.accountName !== account.name) throw new Error('凭证准备期间账套身份变化。')
    if (result.kind !== query.kind || result.categoryCode !== query.categoryCode) throw new Error('凭证资料查询类别不一致。')
    const row = result.rows[0]
    if (result.selection !== 'unique-returned' || result.rows.length !== 1 || row === undefined || row.code !== query.code) {
      throw new Error(`未找到唯一的凭证资料编码：${query.code}。请先查询并确认，不自动新增。`)
    }
    cache.set(key, row)
    return row
  }
  const entries: VoucherReferencePreview['entries'] = []
  for (const proposed of prepared.input.entries) {
    const subject = await lookup({ kind: 'subjects', code: proposed.subjectCode })
    if (subject.status !== 'enabled' || subject.hasChildren !== false) {
      throw new Error(`科目 ${subject.code} 未确认启用且为末级，不能用于本次凭证。`)
    }
    if (subject.auxiliaryCodes === undefined || subject.currencyCodes === undefined) {
      throw new Error(`科目 ${subject.code} 的辅助核算或币种配置未提供，不能推定为空。`)
    }
    const selected = proposed.auxiliary.map(item => item.categoryCode)
    if (selected.length !== subject.auxiliaryCodes.length || !subject.auxiliaryCodes.every(code => selected.includes(code))) {
      throw new Error(`科目 ${subject.code} 的辅助类别与所选项目不一致，请补齐或修正。`)
    }
    if (proposed.foreignCurrency === undefined ? subject.currencyCodes.length !== 0
      : !subject.currencyCodes.includes(proposed.foreignCurrency.code)) {
      throw new Error(`科目 ${subject.code} 的外币配置与本次分录不一致。`)
    }
    const auxiliary: VoucherReferencePreview['entries'][number]['auxiliary'] = []
    for (const selection of proposed.auxiliary) {
      const item = await lookup({ kind: 'auxiliary-items', categoryCode: selection.categoryCode, code: selection.itemCode })
      if (item.status === 'disabled') throw new Error(`辅助项目 ${item.code} 已停用。`)
      auxiliary.push({ categoryCode: selection.categoryCode, item })
    }
    entries.push({ subject, auxiliary })
  }
  const result = { accountId: account.id, accountName: account.name, entries }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) throw new Error('凭证资料预览超过大小限制。')
  return result
}
