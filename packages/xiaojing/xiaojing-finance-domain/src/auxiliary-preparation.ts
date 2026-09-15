/** Auxiliary-item preparation and documented request mapping; never creates categories or sends requests. */
import { z } from 'zod'
import type { ReferenceResult } from './references.ts'

const text = z.string().trim().min(1).max(500)
const inputSchema = z.strictObject({ categoryCode: text, itemCode: text, itemName: text,
  documentMaker: text, status: z.enum(['enabled', 'disabled']) })
/** Complete local proposal; the current account name is supplied by the Host. */
export type AuxiliaryPreparationInput = z.infer<typeof inputSchema>

/**
 * Validate model or persisted JSON without resolving names or performing a write.
 * @param input - Complete proposal; credentials, account overrides and arbitrary fields reject.
 * @param maxBytes - Deployment limit for the normalized proposal.
 * @returns Explicit category, code, name, maker and requested status.
 */
export function validateAuxiliaryPreparation(input: unknown, maxBytes: number): AuxiliaryPreparationInput {
  const value = inputSchema.parse(input)
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) throw new Error('辅助项目准备内容超过大小限制。')
  return value
}

/** Verified category ownership and preview names; absence is limited to the returned item set. */
export interface AuxiliaryReferenceSelection {
  accountId: string
  accountName: string
  categoryId: ReferenceResult['rows'][number]['id']
  categoryCode: string
  categoryName: string
}

/**
 * Require one existing category and reject a returned item with the proposed code or name.
 * @param input - Validated complete proposal.
 * @param account - Independently verified current ledger.
 * @param categories - Current-ledger auxiliary category query.
 * @param items - Unfiltered current-category item query, not an exact-name subset.
 * @returns Displayable existing category identity; never a claim of exhaustive vendor coverage.
 */
export function resolveAuxiliaryReferences(input: AuxiliaryPreparationInput, account: { id: string; name: string },
  categories: ReferenceResult, items: ReferenceResult): AuxiliaryReferenceSelection {
  if (categories.kind !== 'auxiliary-categories' || items.kind !== 'auxiliary-items'
    || items.categoryCode !== input.categoryCode
    || [categories, items].some(result => result.accountId !== account.id || result.accountName !== account.name)) {
    throw new Error('辅助类别或项目查询与当前账套、类别不一致。')
  }
  if (categories.selection !== 'not-requested' || items.selection !== 'not-requested') {
    throw new Error('创建辅助项目前必须重新查询完整的返回资料，不使用筛选后的子集。')
  }
  const matches = categories.rows.filter(row => row.code === input.categoryCode)
  const category = matches[0]
  if (matches.length !== 1 || category === undefined) throw new Error('辅助类别不存在或不唯一；不会自动创建类别。')
  if (items.rows.some(row => row.code === input.itemCode)) throw new Error('该辅助类别已返回相同编码，不得覆盖已有项目。')
  if (items.rows.some(row => row.name === input.itemName)) throw new Error('该辅助类别已返回同名项目，请先核对已有资料。')
  return { accountId: account.id, accountName: account.name, categoryId: category.id,
    categoryCode: category.code, categoryName: category.name }
}

/**
 * Map only documented auxiliary creation fields; no category creation, IDs or historical associations are accepted.
 * @param input - Validated exact proposal.
 * @param selection - Host-resolved current ledger and existing category.
 * @returns Request fields without authentication, ready for separate confirmation and reservation.
 */
export function buildAuxiliarySubmission(input: AuxiliaryPreparationInput, selection: AuxiliaryReferenceSelection): object {
  if (input.categoryCode !== selection.categoryCode) throw new Error('辅助项目预览与已核实类别不一致。')
  return { categoryCode: input.categoryCode, itemCode: input.itemCode, itemName: input.itemName,
    documentMaker: input.documentMaker, accountName: selection.accountName, enableStatus: input.status === 'enabled' ? 1 : 0 }
}
