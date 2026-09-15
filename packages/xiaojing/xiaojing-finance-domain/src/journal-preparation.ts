/** Local journal proposals and documented request mapping; no approval or external writes. */
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ReferenceResult } from './references.ts'

const positiveId = z.string().regex(/^[1-9]\d*$/).refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER))
const amount = z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/).refine((value) => {
  const cents = BigInt(value.replace('.', ''))
  return cents > 0n && cents <= BigInt(Number.MAX_SAFE_INTEGER)
    && Number(value).toFixed(2) === value
}, '日记账金额必须为可无损传递的正数，保留两位小数。')
const schema = z.strictObject({
  cashAccountId: positiveId.transform(value => value as Branded<'FinanceReferenceId'>),
  date: z.iso.date(), direction: z.enum(['income', 'expense']), amount,
  summary: z.string().trim().min(1), keeperName: z.string().trim().min(1),
  categoryId: positiveId.transform(value => value as Branded<'FinanceReferenceId'>).optional(),
})

/** Local preparation commands; neither an arbitrary endpoint nor approval override is accepted. */
export const journalPreparationRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('prepare'), input: schema }),
  z.strictObject({ action: z.literal('revise'), id: z.uuid(), version: z.number().int().positive(), input: schema }),
  z.strictObject({ action: z.literal('inspect'), id: z.uuid() }),
])

/** Creation uses only the previously displayed local version. */
export const journalCreateRequestSchema = z.strictObject({ id: z.uuid(), version: z.number().int().positive() })

/** A normalized local proposal; destination and predecessor are supplied by the Host, not the model. */
export type JournalPreparationInput = z.infer<typeof schema>

/**
 * Validate an untrusted proposal without selecting references or sending a request.
 * @param input - Model or persisted JSON; arbitrary vendor fields are rejected.
 * @param maxBytes - Deployment limit for the complete normalized proposal.
 * @returns Normalized fields, with positive exact-cent money and a real calendar date.
 */
export function validateJournalPreparation(input: unknown, maxBytes: number): JournalPreparationInput {
  const value = schema.parse(input)
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) throw new Error('日记账准备内容超过大小限制。')
  return value
}

/** Explicit reference resolution retained for the approval preview and rechecked before dispatch. */
export interface JournalReferenceSelection {
  accountId: string
  accountName: string
  cashAccountId: Branded<'FinanceReferenceId'>
  cashAccountName: string
  cashAccountCode: string
  cashAccountCurrencyId?: string
  cashAccountType?: number
  cashAccountDirectionRaw?: string
  categoryName?: string
}

/**
 * Select only returned enabled cash accounts and direction-matched categories in one verified ledger.
 * @param input - Validated local proposal.
 * @param account - Host-authenticated destination identity.
 * @param accounts - Cash accounts returned for that destination.
 * @param categories - Required when the proposal selects a category.
 * @returns Exact labels and returned account attributes for approval-time comparison; missing attributes stay absent.
 */
export function resolveJournalReferences(input: JournalPreparationInput, account: { id: string; name: string },
  accounts: ReferenceResult, categories?: ReferenceResult): JournalReferenceSelection {
  if (accounts.kind !== 'cash-accounts' || accounts.accountId !== account.id || accounts.accountName !== account.name) {
    throw new Error('日记账资金账户查询与当前账套不一致。')
  }
  const matches = accounts.rows.filter(row => row.id === input.cashAccountId)
  const cash = matches[0]
  if (matches.length !== 1 || cash === undefined || cash.status !== 'enabled') {
    throw new Error('日记账资金账户不存在、不唯一或未确认启用，请重新查询。')
  }
  const selection: JournalReferenceSelection = { accountId: account.id, accountName: account.name,
    cashAccountId: cash.id, cashAccountName: cash.name, cashAccountCode: cash.code,
    ...cash.currencyId === undefined ? {} : { cashAccountCurrencyId: cash.currencyId },
    ...cash.accountType === undefined ? {} : { cashAccountType: cash.accountType },
    ...cash.directionRaw === undefined ? {} : { cashAccountDirectionRaw: cash.directionRaw } }
  if (input.categoryId !== undefined) {
    if (categories?.kind !== 'cash-categories' || categories.accountId !== account.id || categories.accountName !== account.name) {
      throw new Error('日记账收支类别查询与当前账套不一致。')
    }
    const found = categories.rows.filter(row => row.id === input.categoryId)
    const category = found[0]
    if (found.length !== 1 || category === undefined || category.directionRaw !== (input.direction === 'income' ? '0' : '1')) {
      throw new Error('日记账收支类别不存在、不唯一或方向不匹配。')
    }
    // The public write API accepts a name, not the ID used to select the reference.
    if (category.name.length > 64 || categories.rows.filter(row => row.name === category.name).length !== 1) {
      throw new Error('日记账类别名称过长或同名，无法安全提交。')
    }
    selection.categoryName = category.name
  }
  return selection
}

/**
 * Map a validated, reference-resolved proposal to one journal request without granting write authority.
 * @param input - Exact confirmed version, validated again by the caller after any revision.
 * @param selection - Host-resolved ledger and cash account, not an accounting-subject identifier.
 * @param previousId - Host-qualified predecessor (zero only when qualified as the insertion position).
 * @returns Request fields; the inactive money side is null and audit/voucher-generation fields are absent.
 */
export function buildJournalSubmission(input: JournalPreparationInput, selection: JournalReferenceSelection,
  previousId: string): object {
  const predecessor = z.string().regex(/^(0|[1-9]\d*)$/)
    .refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)).parse(previousId)
  if (selection.cashAccountId !== input.cashAccountId || (input.categoryId !== undefined) !== (selection.categoryName !== undefined)) {
    throw new Error('日记账预览与已核验资料不一致。')
  }
  return { accountName: selection.accountName, subjectId: Number(selection.cashAccountId),
    date: input.date, abstractStr: input.summary, keeperName: input.keeperName,
    borrow: input.direction === 'income' ? Number(input.amount) : null,
    loan: input.direction === 'expense' ? Number(input.amount) : null, preId: Number(predecessor),
    ...selection.categoryName === undefined ? {} : { categoryName: selection.categoryName } }
}
