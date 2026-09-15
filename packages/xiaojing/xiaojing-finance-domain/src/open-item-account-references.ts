/** Account attributes observed on existing public open-item rows, not a complete account directory. */
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { OpenItemId, OpenItemQuery, OpenItemResult } from './open-items.ts'

const identity = z.union([z.string().regex(/^[1-9]\d*$/)
  .refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)), z.number().int().positive()]).transform(String)
const attributes = z.object({ subjectId: identity.nullish(), accountStatus: z.number().int().nonnegative().nullish(),
  accountWb: z.boolean().nullish() })

/** One returned business row's account attributes; absent attributes never establish enablement or base currency. */
export interface OpenItemAccountObservation {
  sourceRecordId: OpenItemId
  id: Branded<'FinanceReferenceId'> | null
  name: string
  status: 'enabled' | 'disabled' | 'unknown'
  foreignCurrency: boolean | null
  currencyCode: string
  baseCurrencyCode: string
}

/** Evidence from an explicit query page; records absent from this page imply nothing about account existence. */
export interface OpenItemAccountReferences {
  ledgerId: string
  ledgerName: string
  query: OpenItemQuery
  source: 'existing-open-item-page'
  coverage: 'returned-page-only'
  observations: OpenItemAccountObservation[]
}

/**
 * Join public account attributes to the same validated business rows, ignoring aggregate markers.
 * @param raw - Original bounded vendor data for this page.
 * @param page - Independently projected same-response business page.
 * @param maxBytes - Complete observation result cap.
 * @returns Explicit source records and attributes, including missing IDs or flags without defaults.
 */
export function projectOpenItemAccountReferences(raw: unknown, page: OpenItemResult, maxBytes: number): OpenItemAccountReferences {
  const parsed = z.object({ list: z.array(z.looseObject({ id: z.union([z.string(), z.number().int()]).transform(String) })) }).parse(raw)
  const observations = page.rows.map((row): OpenItemAccountObservation => {
    const matches = parsed.list.filter(item => item.id === row.id)
    if (matches.length !== 1) throw new Error('往来账户属性与原始业务记录不一致。')
    const selected = attributes.parse(matches[0])
    return { sourceRecordId: row.id, id: selected.subjectId == null ? null : selected.subjectId as Branded<'FinanceReferenceId'>,
      name: row.subjectName, status: selected.accountStatus == null ? 'unknown' : selected.accountStatus === 0 ? 'enabled' : 'disabled',
      foreignCurrency: selected.accountWb ?? null, currencyCode: row.currencyCode, baseCurrencyCode: row.baseCurrencyCode }
  })
  const result: OpenItemAccountReferences = { ledgerId: page.accountId, ledgerName: page.accountName, query: page.selection,
    source: 'existing-open-item-page', coverage: 'returned-page-only', observations }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) throw new Error('往来账户属性超过结果大小限制。')
  return result
}

/**
 * Select a currently returned enabled base-currency account without inventing IDs or scanning other periods.
 * @param references - Fresh public observations for the explicitly selected page.
 * @param ledger - Host-verified destination.
 * @param direction - Proposed receivable/payable branch.
 * @param accountId - Explicit selected account identity, not an accounting-subject code.
 * @returns One consistent account observation; absent, conflicting, disabled or unqualified-currency data rejects.
 */
export function resolveObservedOpenItemAccount(references: OpenItemAccountReferences, ledger: { id: string; name: string },
  direction: OpenItemQuery['direction'], accountId: Branded<'FinanceReferenceId'>): OpenItemAccountObservation {
  if (references.ledgerId !== ledger.id || references.ledgerName !== ledger.name || references.query.direction !== direction) {
    throw new Error('往来账户属性的账套或方向与方案不一致。')
  }
  const matches = references.observations.filter(row => row.id === accountId)
  const selected = matches[0]
  if (selected === undefined) throw new Error('本次公开往来查询未返回所选账户，不能据此认定账户不存在或猜测账户ID。')
  if (matches.some(row => row.name !== selected.name || row.status !== selected.status
    || row.foreignCurrency !== selected.foreignCurrency || row.currencyCode !== selected.currencyCode
    || row.baseCurrencyCode !== selected.baseCurrencyCode)) throw new Error('同一往来账户返回不一致属性，请重新核实。')
  if (selected.name.trim() === '' || selected.status !== 'enabled') throw new Error('往来账户未确认启用，不能提交。')
  if (selected.foreignCurrency !== false || selected.currencyCode === '' || selected.currencyCode !== selected.baseCurrencyCode) {
    throw new Error('当前往来创建尚未核验该账户的币种设置，不猜测币种或汇率。')
  }
  return selected
}
