/** Pure open-item proposal validation and counterparty formatting; no approval or external writes. */
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ReferenceResult } from './references.ts'
import { openItemQuerySchema } from './open-items.ts'

const referenceId = z.string().regex(/^[1-9]\d*$/)
  .refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER))
  .transform(value => value as Branded<'FinanceReferenceId'>)
const amount = z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/).refine((value) => {
  const cents = BigInt(value.replace('.', ''))
  return cents > 0n && cents <= BigInt(Number.MAX_SAFE_INTEGER) && Number(value).toFixed(2) === value
}, '应收应付金额必须为可无损传递的正数，保留两位小数。')
const schema = z.strictObject({
  direction: z.enum(['receivable', 'payable']), accountId: referenceId, categoryId: referenceId,
  auxiliaryCategoryCode: z.string().trim().min(1), auxiliaryItemId: referenceId,
  date: z.iso.date(), amount, summary: z.string().trim().min(1), keeperName: z.string().trim().min(1),
  accountReferenceQuery: openItemQuerySchema.optional(),
})

const sourcedInput = schema.extend({ accountReferenceQuery: openItemQuerySchema })
  .refine(input => input.direction === input.accountReferenceQuery.direction, '账户来源必须与新增往来方向一致。')

/** Host commands require an explicit account-source page; inspection never resends. */
export const openItemPreparationRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('prepare'), input: sourcedInput }),
  z.strictObject({ action: z.literal('revise'), id: z.uuid(), version: z.number().int().positive(), input: sourcedInput }),
  z.strictObject({ action: z.literal('inspect'), id: z.uuid() }),
])

/** Only a persisted local ID and exact version may reach mandatory creation approval. */
export const openItemCreateRequestSchema = z.strictObject({ id: z.uuid(), version: z.number().int().positive() })

/** Explicit business inputs; account/category IDs still require separate Host resolution before approval. */
export type OpenItemPreparationInput = z.infer<typeof schema>

/**
 * Validate untrusted local input without selecting a ledger or authorizing a request.
 * @param input - Model or durable JSON; vendor fields and destination overrides are rejected.
 * @param maxBytes - Limit for the complete normalized proposal.
 * @returns Exact-cent positive money, a calendar date and explicit reference identifiers.
 */
export function validateOpenItemPreparation(input: unknown, maxBytes: number): OpenItemPreparationInput {
  const value = schema.parse(input)
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) throw new Error('应收应付准备内容超过大小限制。')
  return value
}

/** Returned category/item identity; unknown status is retained, never interpreted as enabled. */
export interface OpenItemCounterparty {
  categoryId: Branded<'FinanceReferenceId'>
  categoryCode: string
  categoryName: string
  itemId: Branded<'FinanceReferenceId'>
  itemCode: string
  itemName: string
  itemStatus: 'enabled' | 'unknown'
  wireName: string
}

/**
 * Resolve one category-qualified item from unfiltered returned sets, without claiming complete vendor coverage.
 * @param input - Validated proposal with category code and item ID.
 * @param ledger - Independently verified destination.
 * @param categories - Unfiltered auxiliary categories in that ledger.
 * @param items - Unfiltered items in the requested, independently verified category.
 * @returns Identity, actual names and categoryName:itemName; ambiguous or disabled selections reject.
 */
export function resolveOpenItemCounterparty(input: OpenItemPreparationInput, ledger: { id: string; name: string },
  categories: ReferenceResult, items: ReferenceResult): OpenItemCounterparty {
  if (categories.kind !== 'auxiliary-categories' || items.kind !== 'auxiliary-items'
    || items.categoryCode !== input.auxiliaryCategoryCode
    || [categories, items].some(result => result.accountId !== ledger.id || result.accountName !== ledger.name
      || result.selection !== 'not-requested')) {
    throw new Error('应收应付辅助资料的账套、类别或查询范围不一致，请重新查询完整返回集。')
  }
  const selectedCategories = categories.rows.filter(row => row.code === input.auxiliaryCategoryCode)
  const selectedItems = items.rows.filter(row => row.id === input.auxiliaryItemId)
  const category = selectedCategories[0]
  const item = selectedItems[0]
  if (selectedCategories.length !== 1 || category === undefined || selectedItems.length !== 1 || item === undefined
    || category.status === 'disabled' || item.status === 'disabled') {
    throw new Error('应收应付往来类别或项目不存在、不唯一或已停用。')
  }
  if (categories.rows.filter(row => row.name === category.name).length !== 1
    || items.rows.filter(row => row.name === item.name).length !== 1) {
    throw new Error('应收应付往来类别或项目存在同名，无法安全按名称提交。')
  }
  if ([category.name, item.name].some(name => name.trim() !== name || name.length === 0 || /[:,\r\n]/.test(name))) {
    throw new Error('往来名称包含当前未支持的分隔符或首尾空白，不能安全组装类别名称:项目名称。')
  }
  return { categoryId: category.id, categoryCode: category.code, categoryName: category.name,
    itemId: item.id, itemCode: item.code, itemName: item.name, itemStatus: item.status,
    wireName: `${category.name}:${item.name}` }
}

/**
 * Build the qualified public add request; this function neither resolves the account nor authorizes sending.
 * @param input - Validated exact proposal; the caller must independently recheck its account ID and category direction.
 * @param ledgerName - Host-verified ledger name.
 * @param categoryName - Unambiguous, direction-matched income/expense category selected by the Host.
 * @param counterparty - Freshly resolved auxiliary category and item for this proposal.
 * @returns Fixed manual-source payload, with no payment, settlement, voucher or attachment fields.
 */
export function buildOpenItemSubmission(input: OpenItemPreparationInput, ledgerName: string,
  categoryName: string, counterparty: OpenItemCounterparty): object {
  if (counterparty.categoryCode !== input.auxiliaryCategoryCode || counterparty.itemId !== input.auxiliaryItemId
    || counterparty.wireName !== `${counterparty.categoryName}:${counterparty.itemName}`) {
    throw new Error('应收应付预览与往来资料不一致。')
  }
  return { booksName: ledgerName, categoryName, auxiliaryItemNames: counterparty.wireName,
    direction: input.direction === 'payable', date: input.date, abstractStr: input.summary,
    money: Number(input.amount), resource: 1, accountId: Number(input.accountId), keeperName: input.keeperName }
}
